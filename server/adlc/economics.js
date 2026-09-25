// Token economics ledger. For every agent step we record:
//   meko      — input tokens actually sent to Claude (task + Meko recall)
//   baseline  — input tokens a memory-less agent would need for the same step
//               (the full spec tree, knowledge docs, standards and every upstream
//               artifact), measured with count_tokens but never sent
//   output    — output tokens billed (a reused artifact bills none)
// plus which recalled memories were written by other agents (reuse edges).
import { state, setState, emit } from '../core.js';
import { cost } from '../live/claude.js';

state.ledger ??= [];

export function record(entry) {
  const e = {
    at: new Date().toISOString(),
    ...entry,
    costMeko: cost(entry.mekoIn, entry.output),
    // A memory-less agent regenerates the artifact, so it pays the output too.
    costBaseline: cost(entry.baselineIn, entry.baselineOut ?? entry.output),
  };
  state.ledger.push(e);
  setState({ ledger: state.ledger });
  emit('ledger', e);
  return e;
}

export function summary() {
  const L = state.ledger;
  const sum = (arr, k) => arr.reduce((n, e) => n + (e[k] ?? 0), 0);
  const tot = {
    steps: L.length,
    llmCalls: L.filter(e => e.llm).length,
    reusedArtifacts: L.filter(e => e.reused).length,
    mekoIn: sum(L, 'mekoIn'), baselineIn: sum(L, 'baselineIn'), output: sum(L, 'output'),
    baselineOut: L.reduce((n, e) => n + (e.baselineOut ?? e.output ?? 0), 0),
    costMeko: sum(L, 'costMeko'), costBaseline: sum(L, 'costBaseline'),
    memoriesRecalled: sum(L, 'recalled'), memoriesWritten: sum(L, 'written'),
    crossAgentReuse: L.reduce((n, e) => n + (e.edges?.length ?? 0), 0),
  };
  tot.tokensSaved = tot.baselineIn + tot.baselineOut - tot.mekoIn - tot.output;
  tot.savedPct = tot.baselineIn + tot.baselineOut ? tot.tokensSaved / (tot.baselineIn + tot.baselineOut) : 0;
  tot.costSaved = tot.costBaseline - tot.costMeko;

  const group = key => Object.values(L.reduce((m, e) => {
    const k = e[key];
    m[k] ??= { key: k, steps: 0, mekoIn: 0, baselineIn: 0, output: 0, baselineOut: 0, costMeko: 0, costBaseline: 0, recalled: 0, written: 0, reused: 0 };
    const g = m[k];
    g.steps++; g.mekoIn += e.mekoIn; g.baselineIn += e.baselineIn; g.output += e.output; g.baselineOut += e.baselineOut ?? e.output;
    g.costMeko += e.costMeko; g.costBaseline += e.costBaseline; g.recalled += e.recalled ?? 0; g.written += e.written ?? 0; g.reused += e.reused ? 1 : 0;
    return m;
  }, {}));

  const edges = {};
  for (const e of L) for (const x of e.edges ?? []) { const k = `${x.from}→${x.to}`; edges[k] = (edges[k] ?? 0) + 1; }

  let cm = 0, cb = 0;
  const timeline = L.map((e, i) => ({ i: i + 1, at: e.at, label: `${e.feature ?? ''} ${e.stage}`, agent: e.agent, meko: (cm += e.costMeko), baseline: (cb += e.costBaseline), mekoTokens: e.mekoIn + e.output, baselineTokens: e.baselineIn + (e.baselineOut ?? e.output), reused: !!e.reused }));

  return {
    totals: tot,
    byAgent: group('agent'),
    byStage: group('stage'),
    byFeature: group('feature'),
    edges: Object.entries(edges).map(([k, n]) => { const [from, to] = k.split('→'); return { from, to, n }; }),
    timeline,
    recent: L.slice(-40).reverse(),
  };
}

export function reset() { state.ledger = []; setState({ ledger: [] }); emit('ledger', null); }
