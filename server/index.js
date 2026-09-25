// ADLC Studio API: REST for actions, Server-Sent Events for everything live
// (pipeline stages, Meko wire traffic, GitHub activity, edge telemetry).
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ROOT, bus, state, setState, env, emit, readText } from './core.js';
import * as meko from './live/meko.js';
import * as gh from './live/github.js';
import * as claude from './live/claude.js';
import * as orch from './adlc/orchestrator.js';
import * as econ from './adlc/economics.js';
import { features, feature, roster, gates } from './adlc/specs.js';
import * as edge from './edge/runtime.js';
import { ask } from './edge/ask.js';
import { STANDARDS, KNOWLEDGE } from './seed/knowledge.js';
import * as privacy from './security/privacy.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).then(d => d !== undefined && res.json(d)).catch(e => res.status(400).json({ error: e.message }));

// Seed the memory explorer with the org standards already in the datapack.
if (!state.memoryLog?.length) setState({ memoryLog: STANDARDS.map(text => ({ id: null, agent: 'adlc:org', text, metadata: { kind: /^(IoT security|Data classification|Transport security)/.test(text) ? 'security-standard' : 'standard' }, at: new Date().toISOString() })) });

// ---- live stream --------------------------------------------------------------
app.get('/api/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  const send = e => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
  bus.on('event', send);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { bus.off('event', send); clearInterval(ping); });
});

// ---- bootstrap / health -------------------------------------------------------
let ghSnap = null, ghError = null;
async function refreshGithub() {
  try { ghSnap = await gh.snapshot(); ghError = null; emit('github-snapshot', ghSnap); }
  catch (e) { ghError = e.message; }
  // Parked releases are checked against the real PR state on every refresh.
  orch.reconcile().catch(() => {});
}
setInterval(refreshGithub, 20000);
refreshGithub();

app.get('/api/health', wrap(async () => ({
  meko: await meko.health(),
  github: ghSnap ? { ok: true, repo: gh.repo(), rate: gh.rate } : { ok: false, error: ghError },
  claude: { ok: claude.enabled(), model: claude.model(), price: claude.price() },
})));

app.get('/api/bootstrap', wrap(async () => ({
  roster: roster(), gates: gates(),
  features: features().map(({ spec, ...f }) => ({ ...f, deployed: state.deployments?.[f.id] ?? null })),
  runs: orch.listRuns(), settings: orch.settings, waiting: orch.waitingApproval(),
  economics: econ.summary(),
  meko: { wire: meko.wire.slice(0, 80), stats: meko.stats, datapackId: meko.datapackId(), datapackName: env('MEKO_DATAPACK_NAME', 'iot-edge-adlc'), memories: state.memoryLog ?? [], kb: Object.keys(state.kbHashes ?? {}), conversations: state.conversations ?? {} },
  github: { snapshot: ghSnap, activity: gh.activity.slice(0, 80), url: gh.repoUrl(), repo: gh.repo() },
  claude: { model: claude.model(), price: claude.price(), enabled: claude.enabled(), stats: claude.stats },
  deployments: state.deployments ?? {},
  privacy: privacy.summary(),
})));
app.get('/api/privacy', wrap(() => privacy.summary()));
// Local-only preview of the shield: the text is redacted in-process and never forwarded.
app.post('/api/privacy/test', wrap(req => { const text = String(req.body.text ?? '').slice(0, 4000); return { redacted: privacy.redact(text, 'preview'), types: [...new Set(privacy.scan(text).map(f => f.type))] }; }));
app.get('/api/docs', wrap(() => ['specs/README.md', 'specs/00-charter.md', 'specs/01-plan/roadmap.md', 'specs/02-design/architecture.md', 'specs/02-design/security.md', 'CONTRIBUTING.md'].map(p => ({ path: p, text: readText(p) }))));

// ---- specs & runs ---------------------------------------------------------------
app.get('/api/features/:id', wrap(req => { const f = feature(req.params.id); if (!f) throw new Error('unknown feature'); return { ...f, artifacts: state.artifacts?.[f.id] ?? {}, deployed: state.deployments?.[f.id] ?? null }; }));
app.get('/api/runs', wrap(() => orch.listRuns()));
app.get('/api/runs/:id', wrap(req => orch.getRun(req.params.id)));
app.post('/api/runs', wrap(req => orch.start(req.body.feature)));
app.post('/api/sprint', wrap(req => { orch.sprint(req.body?.features); return { ok: true }; }));
app.post('/api/runs/:id/retry', wrap(req => orch.retry(req.params.id, req.body?.from)));
app.post('/api/runs/:id/approve', wrap(req => { orch.approve(req.params.id, { by: req.body.by || 'release manager', note: req.body.note, reject: !!req.body.reject }); return { ok: true }; }));
app.patch('/api/settings', wrap(req => { Object.assign(orch.settings, req.body); setState({ settings: orch.settings }); emit('settings', orch.settings); return orch.settings; }));

// ---- economics ------------------------------------------------------------------
app.get('/api/economics', wrap(() => econ.summary()));
app.post('/api/economics/reset', wrap(() => { econ.reset(); return econ.summary(); }));

// ---- Meko ----------------------------------------------------------------------
app.get('/api/meko/search', wrap(async req => {
  const q = String(req.query.q ?? '');
  const [memories, knowledge] = await Promise.all([meko.searchMemory('studio', q, 15), meko.searchKnowledge('studio', q, 6)]);
  return { memories: memories.map(m => ({ id: m.id, agent: m.agent_id, text: m.memory, score: m.score, metadata: m.metadata })), knowledge: knowledge.map(k => ({ doc: k.document_name ?? k.filename, text: k.chunk_text, score: k.score })) };
}));
app.post('/api/meko/memories', wrap(async req => {
  const who = String(req.body.agent || 'org').replace(/[^a-z]/g, '');
  const text = String(req.body.text ?? '').trim();
  if (text.length < 10) throw new Error('memory text is too short');
  const scan = (await import('./adlc/guardrails.js')).run(['secret-scan', 'pii-scan'], { text }).find(r => !r.pass);
  if (scan) throw new Error(`blocked by ${scan.id}: ${scan.detail}`);
  return meko.addMemory(who, text, { kind: req.body.kind || 'note', feature: req.body.feature || '*', stage: 'manual' });
}));
app.get('/api/meko/wire', wrap(() => ({ wire: meko.wire, stats: meko.stats })));
app.get('/api/meko/internals', wrap(() => meko.internals()));
app.get('/api/knowledge', wrap(() => KNOWLEDGE.map(k => ({ file: k.file, title: k.title, body: k.body }))));

// ---- GitHub --------------------------------------------------------------------
app.get('/api/github', wrap(async () => { if (!ghSnap) await refreshGithub(); return { snapshot: ghSnap, activity: gh.activity, error: ghError }; }));

// ---- Edge -----------------------------------------------------------------------
app.get('/api/edge', wrap(() => edge.snapshot(false)));
app.post('/api/edge/inject', wrap(req => { edge.inject(req.body.assetId, req.body.fault); return { ok: true }; }));
app.post('/api/edge/clear', wrap(req => { edge.clear(req.body.assetId); return { ok: true }; }));
app.post('/api/edge/tamper', wrap(req => edge.tamper(req.body.assetId)));
app.post('/api/edge/wo/:id/close', wrap(req => ({ ok: edge.closeWo(req.params.id) })));
app.post('/api/edge/req/:id/receive', wrap(req => ({ ok: edge.receive(req.params.id) })));
app.post('/api/edge/reset', wrap(() => { edge.reset(); return { ok: true }; }));
app.post('/api/ask', wrap(req => ask(req.body.question)));

// ---- static UI -----------------------------------------------------------------
const dist = path.join(ROOT, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

edge.start();
const port = Number(env('PORT', '8787'));
app.listen(port, '127.0.0.1', () => {
  console.log(`ADLC Studio API on http://localhost:${port}`);
  const resumed = orch.resumeInterrupted();
  if (resumed.length) console.log(`Resumed interrupted runs: ${resumed.join(', ')}`);
})
  .on('error', e => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.error(`\nPort ${port} is already in use — another ADLC Studio API is running.\nStop it (lsof -nP -iTCP:${port} -sTCP:LISTEN, then kill <pid>) or set PORT in .env.\n`);
    process.exit(1);
  });
