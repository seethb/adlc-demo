// The ADLC orchestrator: drives one feature through six gated stages, each run
// by a different agent. Every agent recalls from and writes to the shared Meko
// datapack; every stage lands on the feature's branch and PR on GitHub.
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { ROOT, STATE_DIR, state, setState, emit, readText } from '../core.js';
import * as meko from '../live/meko.js';
import * as gh from '../live/github.js';
import * as claude from '../live/claude.js';
import { features, feature as getFeature, roster, gates, agent as getAgent } from './specs.js';
import * as guard from './guardrails.js';
import * as econ from './economics.js';
import { SYSTEM, task, parseOutput, parseReview } from './prompts.js';
import { KNOWLEDGE, STANDARDS } from '../seed/knowledge.js';

const run$ = promisify(execFile);
const sha = t => createHash('sha256').update(t).digest('hex').slice(0, 12);
const STAGES = ['plan', 'design', 'develop', 'test', 'review', 'deploy'];

state.runs ??= {};
state.artifacts ??= {};
state.deployments ??= {};
state.settings ??= { autoApprove: false, useArtifactCache: true, concurrency: 2 };
export const settings = state.settings;
const approvals = new Map();
const active = new Set();

// Runs interrupted by a restart are marked so the UI can offer a retry.
for (const r of Object.values(state.runs)) if (['running', 'queued'].includes(r.status)) { r.status = 'interrupted'; for (const s of Object.values(r.stages)) if (['running', 'awaiting_approval'].includes(s.status)) s.status = 'interrupted'; }

const ownerOf = f => roster().agents.find(a => a.stages.includes('develop') && a.features.includes(f.id));
const stageAgent = (stage, f) => (stage === 'develop' ? ownerOf(f) : getAgent(gates().stages.find(s => s.id === stage).agent));

function save(run) { state.runs[run.id] = run; setState({ runs: state.runs }); emit('run', run); }
function stageUpdate(run, stage, patch) { Object.assign(run.stages[stage], patch); save(run); }
function event(run, stage, message, level = 'info') {
  run.log.push({ at: new Date().toISOString(), stage, message, level });
  if (run.log.length > 200) run.log.shift();
  save(run);
}

export function listRuns() { return Object.values(state.runs).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export const getRun = id => state.runs[id];

// ---- Meko recall ---------------------------------------------------------------

const STAGE_QUERY = {
  plan: 'user stories acceptance criteria scope risks definition of done',
  design: 'contract data shapes module design architecture decisions security data classification',
  develop: 'implementation rules coding standards imports identifiers severity priority',
  review: 'security review checklist secrets OT write telemetry validation transport encryption certificates',
};

async function recall(agent, f, stage) {
  const deps = f.depends.map(d => getFeature(d)).filter(Boolean);
  const queries = [
    `${f.id} ${f.title}: ${STAGE_QUERY[stage] ?? stage}`,
    deps.length ? `${deps.map(d => `${d.id} ${d.title}`).join(', ')} contract shape decisions` : `org standards ${STAGE_QUERY[stage] ?? ''}`,
  ];
  if (stage === 'review' || stage === 'design') queries.push('IoT security standard transport security data classification');
  const [lists, kb] = await Promise.all([
    Promise.all(queries.map(q => meko.searchMemory(agent.id, q, 8))),
    meko.searchKnowledge(agent.id, `${f.title} ${STAGE_QUERY[stage] ?? ''}`, stage === 'review' ? 5 : 4),
  ]);
  const byId = new Map();
  for (const m of lists.flat()) if (m?.id && m.metadata?.kind !== 'artifact' && !byId.has(m.id)) byId.set(m.id, m);
  const all = [...byId.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 12);
  const { clean, quarantined } = guard.screenMemories(all);
  return { memories: clean, quarantined, kb };
}

async function cachedArtifact(agent, f, stage, upstreamHash) {
  if (!settings.useArtifactCache) return null;
  const hits = await meko.searchMemory(agent.id, `ARTIFACT ${f.id} ${stage} spec ${f.specHash}`, 10);
  const hit = hits.find(m => m.metadata?.kind === 'artifact' && m.metadata.feature === f.id && m.metadata.stage === stage && m.metadata.specHash === f.specHash && (m.metadata.upstream ?? '') === (upstreamHash ?? ''));
  if (!hit) return null;
  const text = await meko.getArtifact(agent.id, hit.metadata.contentHash).catch(() => null);
  return text ? { text, memory: hit } : null;
}

// ---- context ---------------------------------------------------------------------

const fmtMemory = m => `- [${m.agent_id ?? 'unknown'}${m.metadata?.kind ? ` · ${m.metadata.kind}` : ''}${m.metadata?.feature && m.metadata.feature !== '*' ? ` · ${m.metadata.feature}/${m.metadata.stage}` : ''}] ${m.memory}`;
const fmtKb = k => `- (${k.document_name ?? k.filename ?? k.source ?? 'kb'}) ${String(k.chunk_text ?? k.text ?? k.content ?? '').replace(/\s+/g, ' ').slice(0, 700)}`;

function mekoPrompt(taskText, f, ctx, upstream) {
  return [
    `# Task\n${taskText}`,
    `# Feature spec (source of truth)\n${f.spec}`,
    ctx.memories.length ? `# Shared team memory recalled from Meko (datapack iot-edge-adlc)\n${ctx.memories.map(fmtMemory).join('\n')}` : '',
    ctx.kb.length ? `# Knowledge recalled from Meko\n${ctx.kb.map(fmtKb).join('\n')}` : '',
    upstream ? `# Upstream artifact\n${upstream}` : '',
  ].filter(Boolean).join('\n\n');
}

function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walk(rel, exts));
    else if (exts.some(e => name.endsWith(e)) && !name.includes('.acceptance.test')) out.push(rel);
  }
  return out;
}

// What an agent without shared memory has to read to make the same decisions:
// every spec and design doc, the domain and security knowledge, the standards
// wiki, and every artifact the team has produced so far for this feature and
// its dependencies.
function baselinePrompt(taskText, f, stage) {
  const specs = walk('specs', ['.md', '.json']).map(p => `## ${p}\n${readText(p)}`).join('\n\n');
  const kb = KNOWLEDGE.map(k => `## ${k.file}\n${k.body}`).join('\n\n');
  const wiki = STANDARDS.map(s => `- ${s}`).join('\n');
  const upstream = [f.id, ...f.depends].flatMap(fid => Object.entries(state.artifacts[fid] ?? {})
    .filter(([s]) => fid !== f.id || STAGES.indexOf(s) < STAGES.indexOf(stage))
    .map(([s, a]) => `## ${fid} ${s} artifact\n${a.text}`)).join('\n\n');
  return [`# Task\n${taskText}`, `# Project specs\n${specs}`, `# Knowledge base\n${kb}`, `# Team standards wiki\n${wiki}`, upstream ? `# Team artifacts so far\n${upstream}` : ''].filter(Boolean).join('\n\n');
}

// ---- one agent step: recall → (reuse | LLM) → remember -----------------------------

async function agentStep(run, stage, f, agent, { upstream, upstreamHash, extra, code = false, maxTokens = 8000, effort = 'low', allowCache = true }) {
  const taskText = task(stage, f, extra);
  const ctx = await recall(agent, f, stage);
  event(run, stage, `${agent.name} recalled ${ctx.memories.length} memories and ${ctx.kb.length} knowledge chunks from Meko${ctx.quarantined.length ? ` (${ctx.quarantined.length} quarantined)` : ''}`);
  const system = SYSTEM[stage];
  const prompt = mekoPrompt(taskText, f, ctx, upstream);
  const [mekoIn, baselineIn] = await Promise.all([claude.countTokens(system, prompt), claude.countTokens(system, baselinePrompt(taskText, f, stage))]);

  let out, usage = { input_tokens: 0, output_tokens: 0 }, reused = false, llm = false, ms = 0;
  const cached = allowCache && !extra?.failures ? await cachedArtifact(agent, f, stage, upstreamHash) : null;
  if (cached) {
    reused = true;
    out = { artifact: cached.text, decisions: [] };
    event(run, stage, `♻️ ${agent.name} reused artifact ${cached.memory.metadata.contentHash.slice(0, 10)} from Meko — spec unchanged, no LLM call`);
  } else {
    if (!claude.enabled()) throw new Error('ANTHROPIC_API_KEY is not set — cannot generate a new artifact');
    event(run, stage, `${agent.name} is calling ${claude.model()} with ${mekoIn.toLocaleString()} input tokens (a memory-less agent would need ${baselineIn.toLocaleString()})`);
    const res = await claude.complete({ system, prompt, maxTokens, effort, agent: agent.id, label: `${f.id} ${stage}` });
    llm = true; usage = res.usage; ms = res.ms;
    out = stage === 'review' ? parseReview(res.text) : parseOutput(res.text);
    if (code && !out.artifact.includes('export')) out.artifact = res.text.replace(/<decisions>[\s\S]*$/, '').trim() + '\n';
    meko.trackTokens(agent.id, `${f.id}-${stage}`, usage, res.model);
    meko.logTurn(agent.id, `${f.id} ${stage}: ${taskText.slice(0, 1500)}`, (out.artifact ?? out.summary ?? '').slice(0, 3000), { feature: f.id, stage, run: run.id });
  }

  const outTok = usage.output_tokens || (await claude.countTokens('', out.artifact ?? JSON.stringify(out)));
  const edges = ctx.memories.filter(m => m.agent_id && m.agent_id !== `adlc:${agent.id}`).map(m => ({ from: m.agent_id.replace('adlc:', ''), to: agent.id, memoryId: m.id }));
  const entry = econ.record({ run: run.id, feature: f.id, stage, agent: agent.id, llm, reused, mekoIn: reused ? 0 : usage.input_tokens || mekoIn, baselineIn, output: reused ? 0 : outTok, baselineOut: outTok, recalled: ctx.memories.length, written: 0, edges });

  return { ...out, ctx, usage, reused, llm, ms, mekoIn, baselineIn, entry };
}

async function remember(run, stage, f, agent, decisions, artifactText, upstreamHash, contentType = 'text/markdown') {
  let written = 0;
  for (const d of decisions) {
    const check = guard.run(['secret-scan'], { text: d })[0];
    if (!check.pass) { event(run, stage, `Blocked a decision from Meko: ${check.detail}`, 'warn'); continue; }
    await meko.addMemory(agent.id, d, { kind: 'decision', feature: f.id, stage, run: run.id });
    written++;
  }
  if (artifactText) {
    const put = await meko.putArtifact(agent.id, `${f.slug}-${stage}${contentType === 'text/markdown' ? '.md' : '.js'}`, artifactText, contentType);
    await meko.addMemory(agent.id, `ARTIFACT ${f.id} ${stage} spec ${f.specHash}: ${agent.name}'s ${stage} output for ${f.title}, content hash ${put.content_hash}.`, { kind: 'artifact', feature: f.id, stage, specHash: f.specHash, upstream: upstreamHash ?? '', contentHash: put.content_hash, run: run.id });
    written++;
  }
  const last = state.ledger.findLast(e => e.run === run.id && e.stage === stage);
  if (last) { last.written = written; setState({ ledger: state.ledger }); }
  event(run, stage, `${agent.name} wrote ${written} memor${written === 1 ? 'y' : 'ies'} to Meko for the team`);
  return written;
}

function storeArtifact(f, stage, text, run) {
  state.artifacts[f.id] ??= {};
  state.artifacts[f.id][stage] = { text, hash: sha(text), run: run.id, at: new Date().toISOString() };
  setState({ artifacts: state.artifacts });
}

// ---- GitHub reporting --------------------------------------------------------------

const icon = r => (r.pass ? '✅' : r.severity === 'warn' ? '⚠️' : '❌');
function gateComment(run, stage, agent, gate, step, extraMd = '') {
  const g = gates().stages.find(s => s.id === stage);
  const rows = gate.guardrails.map(r => `| ${icon(r)} | \`${r.id}\` | ${r.detail} |`).join('\n');
  const evals = gate.evals.map(e => `| ${e.pass ? '✅' : '❌'} | \`${e.id}\` | ${e.value} (threshold ${e.threshold}) | ${e.detail ?? ''} |`).join('\n');
  const tok = step ? `\n**Meko token economics** — sent **${step.entry.mekoIn.toLocaleString()}** input tokens; a memory-less agent needs **${step.entry.baselineIn.toLocaleString()}** (−${Math.round((1 - (step.entry.mekoIn || 0) / Math.max(1, step.entry.baselineIn)) * 100)}%). ${step.reused ? '♻️ Artifact reused from Meko — no LLM call.' : `Output ${step.entry.output.toLocaleString()} tokens.`} Recalled ${step.ctx.memories.length} memories (${step.entry.edges.length} written by other agents) · ${step.ctx.kb.length} knowledge chunks.\n` : '';
  const recalled = step?.ctx.memories.length ? `\n<details><summary>Memories recalled from Meko</summary>\n\n${step.ctx.memories.slice(0, 10).map(m => `- \`${m.agent_id}\` ${m.memory.slice(0, 180)}`).join('\n')}\n</details>\n` : '';
  return `### ${gate.pass ? '🟢' : '🔴'} ${g.gate} — ${g.label} by **${agent.name}** (${agent.role}, owner: ${agent.owner})
${tok}
| | Guardrail | Result |
|---|---|---|
${rows || '| – | – | – |'}
${gate.evals.length ? `\n| | Eval | Score | Detail |\n|---|---|---|---|\n${evals}\n` : ''}${extraMd}${recalled}
<sub>ADLC run \`${run.id}\` · ${new Date().toISOString()}</sub>`;
}

async function publishStatus(run, context, stateName, description, agent) {
  run.statuses[context] = { state: stateName, description };
  save(run);
  if (!run.headSha) return;
  await gh.status(run.headSha, context, stateName, description, agent, run.prUrl);
}

// Statuses attach to a commit, so each new head commit gets the earlier
// stage statuses re-posted before its own.
async function carryStatuses(run, agent) {
  for (const [ctx, s] of Object.entries(run.statuses)) await gh.status(run.headSha, ctx, s.state, s.description, agent, run.prUrl);
}

async function commit(run, files, message, agent) {
  run.headSha = await gh.commitFiles(run.branch, files, message, agent);
  run.commits.push({ sha: run.headSha, message: message.split('\n')[0], agent: agent.id, files: files.map(f => f.path) });
  save(run);
  await carryStatuses(run, agent);
}

async function setStageLabel(run, stage) {
  if (!run.pr) return;
  if (run.stageLabel) await gh.removeLabel(run.pr, run.stageLabel);
  run.stageLabel = `stage:${stage}`;
  await gh.labels(run.pr, [run.stageLabel]);
}

// ---- gates -------------------------------------------------------------------------

function evalResult(id, value, detail) {
  const threshold = gates().evals[id]?.threshold ?? 1;
  return { id, value: Math.round(value * 1000) / 1000, threshold, pass: value >= threshold, detail };
}

function specCompleteness(md) {
  const rubric = [/user stor/i, /AC-F\d\d-\d/, /non-goal/i, /risk/i, /telemetry|eval/i, /definition of done/i, /depend/i, /contract|export/i];
  const hit = rubric.filter(r => r.test(md)).length;
  return evalResult('spec-completeness', hit / rubric.length, `${hit}/${rubric.length} rubric sections present`);
}

const acCoverage = (md, f) => {
  const covered = f.acs.filter(a => md.includes(a.id)).length;
  return evalResult('ac-coverage', covered / f.acs.length, `${covered}/${f.acs.length} ACs mapped`);
};

async function contractExports(file, f) {
  try {
    const { stdout } = await run$(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify('file://' + file)}); console.log(JSON.stringify(Object.keys(m).filter(k => typeof m[k] === 'function')))`], { timeout: 20000 });
    const got = JSON.parse(stdout.trim());
    const have = f.exports.filter(e => got.includes(e)).length;
    return evalResult('contract-exports', have / f.exports.length, `exports ${got.join(', ') || 'nothing'}`);
  } catch (e) { return evalResult('contract-exports', 0, `import failed: ${String(e.stderr || e.message).split('\n')[0].slice(0, 160)}`); }
}

function workFile(run, f) {
  const dir = path.join(STATE_DIR, 'work', run.id, 'edge');
  mkdirSync(path.join(dir, 'reference'), { recursive: true });
  mkdirSync(path.join(dir, 'features', f.slug), { recursive: true });
  copyFileSync(path.join(ROOT, 'edge/reference/fleet.js'), path.join(dir, 'reference/fleet.js'));
  return path.join(dir, 'features', f.slug, 'index.js');
}

async function acceptance(file, f) {
  let out = '';
  try {
    const r = await run$(process.execPath, ['--test', '--test-reporter=tap', path.join(ROOT, f.testFile)], { env: { ...process.env, ADLC_IMPL: file }, timeout: 90000, cwd: ROOT, maxBuffer: 8 << 20 });
    out = r.stdout;
  } catch (e) { out = (e.stdout ?? '') + (e.killed ? '\n# timed out' : ''); }
  const tests = [...out.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map(m => ({ ok: m[1] === 'ok', name: m[2].replace(/^\[[^\]]+\]\s*/, ''), ac: (m[2].match(/AC-F\d\d-\d+/) ?? [])[0] }));
  const failures = [...out.matchAll(/^not ok \d+ - (.+)$[\s\S]*?error: ([^\n]+)/gm)].map(m => `${m[1].replace(/^\[[^\]]+\]\s*/, '')}: ${m[2].replace(/^['"]|['"]$/g, '')}`);
  const passed = tests.filter(t => t.ok).length;
  return { tests, passed, total: tests.length, failures, rate: tests.length ? passed / tests.length : 0 };
}

async function behavioural(file, f) {
  try {
    const { stdout } = await run$(process.execPath, [path.join(ROOT, 'scripts/behavioural.js'), f.id, file], { timeout: 90000, cwd: ROOT });
    return JSON.parse(stdout.trim().split('\n').pop());
  } catch (e) { return { score: 0, metrics: {}, detail: `eval failed: ${String(e.stderr || e.message).split('\n')[0].slice(0, 160)}` }; }
}

// ---- stages ------------------------------------------------------------------------

async function stagePlan(run, f) {
  const agent = stageAgent('plan', f);
  const step = await agentStep(run, 'plan', f, agent, { maxTokens: 6000 });
  const file = `specs/features/${f.slug}/plan.md`;
  const gate = { guardrails: guard.run(agent.guardrails.filter(g => g !== 'memory-provenance'), { text: step.artifact, feature: f, agent, tokens: step.mekoIn }).concat(guard.run(['memory-provenance', 'prompt-injection'], { memories: step.ctx.memories })), evals: [specCompleteness(step.artifact)] };
  gate.pass = !guard.blocking(gate.guardrails).length && gate.evals.every(e => e.pass);
  storeArtifact(f, 'plan', step.artifact, run);

  await gh.createBranch(run.branch, 'main', agent);
  await commit(run, [{ path: file, content: step.artifact }], `plan(${f.id}): ${f.title} — user stories and AC traceability\n\nRefs: ${f.acs.map(a => a.id).join(', ')}`, agent);
  const pr = await gh.openPR({ head: run.branch, title: `[${f.id}] ${f.title}`, body: prBody(run, f) }, agent);
  Object.assign(run, { pr: pr.number, prUrl: pr.html_url });
  save(run);
  await gh.labels(pr.number, ['adlc', `feature:${f.id}`]);
  await setStageLabel(run, 'plan');
  await gh.comment(pr.number, gateComment(run, 'plan', agent, gate, step), agent);
  await publishStatus(run, 'adlc/spec', gate.pass ? 'success' : 'failure', `G1 ${gate.pass ? 'passed' : 'failed'} · spec completeness ${gate.evals[0].value}`, agent);
  if (gate.pass) await remember(run, 'plan', f, agent, step.decisions, step.reused ? null : step.artifact);
  return { gate, step, file };
}

async function stageDesign(run, f) {
  const agent = stageAgent('design', f);
  const plan = state.artifacts[f.id]?.plan;
  const step = await agentStep(run, 'design', f, agent, { upstream: plan?.text, upstreamHash: plan?.hash, maxTokens: 8000 });
  const file = `specs/features/${f.slug}/design.md`;
  const gate = { guardrails: guard.run(agent.guardrails.filter(g => g !== 'memory-provenance'), { text: step.artifact, feature: f, agent, tokens: step.mekoIn }).concat(guard.run(['memory-provenance', 'prompt-injection'], { memories: step.ctx.memories })), evals: [acCoverage(step.artifact, f)] };
  // The design discusses imports in prose; the allowlist is enforced on code at G3.
  gate.guardrails = gate.guardrails.map(r => (r.id === 'dependency-allowlist' && !r.pass ? { ...r, severity: 'warn' } : r));
  gate.pass = !guard.blocking(gate.guardrails).length && gate.evals.every(e => e.pass);
  storeArtifact(f, 'design', step.artifact, run);
  await setStageLabel(run, 'design');
  await commit(run, [{ path: file, content: step.artifact }], `design(${f.id}): module design, contract shapes, AC mapping\n\nReused ${step.entry.edges.length} team decisions from Meko`, agent);
  await gh.comment(run.pr, gateComment(run, 'design', agent, gate, step), agent);
  await publishStatus(run, 'adlc/design', gate.pass ? 'success' : 'failure', `G2 ${gate.pass ? 'passed' : 'failed'} · AC coverage ${gate.evals[0].value}`, agent);
  if (gate.pass) await remember(run, 'design', f, agent, step.decisions, step.reused ? null : step.artifact, plan?.hash);
  return { gate, step, file };
}

async function stageDevelop(run, f) {
  const agent = stageAgent('develop', f);
  const design = state.artifacts[f.id]?.design;
  const lessons = run.stages.test?.failures?.length ? run.stages.test.failures.join('\n') : null;
  let step = await agentStep(run, 'develop', f, agent, { upstream: design?.text, upstreamHash: design?.hash, code: true, maxTokens: 16000, effort: 'medium', extra: lessons ? { failures: lessons } : undefined });
  const file = workFile(run, f);
  writeFileSync(file, step.artifact);

  // Self-check against the acceptance suite before committing; one repair pass.
  let pre = await acceptance(file, f);
  event(run, 'develop', `${agent.name} self-check: ${pre.passed}/${pre.total} acceptance tests pass`);
  if (pre.rate < 1 && claude.enabled()) {
    event(run, 'develop', `${agent.name} is repairing ${pre.total - pre.passed} failing test(s)`, 'warn');
    const repair = await agentStep(run, 'develop', f, agent, { upstream: `${design?.text ?? ''}\n\n# Your previous module\n${step.artifact}`, code: true, maxTokens: 16000, effort: 'medium', extra: { failures: pre.failures.join('\n') || 'see acceptance criteria' }, allowCache: false });
    writeFileSync(file, repair.artifact);
    const again = await acceptance(file, f);
    event(run, 'develop', `${agent.name} after repair: ${again.passed}/${again.total} acceptance tests pass`);
    if (again.rate >= pre.rate) { step = { ...repair, decisions: [...step.decisions, ...repair.decisions].slice(0, 5) }; pre = again; } else writeFileSync(file, step.artifact);
  }

  const files = [f.module];
  const code = step.artifact;
  const gate = {
    guardrails: guard.run(agent.guardrails, { text: code, files, feature: f, agent, tokens: step.mekoIn }).concat(guard.run(['tests-immutable'], { files, agent }), guard.run(['prompt-injection'], { memories: step.ctx.memories })),
    evals: [await contractExports(file, f)],
  };
  gate.pass = !guard.blocking(gate.guardrails).length && gate.evals.every(e => e.pass);
  storeArtifact(f, 'develop', code, run);
  await setStageLabel(run, 'develop');
  await commit(run, [{ path: f.module, content: code }], `feat(${f.id}): implement ${f.exports.join(', ')}\n\nImplements ${f.acs.map(a => a.id).join(', ')}\nAgent self-check: ${pre.passed}/${pre.total} acceptance tests`, agent);
  await gh.comment(run.pr, gateComment(run, 'develop', agent, gate, step), agent);
  await publishStatus(run, 'adlc/build', gate.pass ? 'success' : 'failure', `G3 ${gate.pass ? 'passed' : 'failed'} · ${gate.guardrails.filter(g => g.pass).length}/${gate.guardrails.length} guardrails`, agent);
  if (gate.pass) await remember(run, 'develop', f, agent, step.decisions, step.reused ? null : code, design?.hash, 'text/javascript');
  return { gate, step, file, precheck: pre };
}

async function stageTest(run, f) {
  const agent = stageAgent('test', f);
  const file = workFile(run, f);
  writeFileSync(file, state.artifacts[f.id].develop.text);
  const acc = await acceptance(file, f);
  const beh = await behavioural(file, f);
  const gate = {
    guardrails: guard.run(['tests-immutable'], { files: [f.module], agent }),
    evals: [evalResult('acceptance-pass-rate', acc.rate, `${acc.passed}/${acc.total} acceptance tests`), evalResult('behavioural', beh.score, beh.detail)],
  };
  gate.pass = !guard.blocking(gate.guardrails).length && gate.evals.every(e => e.pass);
  const table = `\n| | Acceptance criterion | Result |\n|---|---|---|\n${acc.tests.map(t => `| ${t.ok ? '✅' : '❌'} | ${t.ac ?? ''} | ${t.name.replace(/^AC-F\d\d-\d+\s*/, '')} |`).join('\n')}\n\n**Behavioural eval:** ${beh.detail}\n`;
  econ.record({ run: run.id, feature: f.id, stage: 'test', agent: agent.id, llm: false, reused: false, mekoIn: 0, baselineIn: 0, output: 0, recalled: 0, written: 0, edges: [] });
  const report = `# ${f.id} test report\n\nRun ${run.id} · ${new Date().toISOString()}\n${table}`;
  await setStageLabel(run, 'test');
  await commit(run, [{ path: `specs/features/${f.slug}/test-report.md`, content: report }], `test(${f.id}): ${acc.passed}/${acc.total} acceptance · behavioural ${beh.score}`, agent);
  await gh.comment(run.pr, gateComment(run, 'test', agent, gate, null, table), agent);
  await publishStatus(run, 'adlc/test', gate.pass ? 'success' : 'failure', `G4 ${gate.pass ? 'passed' : 'failed'} · ${acc.passed}/${acc.total} ACs · ${beh.detail}`, agent);
  const lesson = gate.pass
    ? `Test result ${f.id}: ${agent.name} verified ${acc.passed}/${acc.total} acceptance tests and behavioural eval (${beh.detail}) for ${f.module}.`
    : `Test lesson ${f.id}: failing acceptance tests for ${f.module} — ${acc.failures.slice(0, 3).join(' | ').slice(0, 400)}. Fix these before resubmitting.`;
  await meko.addMemory(agent.id, lesson, { kind: gate.pass ? 'test-result' : 'lesson', feature: f.id, stage: 'test', run: run.id });
  return { gate, acceptance: acc, behavioural: beh, failures: acc.failures };
}

async function stageReview(run, f) {
  const agent = stageAgent('review', f);
  const code = state.artifacts[f.id].develop.text;
  const t = run.stages.test;
  const step = await agentStep(run, 'review', f, agent, { upstream: `\`\`\`js\n${code}\n\`\`\``, extra: { testSummary: `${t.acceptance?.passed}/${t.acceptance?.total} acceptance tests; ${t.behavioural?.detail}` }, maxTokens: 6000, allowCache: false });
  const judge = { score: step.score, summary: step.summary, findings: step.findings };
  const blockingFindings = judge.findings.filter(x => ['high', 'critical'].includes(String(x.severity).toLowerCase()));
  const gate = {
    guardrails: guard.run(['secret-scan', 'plaintext-transport', 'ot-write-prohibited'], { text: code }).concat(guard.run(['prompt-injection', 'memory-provenance'], { memories: step.ctx.memories }), guard.run(['token-budget'], { tokens: step.mekoIn, agent })),
    evals: [evalResult('llm-judge', judge.score, judge.summary.slice(0, 140))],
  };
  gate.pass = !guard.blocking(gate.guardrails).length && gate.evals.every(e => e.pass) && !blockingFindings.length;
  const findingsMd = judge.findings.length ? `\n**Findings**\n${judge.findings.map(x => `- **${x.severity}** — ${x.title}: ${x.detail}`).join('\n')}\n` : '\n**Findings:** none\n';
  await setStageLabel(run, 'review');
  await gh.review(run.pr, `${gateComment(run, 'review', agent, gate, step, `\n> ${judge.summary}\n${findingsMd}`)}`, agent);
  await publishStatus(run, 'adlc/review', gate.pass ? 'success' : 'failure', `G5 ${gate.pass ? 'passed' : 'failed'} · judge ${judge.score} · ${blockingFindings.length} blocking finding(s)`, agent);
  await remember(run, 'review', f, agent, step.decisions ?? [], null);
  return { gate, step, judge, blockingFindings };
}

async function stageDeploy(run, f) {
  const agent = stageAgent('deploy', f);
  await setStageLabel(run, 'deploy');
  let approval = null;
  if (settings.autoApprove) approval = { by: 'auto-approve (demo setting)', at: new Date().toISOString() };
  else {
    stageUpdate(run, 'deploy', { status: 'awaiting_approval' });
    event(run, 'deploy', `Waiting for a human approval (owner ${ownerOf(f)?.owner ?? 'release manager'} or release manager)`);
    await gh.comment(run.pr, `### ⏸️ G6 · Release gate — waiting for human approval\nAll automated gates are green. **${ownerOf(f)?.owner}** (feature owner) or the release manager must approve in the ADLC Studio before Helm merges and deploys.`, agent);
    approval = await new Promise(resolve => approvals.set(run.id, resolve));
    approvals.delete(run.id);
    stageUpdate(run, 'deploy', { status: 'running' });
  }
  if (approval?.rejected) {
    const gate = { pass: false, guardrails: guard.run(['human-approval'], { approval: null }), evals: [] };
    await gh.comment(run.pr, `### 🛑 Release rejected by ${approval.by}\n${approval.note ?? ''}`, agent);
    await publishStatus(run, 'adlc/release', 'failure', `G6 rejected by ${approval.by}`, agent);
    return { gate, approval };
  }
  const statuses = await gh.combinedStatus(run.headSha);
  const gate = { guardrails: guard.run(['all-checks-green', 'human-approval'], { statuses, approval }), evals: [] };
  gate.pass = !guard.blocking(gate.guardrails).length;
  if (!gate.pass) {
    await gh.comment(run.pr, gateComment(run, 'deploy', agent, gate, null), agent);
    return { gate, approval };
  }
  await publishStatus(run, 'adlc/release', 'success', `G6 passed · approved by ${approval.by}`, agent);
  await gh.comment(run.pr, gateComment(run, 'deploy', agent, gate, null, `\nMerging with squash and deploying to **edge-staging**.\n`), agent);
  const merged = await gh.merge(run.pr, `${f.id}: ${f.title} (#${run.pr})`, agent);
  const dep = await gh.deploy(merged.sha, 'edge-staging', `${f.id} ${f.title} — shipped by ${ownerOf(f)?.name}`, agent);
  await gh.labels(run.pr, ['adlc:deployed']);
  state.deployments[f.id] = { run: run.id, pr: run.pr, prUrl: run.prUrl, sha: merged.sha, deploymentId: dep.id, at: new Date().toISOString(), agent: ownerOf(f)?.id, approvedBy: approval.by };
  setState({ deployments: state.deployments });
  emit('deployments', state.deployments);
  await meko.addMemory(agent.id, `Release ${f.id}: ${f.title} merged in PR #${run.pr} (${merged.sha.slice(0, 7)}) and deployed to edge-staging; ${f.module} is now the live implementation of ${f.exports.join(', ')}.`, { kind: 'release', feature: f.id, stage: 'deploy', run: run.id });
  econ.record({ run: run.id, feature: f.id, stage: 'deploy', agent: agent.id, llm: false, reused: false, mekoIn: 0, baselineIn: 0, output: 0, recalled: 0, written: 1, edges: [] });
  syncLocal();
  return { gate, approval, merged: merged.sha, deployment: dep.id };
}

// Bring merged agent code into the local checkout when it is clean.
function syncLocal() {
  execFile('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT }, (e, out) => {
    if (e || out.trim()) return;
    execFile('git', ['pull', '--ff-only', '--quiet'], { cwd: ROOT }, () => emit('features', features().map(x => ({ id: x.id, agentBuilt: x.agentBuilt }))));
  });
}

function prBody(run, f) {
  const a = ownerOf(f);
  return `## ${f.id} · ${f.title}

Spec: [\`${f.specFile}\`](../blob/main/${f.specFile}) · owner agent **${a?.name}** (${a?.role}) · human owner **${a?.owner}**

This PR is driven by the ADLC Studio. Each stage below is run by a different agent, recalls shared context from the **Meko** datapack \`iot-edge-adlc\`, and must pass its gate before the next starts.

| Stage | Agent | Gate | Status context |
|---|---|---|---|
${gates().stages.map(s => `| ${s.label} | ${s.id === 'develop' ? a?.name : getAgent(s.agent)?.name} | ${s.gate} | \`${s.status}\` |`).join('\n')}

### Acceptance criteria
${f.acs.map(x => `- [ ] **${x.id}** ${x.text}`).join('\n')}

<sub>Run \`${run.id}\`</sub>`;
}

// ---- runner ------------------------------------------------------------------------

const RUNNERS = { plan: stagePlan, design: stageDesign, develop: stageDevelop, test: stageTest, review: stageReview, deploy: stageDeploy };

export function createRun(featureId, { from = 'plan', parent } = {}) {
  const f = getFeature(featureId);
  if (!f) throw new Error(`unknown feature ${featureId}`);
  const id = `${f.id.toLowerCase()}-${Date.now().toString(36)}`;
  const prev = parent ? state.runs[parent] : null;
  const run = {
    id, feature: f.id, title: f.title, slug: f.slug, createdAt: new Date().toISOString(), status: 'queued',
    branch: prev?.branch ?? `adlc/${f.slug}-${id.split('-').pop()}`, pr: prev?.pr ?? null, prUrl: prev?.prUrl ?? null, headSha: prev?.headSha ?? null,
    statuses: prev ? { ...prev.statuses } : {}, commits: prev?.commits ?? [], stageLabel: prev?.stageLabel,
    stages: Object.fromEntries(STAGES.map(s => [s, prev && STAGES.indexOf(s) < STAGES.indexOf(from) ? { ...prev.stages[s] } : { status: 'pending', agent: stageAgent(s, f)?.id }])),
    log: [], from,
  };
  if (prev) { prev.status = 'superseded'; save(prev); }
  save(run);
  return run;
}

export async function execute(run) {
  const f = getFeature(run.feature);
  active.add(run.id);
  run.status = 'running';
  save(run);
  try {
    for (const stage of STAGES.slice(STAGES.indexOf(run.from))) {
      const t0 = Date.now();
      stageUpdate(run, stage, { status: 'running', startedAt: new Date().toISOString() });
      event(run, stage, `${gates().stages.find(s => s.id === stage).label} started by ${stageAgent(stage, f).name}`);
      const res = await RUNNERS[stage](run, f);
      const s = {
        status: res.gate.pass ? 'passed' : 'failed', durationMs: Date.now() - t0, gate: { pass: res.gate.pass, guardrails: res.gate.guardrails, evals: res.gate.evals },
        tokens: res.step ? { meko: res.step.entry.mekoIn, baseline: res.step.entry.baselineIn, output: res.step.entry.output, reused: res.step.reused, llm: res.step.llm } : null,
        recalled: res.step?.ctx.memories.map(m => ({ id: m.id, agent: m.agent_id, text: m.memory, kind: m.metadata?.kind, score: m.score })) ?? [],
        kb: res.step?.ctx.kb.map(k => ({ doc: k.document_name ?? k.filename ?? 'kb', text: String(k.chunk_text ?? '').slice(0, 300) })) ?? [],
        decisions: res.step?.decisions ?? [], artifact: res.step?.artifact?.slice?.(0, 20000) ?? null,
        acceptance: res.acceptance, behavioural: res.behavioural, failures: res.failures, judge: res.judge, approval: res.approval, precheck: res.precheck,
      };
      stageUpdate(run, stage, s);
      event(run, stage, `${gates().stages.find(x => x.id === stage).gate} ${res.gate.pass ? 'passed' : 'FAILED'}`, res.gate.pass ? 'success' : 'error');
      if (!res.gate.pass) { run.status = 'failed'; run.failedStage = stage; save(run); return run; }
    }
    run.status = 'deployed';
    save(run);
  } catch (e) {
    const stage = STAGES.find(s => run.stages[s].status === 'running' || run.stages[s].status === 'awaiting_approval') ?? 'plan';
    stageUpdate(run, stage, { status: 'error', error: e.message });
    event(run, stage, `Error: ${e.message}`, 'error');
    run.status = 'error';
    save(run);
  } finally { active.delete(run.id); }
  return run;
}

export function start(featureId, opts) {
  const run = createRun(featureId, opts);
  execute(run);
  return run;
}

// Retry from a stage on the same branch/PR. A failed test sends the work back
// to the developer, who recalls the failure lesson from Meko.
export function retry(runId, from) {
  const prev = state.runs[runId];
  if (!prev) throw new Error('unknown run');
  const stage = from ?? (prev.failedStage === 'test' || prev.failedStage === 'review' ? 'develop' : prev.failedStage ?? 'plan');
  const run = createRun(prev.feature, { from: stage, parent: runId });
  if (stage === 'develop' && prev.stages.test?.failures) run.stages.test = { status: 'pending', failures: prev.stages.test.failures, agent: prev.stages.test.agent };
  save(run);
  execute(run);
  return run;
}

export function approve(runId, { by, note, reject = false }) {
  const resolve = approvals.get(runId);
  if (!resolve) throw new Error('run is not waiting for approval');
  resolve({ by, note, at: new Date().toISOString(), rejected: reject });
}

// Sprint: every feature in dependency order, a few at a time. Dependents wait
// until their dependencies are deployed, so their agents can recall the
// upstream decisions from Meko.
export async function sprint(ids = features().map(f => f.id)) {
  const pending = new Set(ids);
  const running = new Map();
  emit('sprint', { status: 'running', features: ids });
  while (pending.size || running.size) {
    for (const id of [...pending]) {
      if (running.size >= settings.concurrency) break;
      const f = getFeature(id);
      const ready = f.depends.every(d => !pending.has(d) && !running.has(d));
      if (!ready) continue;
      pending.delete(id);
      const run = createRun(id);
      running.set(id, execute(run).then(r => { running.delete(id); return r; }));
    }
    if (running.size) {
      const done = await Promise.race(running.values());
      if (done.status !== 'deployed') for (const id of [...pending]) if (getFeature(id).depends.includes(done.feature)) { pending.delete(id); emit('sprint', { skipped: id, because: done.feature }); }
    }
  }
  emit('sprint', { status: 'done' });
}

export const isActive = id => active.has(id);
export const waitingApproval = () => [...approvals.keys()];
