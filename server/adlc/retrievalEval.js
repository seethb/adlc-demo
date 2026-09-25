// Meko accuracy & relevance evaluation.
// For each question: what Meko retrieves (memory_search + knowledgebase_search),
// whether the gold evidence is in it and at which rank, how relevant each item is
// (graded by Claude 0/1/2), and whether an answer built only from that context is
// correct. Gold evidence and answers are checked by pattern, not by opinion.
import { state, setState, emit } from '../core.js';
import * as meko from '../live/meko.js';
import * as claude from '../live/claude.js';
import { QUESTIONS, grade } from './contextBench.js';

// gold: an item is relevant evidence if its text matches every pattern.
const GOLD = {
  Q1: [/P1/i, /\b4\s*(h|hours?)\b|P1\s*=\s*4|within 4/i],
  Q2: [/10816|zone/i, /4\.5|7\.1/],
  Q3: [/8883/, /TLS/i],
  Q4: [/consume\s*\(\s*(woId|ref)/i],
  Q5: [/CAR-(\d{3}|nnn)/i],
  Q6: [/surgeMargin/],
  Q7: [/NaN|non-finite/i, /reject/i],
  Q8: [/node:/, /fleet\.js/],
  Q9: [/false[- ]positive/i, /1\s*%/],
  Q10: [/1 ?Hz|raw/i, /7 days/i],
  Q11: [/bearing/i, /85/, /95/],
  Q12: [/recur/i, /(two|2) or more|≥\s*2|three|3 or more/i],
};

const EXTRA = [
  { id: 'Q13', q: 'What vibration velocity marks the boundary into ISO 10816 zone D?', expect: [/7\.1/], answer: '> 7.1 mm/s', gold: [/7\.1/, /\bD\b/] },
  { id: 'Q14', q: 'What status does a work order get when its parts are short in inventory?', expect: [/waiting[_ ]parts/i], answer: 'waiting_parts', gold: [/waiting[_ ]parts/i] },
  { id: 'Q15', q: 'How many open purchase requisitions may exist per SKU?', expect: [/\b(one|1|single)\b/i], answer: 'One', gold: [/requisition/i, /(one|single|never two|exactly one)/i] },
  { id: 'Q16', q: 'Which OPC-UA security mode and policy are required between PLCs and the edge gateway?', expect: [/SignAndEncrypt/i, /Basic256Sha256/i], answer: 'SignAndEncrypt, Basic256Sha256', gold: [/SignAndEncrypt/i, /Basic256Sha256/i] },
  { id: 'Q17', q: 'How must firmware and OTA updates be protected?', expect: [/sign/i, /rollback/i], answer: 'Signed (code-signing cert in HSM), verified before install, anti-rollback', gold: [/OTA|firmware/i, /sign/i] },
  { id: 'Q18', q: 'Which data class is raw telemetry?', expect: [/C2|confidential/i], answer: 'C2 Confidential', gold: [/C2/, /telemetry/i] },
  { id: 'Q19', q: 'Where must device private keys be stored?', expect: [/TPM|secure element/i], answer: 'TPM / secure element', gold: [/TPM|secure element/i] },
  { id: 'Q20', q: 'Below which surge margin is a centrifugal compressor critical?', expect: [/5\s*%/], answer: '5 %', gold: [/surge margin/i, /5\s*%/i] },
  { id: 'Q21', q: 'Which suction pressure triggers the cavitation alarm on these pumps?', expect: [/0\.9/], answer: 'Below 0.9 bar', gold: [/0\.9/] },
  { id: 'Q22', q: 'Which coupling misalignment offset is critical?', expect: [/0\.2/], answer: '0.2 mm', gold: [/misalign/i, /0\.2/] },
  { id: 'Q23', q: 'What is the response SLA for a P2 work order?', expect: [/24/], answer: '24 h', gold: [/P2/, /24/] },
  { id: 'Q24', q: 'What containment action (D3) does a CAR for a P1 failure require?', expect: [/standby|reduce load/i], answer: 'Reduce load or switch to standby', gold: [/containment|D3/i, /standby|reduce load/i] },
  { id: 'Q25', q: 'How quickly must the anti-surge valve open?', expect: [/2\s*s|two seconds|2 seconds/i], answer: 'Within 2 s', gold: [/anti-surge/i, /2\s*s/i] },
  { id: 'Q26', q: 'What is the lead time of the IMP-250 impeller?', expect: [/21/], answer: '21 days', gold: [/IMP-250/, /21/] },
  { id: 'Q27', q: 'How are people referred to in prompts, memories and pull requests?', expect: [/team id|TM-\d|pseudonym/i], answer: 'Pseudonymous team id + role (TM-01 …)', gold: [/pseudonym|team id|TM-0/i] },
  { id: 'Q28', q: 'How is the edge gateway disk encrypted?', expect: [/AES-256|LUKS/i], answer: 'AES-256 (LUKS), keyed from the TPM', gold: [/AES-256|LUKS/i] },
  { id: 'Q29', q: 'Which oil temperature and particle count indicate gearbox lubrication breakdown?', expect: [/80/, /30/], answer: '> 80 °C oil, > 30 ppm particles', gold: [/80/, /30/, /oil|particle/i] },
  { id: 'Q30', q: 'Which timestamp format is the team standard?', expect: [/ISO[- ]?8601/i, /UTC/i], answer: 'ISO-8601 UTC', gold: [/ISO-?8601/i] },
];

export const EVALSET = [...QUESTIONS.map(q => ({ ...q, gold: GOLD[q.id] })), ...EXTRA];

const ANSWER_SYSTEM = `You are an ADLC engineering agent. Answer using only the context provided. Reply with one short line of JSON: {"answer": "<concise answer with exact values>"}. If the context does not contain the answer, reply {"answer": "unknown"}.`;
const JUDGE_SYSTEM = `You grade retrieved context for a question. For each numbered item give 2 if it directly contains facts needed to answer, 1 if it is related or partially useful, 0 if irrelevant. Reply with JSON only: {"ratings": [n, n, ...]} in item order.`;

const isGold = (q, text) => q.gold.every(re => re.test(text));

async function retrieve(q) {
  const [mem, kb] = await Promise.all([meko.searchMemory('studio', q.q, 8).catch(() => []), meko.searchKnowledge('studio', q.q, 4).catch(() => [])]);
  const items = [
    ...mem.filter(m => m.metadata?.kind !== 'artifact').map((m, i) => ({ source: 'memory', rank: i + 1, text: m.memory, score: m.score, raw: m.raw_similarity_score, agent: m.agent_id, kind: m.metadata?.kind ?? null, feature: m.metadata?.feature ?? null })),
    ...kb.map((k, i) => ({ source: 'knowledge', rank: i + 1, text: String(k.chunk_text ?? '').replace(/\s+/g, ' ').slice(0, 900), score: k.score ?? null, doc: k.document_name ?? k.filename ?? null })),
  ];
  for (const it of items) it.gold = isGold(q, it.text);
  return items;
}

let running = null;
export const status = () => ({ running: !!running, progress: running, result: state.retrievalEval ?? null });

async function pool(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

export async function run() {
  if (running) throw new Error('evaluation already running');
  if (!claude.enabled()) throw new Error('ANTHROPIC_API_KEY is not set');
  running = { done: 0, total: EVALSET.length, startedAt: new Date().toISOString() };
  emit('reval', status());
  try {
    const rows = await pool(EVALSET, 4, async q => {
      const items = await retrieve(q);
      const ctx = items.map((it, i) => `[${i + 1}] (${it.source}) ${it.text}`).join('\n');
      const [ans, judge] = await Promise.all([
        claude.complete({ system: ANSWER_SYSTEM, prompt: `# Context\n${ctx}\n\n# Question\n${q.q}`, maxTokens: 800, effort: 'low', agent: 'studio', label: `reval answer ${q.id}` }).catch(e => ({ text: `{"answer":"error: ${e.message}"}`, usage: { input_tokens: 0, output_tokens: 0 } })),
        items.length ? claude.complete({ system: JUDGE_SYSTEM, prompt: `# Question\n${q.q}\n\n# Items\n${ctx}`, maxTokens: 800, effort: 'low', agent: 'studio', label: `reval judge ${q.id}` }).catch(() => null) : null,
      ]);
      let ratings = [];
      try { ratings = JSON.parse(judge?.text.match(/\{[\s\S]*\}/)?.[0] ?? '{}').ratings ?? []; } catch { /* unparsed */ }
      items.forEach((it, i) => { it.judge = Number.isFinite(ratings[i]) ? ratings[i] : null; });
      const g = grade(q, ans.text);
      const memGold = items.find(it => it.source === 'memory' && it.gold)?.rank ?? null;
      const kbGold = items.find(it => it.source === 'knowledge' && it.gold)?.rank ?? null;
      const firstGold = Math.min(memGold ?? Infinity, kbGold ?? Infinity);
      running.done++;
      emit('reval', status());
      return {
        id: q.id, q: q.q, expected: q.answer, ...g,
        items, contextTokens: ans.usage.input_tokens,
        cost: claude.cost(ans.usage.input_tokens + (judge?.usage.input_tokens ?? 0), ans.usage.output_tokens + (judge?.usage.output_tokens ?? 0)),
        firstGoldRank: Number.isFinite(firstGold) ? firstGold : null, memGold, kbGold,
        grounded: g.correct && items.some(it => it.gold),
      };
    });

    const n = rows.length;
    const hitAt = k => rows.filter(r => r.firstGoldRank !== null && r.firstGoldRank <= k).length / n;
    const judged = rows.flatMap(r => r.items).filter(it => it.judge !== null);
    const summary = {
      questions: n,
      accuracy: rows.filter(r => r.correct).length / n,
      grounded: rows.filter(r => r.grounded).length / n,
      unknown: rows.filter(r => r.unknown).length,
      hitAt: [1, 2, 3, 4, 5, 6, 7, 8].map(k => ({ k, v: hitAt(k) })),
      mrr: rows.reduce((a, r) => a + (r.firstGoldRank ? 1 / r.firstGoldRank : 0), 0) / n,
      precision: judged.length ? judged.filter(it => it.judge >= 1).length / judged.length : 0,
      highlyRelevant: judged.length ? judged.filter(it => it.judge === 2).length / judged.length : 0,
      top3Precision: (() => { const t = rows.flatMap(r => r.items.filter(it => it.rank <= 3 && it.judge !== null)); return t.length ? t.filter(it => it.judge >= 1).length / t.length : 0; })(),
      avgTokens: Math.round(rows.reduce((a, r) => a + r.contextTokens, 0) / n),
      cost: rows.reduce((a, r) => a + r.cost, 0),
      scoreBuckets: bucketScores(rows.flatMap(r => r.items.filter(it => it.source === 'memory' && it.score != null))),
    };
    const result = { at: new Date().toISOString(), model: claude.model(), summary, rows };
    setState({ retrievalEval: result });
    return result;
  } finally {
    running = null;
    emit('reval', status());
  }
}

// Distribution of Meko's relevance score for items the judge rated relevant vs not.
function bucketScores(items) {
  const edges = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.01];
  return edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    const inB = items.filter(it => it.score >= lo && it.score < hi);
    return { range: `${lo.toFixed(1)}–${Math.min(1, hi).toFixed(1)}`, relevant: inB.filter(it => it.judge >= 1).length, irrelevant: inB.filter(it => it.judge === 0).length };
  });
}
