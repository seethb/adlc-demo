// One-time provisioning of the shared Meko datapack. Idempotent: re-running
// skips what is already there. --force re-uploads and re-seeds.
//   npm run setup
import { readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { state, setState, readText, env } from './core.js';
import * as meko from './live/meko.js';
import { KNOWLEDGE, STANDARDS } from './seed/knowledge.js';

const force = process.argv.includes('--force');
const log = (...a) => console.log('•', ...a);

async function ensureDatapack() {
  if (process.env.MEKO_DATAPACK_ID) { setState({ datapackId: process.env.MEKO_DATAPACK_ID }); return; }
  if (state.datapackId) return;
  const boot = await meko.call('conversation_create', { agent_id: 'adlc:studio', title: 'ADLC setup' });
  const list = await meko.call('datapack_list', { conversation_id: boot.id });
  const name = env('MEKO_DATAPACK_NAME', 'iot-edge-adlc');
  let dp = (Array.isArray(list) ? list : list.datapacks ?? []).find(d => d.datapack_name === name)?.datapack_id;
  if (!dp) dp = (await meko.call('datapack_create', { name, conversation_id: boot.id })).datapack_id;
  setState({ datapackId: dp });
}

await ensureDatapack();
log(`datapack ${meko.datapackId()}`);

// Incremental: only documents and standards not yet in the datapack are sent.
const specDocs = readdirSync(new URL('../specs/features/', import.meta.url)).filter(f => f.endsWith('.spec.md'))
  .map(f => ({ file: f, body: readText(`specs/features/${f}`) }));
const docs = [...KNOWLEDGE.map(k => ({ file: k.file, body: k.body })), ...specDocs,
  { file: 'architecture.md', body: readText('specs/02-design/architecture.md') },
  { file: 'security-data-classification.md', body: readText('specs/02-design/security.md') },
  { file: 'charter.md', body: readText('specs/00-charter.md') }];
// Re-upload a document whenever its content hash changes (e.g. a spec gains an AC).
const hash = t => createHash('sha256').update(t).digest('hex').slice(0, 16);
const kbHashes = force ? {} : { ...(state.kbHashes ?? {}) };
for (const d of docs.filter(d => kbHashes[d.file] !== hash(d.body))) {
  await meko.uploadKnowledge(d.file, d.body);
  log(`KB ← ${d.file}`);
  kbHashes[d.file] = hash(d.body);
  setState({ kbHashes });
}

const seeded = new Set(force ? [] : state.standards ?? (state.standardsSeeded ? STANDARDS.filter(t => !t.startsWith('IoT security')) : []));
for (const text of STANDARDS.filter(t => !seeded.has(t))) {
  const kind = /^(IoT security|Data classification)/.test(text) ? 'security-standard' : 'standard';
  await meko.addMemory('org', text, { kind, stage: 'org', feature: '*' });
  seeded.add(text);
  setState({ standards: [...seeded] });
  log(`memory ← ${text.slice(0, 70)}…`);
}

log('setup complete');
process.exit(0);
