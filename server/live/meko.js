// Meko MCP client. Every agent talks to the same datapack through this one
// connection, tagging calls with its own agent_id. Each call is recorded on a
// ring buffer and streamed to the UI so the audience sees the real traffic.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { env, emit, state, setState } from '../core.js';
import { redact, redactDeep } from '../security/privacy.js';

let client = null;
let connecting = null;
export const wire = [];
export const stats = { calls: 0, errors: 0, byTool: {}, ms: 0 };
const headers = () => ({ Authorization: `Bearer ${env('MEKO_API_KEY')}`, 'User-Agent': 'adlc-studio/0.1' });

async function connect() {
  const c = new Client({ name: 'adlc-studio', version: '0.1.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(env('MEKO_MCP_URL')), { requestInit: { headers: headers() } }));
  client = c;
  return c;
}
const ensure = () => client ?? (connecting ??= connect().finally(() => { connecting = null; }));

function unwrap(res) {
  const text = (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  let data = text;
  try {
    data = JSON.parse(text);
    if (data && typeof data.result === 'string') { try { data = JSON.parse(data.result); } catch { data = data.result; } }
  } catch { /* plain text */ }
  return { isError: !!res.isError, data, text };
}

const TRANSIENT = /fetch failed|ECONNRESET|ETIMEDOUT|socket|terminated|other side closed|timed out|session/i;
const MUTATING = /^(memory_add|memory_update|memory_delete|datapack_create|datapack_delete|artifact_put|conversation_create|conversation_add|track_token)/;

export async function call(tool, args = {}, { agent = 'studio', quiet = false } = {}) {
  const t0 = Date.now();
  // Privacy shield: every string argument is redacted before it reaches Meko;
  // artifact bodies are decoded, redacted and re-encoded.
  const clean = redactDeep(Object.fromEntries(Object.entries(args).filter(([k, v]) => v !== undefined && v !== null && v !== '' && k !== 'content_base64')), 'meko');
  if (args.content_base64) clean.content_base64 = Buffer.from(redact(Buffer.from(args.content_base64, 'base64').toString('utf8'), 'meko')).toString('base64');
  for (let attempt = 0; ; attempt++) {
    try {
      await ensure();
      const res = unwrap(await client.callTool({ name: tool, arguments: clean }, undefined, { timeout: 60_000 }));
      const bad = res.isError || (res.data && typeof res.data === 'object' && !Array.isArray(res.data) && res.data.error);
      record(tool, clean, agent, Date.now() - t0, bad, res.text, quiet);
      if (bad) throw new Error(`meko.${tool}: ${res.text.slice(0, 300)}`);
      return res.data;
    } catch (e) {
      const cause = `${e.message} ${e.cause?.message ?? ''}`;
      if (e.message.startsWith('meko.') || !TRANSIENT.test(cause) || MUTATING.test(tool) || attempt >= 2) {
        if (!e.message.startsWith('meko.')) record(tool, clean, agent, Date.now() - t0, true, e.message, quiet);
        throw e;
      }
      client = null;
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

function record(tool, args, agent, ms, isError, preview, quiet) {
  stats.calls++; stats.ms += ms; if (isError) stats.errors++;
  stats.byTool[tool] = (stats.byTool[tool] ?? 0) + 1;
  const a = { ...args }; delete a.content_base64;
  const entry = { id: stats.calls, at: new Date().toISOString(), agent, tool, args: JSON.stringify(a).slice(0, 220), ms, isError: !!isError, preview: String(preview).slice(0, 300) };
  wire.unshift(entry);
  wire.length = Math.min(wire.length, 150);
  if (!quiet) emit('meko', entry);
}

// ---- datapack + conversations ------------------------------------------------

export const datapackId = () => state.datapackId ?? process.env.MEKO_DATAPACK_ID;

// One Meko conversation per agent, reused across runs, so each agent's thread
// (and token usage) is visible in Meko.
export async function conversationFor(agentId, title) {
  state.conversations ??= {};
  if (state.conversations[agentId]) return state.conversations[agentId];
  const c = await call('conversation_create', { agent_id: `adlc:${agentId}`, datapack_id: datapackId(), title: title ?? `ADLC · ${agentId}` }, { agent: agentId });
  state.conversations[agentId] = c.id ?? c.conversation_id;
  setState({ conversations: state.conversations });
  return state.conversations[agentId];
}

const results = r => (Array.isArray(r) ? r : r?.results ?? r?.memories ?? []);

export async function searchMemory(agentId, query, limit = 8) {
  const conversation_id = await conversationFor(agentId);
  return results(await call('memory_search', { query, datapack_id: datapackId(), conversation_id, limit }, { agent: agentId }));
}

export async function addMemory(agentId, text, metadata = {}) {
  const conversation_id = await conversationFor(agentId);
  const r = await call('memory_add', { text, agent_id: `adlc:${agentId}`, datapack_id: datapackId(), conversation_id, metadata: JSON.stringify(metadata) }, { agent: agentId });
  const m = results(r)[0] ?? r;
  // Local mirror of what the team has written, for the memory explorer.
  state.memoryLog ??= [];
  const entry = { id: m?.id, agent: `adlc:${agentId}`, text, metadata, event: m?.event, at: new Date().toISOString() };
  state.memoryLog.unshift(entry);
  state.memoryLog.length = Math.min(state.memoryLog.length, 500);
  setState({ memoryLog: state.memoryLog });
  emit('memory', entry);
  return m;
}

export async function allMemories(agentId = 'studio') {
  const conversation_id = await conversationFor(agentId);
  return results(await call('memory_get_all', { datapack_id: datapackId(), conversation_id }, { agent: agentId, quiet: true }));
}

export async function deleteMemory(memoryId, agentId = 'studio') {
  const conversation_id = await conversationFor(agentId);
  return call('memory_delete_by_id', { memory_id: memoryId, datapack_id: datapackId(), conversation_id }, { agent: agentId });
}

export async function searchKnowledge(agentId, query, limit = 5) {
  const conversation_id = await conversationFor(agentId);
  try {
    return results(await call('knowledgebase_search', { query, datapack_id: datapackId(), conversation_id, limit, skip_conversation: true }, { agent: agentId }));
  } catch { return []; }
}

export async function putArtifact(agentId, filename, content, contentType = 'text/markdown') {
  const conversation_id = await conversationFor(agentId);
  return call('artifact_put', { filename, content_base64: Buffer.from(content).toString('base64'), content_type: contentType, datapack_id: datapackId(), conversation_id, agent_id: `adlc:${agentId}` }, { agent: agentId });
}

export async function getArtifact(agentId, contentHash) {
  const conversation_id = await conversationFor(agentId);
  const r = await call('artifact_get', { content_hash: contentHash, datapack_id: datapackId(), conversation_id, agent_id: `adlc:${agentId}` }, { agent: agentId });
  const b64 = r?.content_base64 ?? r?.artifact?.content_base64;
  return b64 ? Buffer.from(b64, 'base64').toString('utf8') : (r?.content ?? null);
}

export async function trackTokens(agentId, name, usage, model) {
  const conversation_id = await conversationFor(agentId);
  return call('track_token_usage', { conversation_id, datapack_id: datapackId(), name, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, total_tokens: usage.input_tokens + usage.output_tokens, model }, { agent: agentId, quiet: true }).catch(() => null);
}

export async function logTurn(agentId, input, output, metadata) {
  const conversation_id = await conversationFor(agentId);
  return call('conversation_add_message', { conversation_id, datapack_id: datapackId(), agent_id: `adlc:${agentId}`, input: input.slice(0, 4000), output: output.slice(0, 4000), metadata: JSON.stringify(metadata ?? {}) }, { agent: agentId, quiet: true }).catch(() => null);
}

// Knowledge-base upload is a REST endpoint, not an MCP tool.
export async function uploadKnowledge(filename, markdown) {
  const form = new FormData();
  form.append('file', new Blob([redact(markdown, 'meko')], { type: 'text/markdown' }), filename);
  const t0 = Date.now();
  const r = await fetch(`${env('MEKO_API_URL')}/datapacks/${datapackId()}/knowledge-bases/upload`, { method: 'POST', headers: headers(), body: form });
  record('kb_upload (REST)', { filename }, 'studio', Date.now() - t0, !r.ok, `HTTP ${r.status}`, false);
  if (!r.ok) throw new Error(`KB upload ${filename}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json().catch(() => ({}));
}

export async function health() {
  try {
    const t0 = Date.now();
    await ensure();
    const { tools } = await client.listTools();
    return { ok: true, tools: tools.length, ms: Date.now() - t0, datapackId: datapackId() };
  } catch (e) { return { ok: false, error: e.message }; }
}
