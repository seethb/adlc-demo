// Context Quality benchmark — "more context should mean better answers; it doesn't".
// The same ADLC questions are answered by Claude under two regimes:
//   • context stuffing: six growing levels of real project context, exactly as a
//     long pipeline session accumulates it (specs → knowledge → artifacts → history
//     with failed attempts and superseded decisions);
//   • Meko-engineered: only the memories and knowledge chunks Meko recalls.
// Answers are graded deterministically against facts in the specs and standards.
import { execFileSync } from 'node:child_process';
import { ROOT, state, setState, emit, readText } from '../core.js';
import * as meko from '../live/meko.js';
import * as claude from '../live/claude.js';
import { KNOWLEDGE, STANDARDS } from '../seed/knowledge.js';

export const QUESTIONS = [
  { id: 'Q1', q: 'Which work-order priority and SLA in hours does a critical anomaly get?', expect: [/\bP1\b/i, /\b4\s*(h|hours?)\b|\b4\b/i], answer: 'P1, 4 h' },
  { id: 'Q2', q: 'A pump vibrates at 5.2 mm/s RMS. Which ISO 10816 zone is that and what severity does the detector assign?', expect: [/zone\s*C|\bC\b/, /high/i], answer: 'Zone C → high' },
  { id: 'Q3', q: 'For gateway-to-cloud telemetry, which protocol and port are used, which TLS version, and how is the device authenticated?', expect: [/MQTT/i, /8883/, /TLS\s*1\.3/i, /X\.?509|certificate/i], answer: 'MQTT 5 on 8883, TLS 1.3, per-device X.509 mTLS' },
  { id: 'Q4', q: 'When an F03 work order is closed, exactly which F05 inventory call must be made and with what argument?', expect: [/consume\s*\(\s*(wo_?id|wo\.id|woId|id|ref|workOrderId)\s*\)/i], answer: 'inventory.consume(woId)' },
  { id: 'Q5', q: 'What identifier format do Corrective Action Reports use?', expect: [/CAR-\d{3}|CAR-nnn/i], answer: 'CAR-001 (CAR-nnn)' },
  { id: 'Q6', q: 'In the F06 natural-language query planner, which metric does the word "surge" map to?', expect: [/surgeMargin/], answer: 'surgeMargin' },
  { id: 'Q7', q: 'How must the F02 anomaly detector treat a reading that contains NaN or Infinity?', expect: [/reject/i, /count/i], answer: 'Reject it, count it in rejected.count, never score it' },
  { id: 'Q8', q: 'What may edge feature modules import?', expect: [/node:/i, /fleet\.js/i], answer: 'Only node: built-ins and edge/reference/fleet.js' },
  { id: 'Q9', q: 'What is the maximum false-positive rate allowed for the anomaly detector on a healthy fleet?', expect: [/(below|under|<|less than)?\s*1\s*%/i], answer: 'Below 1 %' },
  { id: 'Q10', q: 'Where must raw 1 Hz telemetry stay, and for how long?', expect: [/edge/i, /7[\s-]*days?/i], answer: 'At the edge, 7 days' },
  { id: 'Q11', q: 'What are the high-alarm and critical limits for bearing temperature?', expect: [/85/, /95/], answer: '85 °C high, 95 °C critical' },
  { id: 'Q12', q: 'When does a CAR open for a work order that is not P1?', expect: [/(two|2)\s*(or more)?\s*(work orders|WOs)|2\+|>=\s*2|≥\s*2/i, /(three|3)\s*(or more)?\s*(times|occurrences)|occurrences\s*(>=|≥)\s*3|3\+/i], answer: 'On recurrence: ≥2 WOs, or one WO seen ≥3 times, for the same asset + failure mode' },
];

const SYSTEM = `You are an ADLC engineering agent. Answer the question using only the project context provided. If sources disagree, prefer the current specs and standards over drafts, logs or superseded material. Reply with one short line of JSON: {"answer": "<concise answer with the exact values>"}. If the context does not contain the answer, reply {"answer": "unknown"}.`;

// ---- context levels ----------------------------------------------------------------

const read = p => { try { return readText(p); } catch { return ''; } };
const gitOld = p => { try { return execFileSync('git', ['log', '--format=%H', '-n', '2', '--', p], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n')[1]; } catch { return null; } };
const gitShow = (sha, p) => { try { return execFileSync('git', ['show', `${sha}:${p}`], { cwd: ROOT, encoding: 'utf8' }); } catch { return ''; } };
const SPEC_OF = { Q1: 'F03-work-orders', Q2: 'F02-anomaly-detection', Q3: null, Q4: 'F03-work-orders', Q5: 'F04-corrective-action', Q6: 'F06-nl-asset-query', Q7: 'F02-anomaly-detection', Q8: null, Q9: 'F02-anomaly-detection', Q10: null, Q11: 'F02-anomaly-detection', Q12: 'F04-corrective-action' };

function allSpecs() {
  const files = ['specs/00-charter.md', 'specs/01-plan/roadmap.md', 'specs/02-design/architecture.md', 'specs/02-design/security.md', 'specs/agents/roster.json', 'specs/gates/gates.json',
    ...['F01-iot-simulator', 'F02-anomaly-detection', 'F03-work-orders', 'F04-corrective-action', 'F05-inventory', 'F06-nl-asset-query'].map(s => `specs/features/${s}.spec.md`)];
  return files.map(f => `## ${f}\n${read(f)}`).join('\n\n');
}
function artifacts() {
  return Object.entries(state.artifacts ?? {}).flatMap(([fid, st]) => Object.entries(st).map(([stage, a]) => `## ${fid} ${stage} artifact (run ${a.run})\n${a.text}`)).join('\n\n');
}
function history() {
  const parts = [];
  for (const r of Object.values(state.runs ?? {}).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    parts.push(`## Run ${r.id} (${r.feature}, ${r.status})\n${(r.log ?? []).map(l => `${l.at} ${l.stage}: ${l.message}`).join('\n')}`);
    for (const [st, x] of Object.entries(r.stages ?? {})) {
      if (x.artifact) parts.push(`### ${r.id} ${st} output${x.status === 'failed' ? ' (FAILED)' : ''}\n${x.artifact}`);
      if (x.failures?.length) parts.push(`### ${r.id} ${st} failures\n${x.failures.join('\n')}`);
      if (x.judge?.findings?.length) parts.push(`### ${r.id} review findings\n${x.judge.findings.map(f => `- ${f.severity}: ${f.title} — ${f.detail}`).join('\n')}`);
    }
  }
  const oldSpec = gitOld('specs/features/F03-work-orders.spec.md');
  if (oldSpec) parts.push(`## specs/features/F03-work-orders.spec.md @ ${oldSpec.slice(0, 7)} (earlier revision)\n${gitShow(oldSpec, 'specs/features/F03-work-orders.spec.md')}`);
  parts.push(`## Team memory log\n${(state.memoryLog ?? []).map(m => `- [${m.agent}] ${m.text}`).join('\n')}`);
  return parts.join('\n\n');
}

export const LEVELS = [
  { n: 1, label: 'Question only', build: () => '' },
  { n: 2, label: '+ relevant spec', build: q => (SPEC_OF[q.id] ? read(`specs/features/${SPEC_OF[q.id]}.spec.md`) : read('specs/02-design/security.md')) },
  { n: 3, label: '+ all specs', build: () => allSpecs() },
  { n: 4, label: '+ knowledge & standards', build: () => [allSpecs(), KNOWLEDGE.map(k => `## ${k.file}\n${k.body}`).join('\n\n'), `## Standards\n${STANDARDS.map(s => `- ${s}`).join('\n')}`].join('\n\n') },
  { n: 5, label: '+ all agent artifacts', build: () => [LEVELS[3].build(), artifacts()].join('\n\n') },
  // Everything from level 5 is kept; only the oldest pipeline history is trimmed
  // so the session stays around 160k tokens.
  { n: 6, label: '+ full pipeline history', build: () => {
    const base = LEVELS[4].build(), h = history(), room = Math.max(0, MAX_CHARS - base.length);
    return [base, h.length > room ? h.slice(h.length - room) : h].join('\n\n');
  } },
];

const MAX_CHARS = 460_000;
const prompt = (q, ctx) => `${ctx ? `# Project context\n${ctx}\n\n` : ''}# Question\n${q.q}`;

async function mekoContext(q) {
  const [mem, kb] = await Promise.all([meko.searchMemory('studio', q.q, 8).catch(() => []), meko.searchKnowledge('studio', q.q, 4).catch(() => [])]);
  return [
    mem.filter(m => m.metadata?.kind !== 'artifact').map(m => `- [${m.agent_id}] ${m.memory}`).join('\n'),
    kb.map(k => `- ${String(k.chunk_text ?? '').replace(/\s+/g, ' ').slice(0, 900)}`).join('\n'),
  ].filter(Boolean).join('\n');
}

export function grade(q, text) {
  let answer = text.trim();
  try { answer = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '').answer ?? answer; } catch { /* plain text */ }
  const hits = q.expect.filter(re => re.test(answer)).length;
  return { answer: String(answer).slice(0, 300), correct: hits === q.expect.length, partial: hits / q.expect.length, unknown: /^unknown$/i.test(String(answer).trim()) };
}

// ---- estimate & run ---------------------------------------------------------------

export async function estimate(n = QUESTIONS.length) {
  const qs = QUESTIONS.slice(0, n);
  const levels = [];
  for (const L of LEVELS) {
    const sizes = await Promise.all(qs.map(q => claude.countTokens(SYSTEM, prompt(q, L.build(q)))));
    levels.push({ n: L.n, label: L.label, tokens: Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length), total: sizes.reduce((a, b) => a + b, 0) });
  }
  const inTok = levels.reduce((a, l) => a + l.total, 0) + qs.length * 3000;
  return { questions: qs.length, levels, estCost: claude.cost(inTok, qs.length * 7 * 150), model: claude.model() };
}

let running = null;
export const status = () => ({ running: !!running, progress: running, result: state.contextBench ?? null });

async function pool(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

export async function run({ questions = QUESTIONS.length } = {}) {
  if (running) throw new Error('benchmark already running');
  if (!claude.enabled()) throw new Error('ANTHROPIC_API_KEY is not set');
  const qs = QUESTIONS.slice(0, questions);
  const jobs = [];
  for (const L of LEVELS) for (const q of qs) jobs.push({ arm: 'stuffing', level: L.n, q, ctx: () => L.build(q) });
  for (const q of qs) jobs.push({ arm: 'meko', level: 0, q, ctx: () => mekoContext(q) });
  running = { done: 0, total: jobs.length, startedAt: new Date().toISOString() };
  emit('bench', status());
  try {
    const rows = await pool(jobs, 4, async j => {
      const ctx = await j.ctx();
      const t0 = Date.now();
      let res, err;
      try { res = await claude.complete({ system: SYSTEM, prompt: prompt(j.q, ctx), maxTokens: 1200, effort: 'low', agent: 'studio', label: `bench ${j.arm} L${j.level} ${j.q.id}` }); }
      catch (e) { err = e.message; }
      running.done++;
      emit('bench', status());
      const g = res ? grade(j.q, res.text) : { answer: `error: ${err}`, correct: false, partial: 0, unknown: false };
      return { arm: j.arm, level: j.level, q: j.q.id, inTokens: res?.usage.input_tokens ?? 0, outTokens: res?.usage.output_tokens ?? 0, ms: Date.now() - t0, cost: res ? claude.cost(res.usage.input_tokens, res.usage.output_tokens) : 0, ...g };
    });
    const summarise = rs => ({
      accuracy: rs.filter(r => r.correct).length / Math.max(1, rs.length),
      partial: rs.reduce((a, r) => a + r.partial, 0) / Math.max(1, rs.length),
      unknown: rs.filter(r => r.unknown).length,
      wrong: rs.filter(r => !r.correct && !r.unknown).length,
      tokens: Math.round(rs.reduce((a, r) => a + r.inTokens, 0) / Math.max(1, rs.length)),
      cost: rs.reduce((a, r) => a + r.cost, 0),
      ms: Math.round(rs.reduce((a, r) => a + r.ms, 0) / Math.max(1, rs.length)),
    });
    const result = {
      at: new Date().toISOString(), model: claude.model(), questions: qs.map(q => ({ id: q.id, q: q.q, answer: q.answer })),
      levels: LEVELS.map(L => ({ n: L.n, label: L.label, ...summarise(rows.filter(r => r.arm === 'stuffing' && r.level === L.n)) })),
      meko: summarise(rows.filter(r => r.arm === 'meko')),
      rows,
    };
    setState({ contextBench: result });
    return result;
  } finally {
    running = null;
    emit('bench', status());
  }
}
