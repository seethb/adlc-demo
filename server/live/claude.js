// Claude via the Anthropic SDK. Every real call returns its usage so the
// economics ledger records actual billed tokens; count_tokens measures what the
// memory-less baseline prompt would have cost without running it.
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { env, emit } from '../core.js';
import { redact } from '../security/privacy.js';

const hasKey = () => !!process.env.ANTHROPIC_API_KEY;
let client = null;
const sdk = () => (client ??= new Anthropic());

export const model = () => env('CLAUDE_MODEL', 'claude-sonnet-5');
export const price = () => ({ in: Number(env('CLAUDE_PRICE_IN', '2')), out: Number(env('CLAUDE_PRICE_OUT', '10')) });
export const cost = (inTok, outTok) => (inTok * price().in + outTok * price().out) / 1e6;
export const enabled = () => hasKey();

export const stats = { calls: 0, input: 0, output: 0, counted: 0, errors: 0 };

// Streams the response (outputs can be long code files) and returns the text
// plus billed usage. On Opus/Fable models, server-side fallbacks re-run a
// refused request on the recommended fallback model; Sonnet runs without them.
export async function complete({ system, prompt, maxTokens = 16000, effort = 'low', agent = 'studio', label = '' }) {
  if (!hasKey()) throw new Error('ANTHROPIC_API_KEY is not set');
  const t0 = Date.now();
  emit('llm', { agent, label, phase: 'start', model: model() });
  // Privacy shield: nothing personal reaches the model.
  const params = {
    model: model(),
    max_tokens: maxTokens,
    system: redact(system, 'claude'),
    messages: [{ role: 'user', content: redact(prompt, 'claude') }],
    output_config: { effort },
  };
  let msg;
  const fallbacks = /opus|fable/.test(model());
  try {
    msg = fallbacks
      ? await sdk().beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage()
      : await sdk().messages.stream(params).finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) msg = await sdk().messages.stream(params).finalMessage();
    else { stats.errors++; emit('llm', { agent, label, phase: 'error', error: e.message }); throw e; }
  }
  if (msg.stop_reason === 'refusal') {
    stats.errors++;
    throw new Error(`Claude declined the request (${msg.stop_details?.category ?? 'refusal'})`);
  }
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const usage = { input_tokens: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0), output_tokens: msg.usage.output_tokens };
  stats.calls++; stats.input += usage.input_tokens; stats.output += usage.output_tokens;
  const ms = Date.now() - t0;
  emit('llm', { agent, label, phase: 'done', model: msg.model, usage, ms, truncated: msg.stop_reason === 'max_tokens' });
  return { text, usage, model: msg.model, ms, stopReason: msg.stop_reason };
}

const countCache = new Map();
// Exact token count for a prompt that is never sent — the baseline a
// memory-less agent would need. Falls back to a chars/3.6 estimate offline.
export async function countTokens(system, prompt) {
  const key = createHash('sha256').update(system + '\u0000' + prompt).digest('hex');
  if (countCache.has(key)) return countCache.get(key);
  let n;
  if (hasKey()) {
    try {
      n = (await sdk().messages.countTokens({ model: model(), system: redact(system, 'claude'), messages: [{ role: 'user', content: redact(prompt, 'claude') }] })).input_tokens;
      stats.counted++;
    } catch { n = Math.ceil((system.length + prompt.length) / 3.6); }
  } else n = Math.ceil((system.length + prompt.length) / 3.6);
  countCache.set(key, n);
  return n;
}
