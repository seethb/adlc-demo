// "Ask the fleet" — natural-language asset condition queries (F06).
// The deterministic planner picks the slice of live state; Meko supplies the
// failure-mode knowledge and team notes; Claude writes the answer. The
// baseline is the same question answered from the whole fleet dump plus every
// knowledge document, counted but not sent.
import { parseQuery, answerFromSnapshot } from '../../edge/reference/nlq.js';
import { vibrationZone } from '../../edge/reference/anomaly.js';
import { snapshot } from './runtime.js';
import * as meko from '../live/meko.js';
import * as claude from '../live/claude.js';
import * as econ from '../adlc/economics.js';
import * as guard from '../adlc/guardrails.js';
import { KNOWLEDGE, STANDARDS } from '../seed/knowledge.js';
import { scan, redact } from '../security/privacy.js';

const SYSTEM = `You are Sage, the fleet-condition assistant for a plant's reliability team. Answer the developer's question using only the live facts and recalled knowledge provided. Lead with the direct answer, then the evidence (asset ids, metric values with units, the iso10816Zone given in the facts — never compute zones yourself — open work orders or CARs), then one recommended next step. You are read-only: never claim to close work orders, change inventory or send commands to equipment. Keep it under 140 words. Use short markdown bullets.`;

function facts(plan, snap) {
  const pick = snap.assets.filter(a => plan.resolvedAssets.includes(a.id));
  const trim = a => {
    const metrics = plan.metrics.length ? Object.fromEntries(Object.entries(a.metrics).filter(([k]) => plan.metrics.includes(k) || k === 'vibration')) : a.metrics;
    const hist = a.history.slice(-Math.min(60, Math.ceil(plan.windowSec)));
    const trend = Object.fromEntries(Object.keys(metrics).map(k => { const first = hist[0]?.[k], last = hist.at(-1)?.[k]; return [k, first !== undefined ? `${first} → ${last}` : `${last}`]; }));
    // Engineering facts are computed, not left to the model (ISO zone, health).
    return { id: a.id, name: a.name, type: a.typeLabel, line: a.line, criticality: a.criticality, health: a.health, iso10816Zone: vibrationZone(a.metrics.vibration ?? 0), metrics, trend, openAnomaly: a.openAnomaly ? { severity: a.openAnomaly.severity, failureMode: a.openAnomaly.failureMode, rule: a.openAnomaly.rule } : null };
  };
  const out = { question_plan: plan, assets: pick.map(trim) };
  if (['work_orders', 'condition', 'anomalies', 'ranking'].includes(plan.intent)) out.workOrders = snap.workOrders.filter(w => w.status !== 'closed' && plan.resolvedAssets.includes(w.assetId)).map(w => ({ id: w.id, priority: w.priority, title: w.title, status: w.status, occurrences: w.occurrences }));
  if (['car', 'condition'].includes(plan.intent)) out.cars = snap.cars.filter(c => plan.resolvedAssets.includes(c.assetId)).map(c => ({ id: c.id, trigger: c.trigger, problem: c.d2_problem, rootCause: c.d4_rootCause }));
  if (plan.intent === 'inventory') out.inventory = snap.inventory.map(i => ({ sku: i.sku, name: i.name, available: i.available, reorderPoint: i.reorderPoint, low: i.low })), out.requisitions = snap.requisitions.filter(r => r.status === 'open');
  return out;
}

export async function ask(question) {
  const raw = String(question ?? '').slice(0, 500);
  // Personal data in the question is removed before it reaches Meko or Claude.
  const piiTypes = [...new Set(scan(raw).map(f => f.type))];
  const q = piiTypes.length ? redact(raw, 'internal') : raw;
  const plan = parseQuery(q);
  const snap = snapshot(false);
  const f = facts(plan, snap);
  const [mem, kb] = await Promise.all([
    meko.searchMemory('sage', q, 6).catch(() => []),
    meko.searchKnowledge('sage', q, 3).catch(() => []),
  ]);
  const { clean, quarantined } = guard.screenMemories(mem.filter(m => m.metadata?.kind !== 'artifact'));
  const prompt = [
    `# Question\n${q}`,
    `# Live facts (edge snapshot)\n${JSON.stringify(f)}`,
    clean.length ? `# Team memory (Meko)\n${clean.map(m => `- ${m.memory}`).join('\n')}` : '',
    kb.length ? `# Knowledge (Meko)\n${kb.map(k => `- ${String(k.chunk_text ?? '').replace(/\s+/g, ' ').slice(0, 600)}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  // Conservative baseline: whole fleet state but only the last 20 points of history per asset.
  const lean = { ...snap, catalog: undefined, anomalies: snap.anomalies.slice(0, 40), assets: snap.assets.map(a => ({ ...a, history: a.history.slice(-20) })) };
  const baseline = [`# Question\n${q}`, `# Full fleet state\n${JSON.stringify(lean)}`, `# All knowledge\n${KNOWLEDGE.map(k => k.body).join('\n\n')}`, `# Standards\n${STANDARDS.join('\n')}`].join('\n\n');
  const [mekoIn, baselineIn] = await Promise.all([claude.countTokens(SYSTEM, prompt), claude.countTokens(SYSTEM, baseline)]);

  let answer, usage = { input_tokens: 0, output_tokens: 0 }, llm = false, ms = 0;
  if (claude.enabled()) {
    const r = await claude.complete({ system: SYSTEM, prompt, maxTokens: 3000, effort: 'low', agent: 'sage', label: 'ask the fleet' });
    answer = r.text; usage = r.usage; llm = true; ms = r.ms;
    meko.trackTokens('sage', 'nlq', usage, r.model);
    meko.logTurn('sage', q, answer, { kind: 'nlq', intent: plan.intent });
  } else answer = answerFromSnapshot(plan, snap);

  const entry = econ.record({ run: 'nlq', feature: 'F06', stage: 'nlq', agent: 'sage', llm, reused: false, mekoIn: usage.input_tokens || mekoIn, baselineIn, output: usage.output_tokens, recalled: clean.length, written: 0, edges: clean.filter(m => m.agent_id && m.agent_id !== 'adlc:sage').map(m => ({ from: m.agent_id.replace('adlc:', ''), to: 'sage', memoryId: m.id })) });
  return {
    question: q, privacy: { redacted: piiTypes }, answer, plan, facts: f, llm, ms,
    memories: clean.map(m => ({ agent: m.agent_id, text: m.memory, score: m.score })),
    quarantined: quarantined.length,
    knowledge: kb.map(k => ({ doc: k.document_name ?? k.filename ?? 'kb', text: String(k.chunk_text ?? '').slice(0, 280) })),
    tokens: { meko: entry.mekoIn, baseline: baselineIn, output: entry.output, costMeko: entry.costMeko, costBaseline: entry.costBaseline },
  };
}
