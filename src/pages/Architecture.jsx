import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Layers, ShieldCheck, Lock, Info, Cpu, Brain, Github, Users, Bot, FileText, Factory, Radio, Workflow } from 'lucide-react';
import { Card, Badge, Toggle } from '../components/ui.jsx';
import { fmt } from '../api.js';

// ---- diagram model --------------------------------------------------------------
// Coordinates are in a 1200 × 720 viewBox. Each node explains its technology,
// the data it handles and how that data is protected.
const NODES = {
  people: { x: 20, y: 44, w: 190, h: 76, title: '10 team members', sub: 'TM-01…TM-10 · roles only', color: '#475569', icon: Users, group: 'team',
    tech: ['Pseudonymous team ids (no personal names)', 'Own an agent each; approve releases (G6)'],
    data: 'Approvals, team notes to Meko, questions to the fleet', security: 'People are never named in prompts, memories or GitHub — privacy shield + pii-scan' },
  agents: { x: 20, y: 150, w: 190, h: 160, title: '10 AI agents', sub: 'Atlas · Vega · Orion · Lyra · Nova · Rigel · Sage · Quill · Sentinel · Helm', color: '#7c3aed', icon: Bot, group: 'team',
    tech: ['Roster + scopes: specs/agents/roster.json', 'Meko agent_id adlc:<agent> per agent', 'Plan, Design, Develop ×5, Test, Review, Deploy'],
    data: 'Plans, designs, code, test reports, reviews, releases', security: 'Per-agent write scope, token budget and guardrail set' },
  specs: { x: 20, y: 340, w: 190, h: 104, title: 'specs/ — source of truth', sub: 'charter · 6 feature specs · ACs · gates', color: '#0891b2', icon: FileText, group: 'team',
    tech: ['Markdown specs with frontmatter contracts', 'Executable ACs: *.acceptance.test.js (node:test)', 'gates.json: guardrails + eval thresholds'],
    data: 'Acceptance criteria, contracts, ADRs, security classification', security: 'Acceptance tests immutable to feature agents (tests-immutable)' },

  ui: { x: 268, y: 44, w: 474, h: 64, title: 'ADLC Studio UI', sub: 'React 18 · Vite · Recharts · lucide-react · EventSource (SSE)', color: '#7c3aed', icon: Layers, group: 'studio',
    tech: ['React 18 SPA built with Vite', 'Recharts charts, lucide icons, custom light design system', 'Live store fed by Server-Sent Events'],
    data: 'Pipeline state, gate reports, memories, PRs, token ledger, fleet telemetry', security: 'Binds to localhost; approvals recorded by team id / role only' },
  orch: { x: 284, y: 168, w: 215, h: 82, title: 'Orchestrator', sub: '6 gated stages · sprint scheduler', color: '#7c3aed', icon: Workflow, group: 'studio',
    tech: ['server/adlc/orchestrator.js', 'Plan → Design → Develop → Test → Review → Deploy', 'Dependency-ordered sprints, retries with lessons, HITL approval'],
    data: 'Runs, stages, artifacts, commit statuses', security: 'A failed blocking gate stops the run; Helm needs human approval' },
  guard: { x: 511, y: 262, w: 215, h: 82, title: 'Guardrails', sub: 'pii · secret · scope · deps · transport · OT', color: '#16a34a', icon: ShieldCheck, group: 'studio',
    tech: ['server/adlc/guardrails.js — 16 deterministic checks', 'node --check syntax, dependency allowlist, path scope', 'prompt-injection + provenance screening of recalled memories'],
    data: 'Artifacts, decisions, PR text, recalled memories', security: 'Block vs warn severity from specs/gates/gates.json' },
  evals: { x: 284, y: 262, w: 215, h: 82, title: 'Evals', sub: 'acceptance · behavioural · LLM-judge', color: '#65a30d', icon: Cpu, group: 'studio',
    tech: ['node:test acceptance suites run against the candidate module', 'scripts/behavioural.js — precision/recall, scenario replays', 'Sentinel LLM-judge score ≥ 0.7'],
    data: 'Test reports, eval scores', security: 'Candidate code runs in a separate process with a timeout' },
  shield: { x: 511, y: 168, w: 215, h: 82, title: 'Privacy shield', sub: 'redacts PII on every egress', color: '#c026d3', icon: Lock, group: 'studio',
    tech: ['server/security/privacy.js', 'Names, emails, phones, national ids, cards, IBAN, addresses, IPs, DOB, health, salary', 'Wraps Claude, Meko and GitHub clients'],
    data: 'Every outbound payload', security: 'Values never logged — only type + destination' },
  ledger: { x: 284, y: 356, w: 215, h: 82, title: 'Token ledger', sub: 'Meko vs memory-less baseline', color: '#d97706', icon: Info, group: 'studio',
    tech: ['server/adlc/economics.js', 'Baseline measured with Claude count_tokens (never sent)', 'Per stage, agent, feature; cost at model price'],
    data: 'Input/output tokens, cost, reuse edges', security: 'Numbers only' },
  edge: { x: 511, y: 356, w: 215, h: 82, title: 'Edge runtime', sub: '1 Hz fleet · detect · WO · CAR · stock', color: '#0891b2', icon: Factory, group: 'studio',
    tech: ['server/edge/runtime.js + edge/reference/*', 'Simulator → detector → work orders → CARs → inventory', 'Fault injection and tamper tests from the UI'],
    data: 'C2 telemetry, anomalies, WOs, CARs, stock', security: 'Rejects non-finite / tampered telemetry (AC-F02-6)' },
  bus: { x: 284, y: 452, w: 442, h: 62, title: 'Live event bus (SSE)', sub: 'run · meko · github · ledger · edge · privacy · llm', color: '#475569', icon: Radio, group: 'studio',
    tech: ['Node EventEmitter → text/event-stream', 'One stream per browser; auto-reconnect'], data: 'State changes as they happen', security: 'Local only' },

  claude: { x: 846, y: 44, w: 332, h: 118, title: 'Claude API', sub: 'claude-sonnet-5 · Messages (streaming) · count_tokens', color: '#d97706', icon: Cpu, group: 'ext',
    tech: ['@anthropic-ai/sdk — messages.stream().finalMessage()', 'messages.countTokens for the baseline', 'Effort low/medium per stage'],
    data: 'Task + spec + top-k Meko recall → plan, design, code, review, answers', security: 'Prompts pass the privacy shield; no C3 data or secrets ever sent' },
  meko: { x: 846, y: 188, w: 332, h: 178, title: 'Meko — datapack iot-edge-adlc', sub: 'shared memory + knowledge for all 10 agents', color: '#7c3aed', icon: Brain, group: 'ext',
    tech: ['MCP over streamable HTTP (@modelcontextprotocol/sdk)', 'memory_search · memory_add · knowledgebase_search', 'artifact_put/get · conversations · track_token_usage', 'REST knowledge-base upload (specs, domain, security docs)'],
    data: 'Decisions, standards, lessons, artifacts by content hash, knowledge chunks', security: 'secret-scan + pii-scan before every write; injection screening on every read' },
  github: { x: 846, y: 392, w: 332, h: 150, title: 'GitHub — seethb/adlc-demo', sub: 'branches · PRs · statuses · reviews · deployments · Actions', color: '#0f172a', icon: Github, group: 'ext',
    tech: ['REST v3 via gh auth token', 'Git Data API commits authored by each agent', 'Commit statuses adlc/spec … adlc/release; PR comments & reviews', 'Squash merge + Deployments (edge-staging); Actions CI'],
    data: 'Specs, code, test reports, gate reports', security: 'PR text & files pass the privacy shield; CI re-runs secret + edge-security scans' },

  ot: { x: 20, y: 640, w: 150, h: 112, title: 'Plant / OT', sub: 'sensors · PLCs · OPC-UA', color: '#475569', icon: Factory, group: 'product',
    tech: ['Purdue L0–2; OPC-UA SignAndEncrypt + app certificates', 'Legacy Modbus / 4–20 mA point-to-point, read-only'], data: 'Process values', security: 'Edge is read-only towards OT (ot-write-prohibited)' },
  f01: { x: 186, y: 640, w: 152, h: 112, title: 'F01 Simulator', sub: 'Orion · 1 Hz readings', color: '#16a34a', group: 'product', tech: ['createSimulator — seeded, fault injection'], data: 'Readings (C2)', security: 'Deterministic, no I/O' },
  f02: { x: 352, y: 640, w: 152, h: 112, title: 'F02 Anomaly', sub: 'Lyra · z-score + ISO 10816', color: '#e11d48', group: 'product', tech: ['createDetector — baseline z, OEM limits, failure-mode signatures'], data: 'Anomalies (C2)', security: 'Validates telemetry' },
  f03: { x: 518, y: 640, w: 152, h: 112, title: 'F03 Work orders', sub: 'Nova · P1–P3, de-dup', color: '#d97706', group: 'product', tech: ['createWorkOrderService — playbooks + parts'], data: 'WOs (C2)', security: 'Advisory — no OT writes' },
  f04: { x: 684, y: 640, w: 152, h: 112, title: 'F04 CAR (8D)', sub: 'Nova · critical / recurring', color: '#a21caf', group: 'product', tech: ['createCarService — 8D fields'], data: 'CARs (C2)', security: 'No personal names' },
  f05: { x: 850, y: 640, w: 152, h: 112, title: 'F05 Inventory', sub: 'Rigel · reserve · reorder', color: '#2563eb', group: 'product', tech: ['createInventory — reservations, requisitions'], data: 'Stock (C1)', security: 'Never negative availability' },
  f06: { x: 1016, y: 640, w: 164, h: 112, title: 'F06 NL query', sub: 'Sage · Ask the fleet', color: '#0d9488', group: 'product', tech: ['parseQuery planner + Claude answer grounded in Meko'], data: 'Questions & answers (C2)', security: 'Read-only; PII redacted from questions' },
};

// The Node API container, used as an anchor for flows to and from managed services.
const API_BOX = { x: 268, y: 130, w: 474, h: 400 };

// n: step number in "one agent step"; kind colours the line; lp pins the label.
const EDGES = [
  { from: 'people', to: 'agents', fs: 'b', ts: 't', label: 'own · approve', kind: 'team' },
  { from: 'agents', to: 'orch', fs: 'r', ts: 'l', label: '', kind: 'team', n: 1, lp: [246, 214] },
  { from: 'specs', to: 'orch', fs: 'r', ts: 'l', label: '', kind: 'team', n: 1, lp: [246, 330] },
  { from: 'ui', to: 'orch', fs: 'b', ts: 't', label: '', kind: 'studio' },
  { from: 'meko', to: 'api', fs: 'l', ts: 'r', fy: 250, ty: 250, label: 'recall', kind: 'meko', n: 2, lp: [794, 232] },
  { from: 'orch', to: 'shield', fs: 'r', ts: 'l', label: '', kind: 'claude', n: 3 },
  { from: 'shield', to: 'claude', fs: 'r', ts: 'l', label: 'redacted prompt', kind: 'claude', n: 4, lp: [788, 150] },
  { from: 'claude', to: 'orch', fs: 'l', ts: 't', fy: 150, label: 'artifact + usage', kind: 'claude', n: 5, via: [560, 118], lp: [640, 138] },
  { from: 'orch', to: 'evals', fs: 'b', ts: 't', label: '', kind: 'studio', n: 6 },
  { from: 'evals', to: 'guard', fs: 'r', ts: 'l', label: '', kind: 'studio', n: 6 },
  { from: 'guard', to: 'github', fs: 'r', ts: 'l', label: 'commit · PR', kind: 'github', n: 7, lp: [794, 372] },
  { from: 'api', to: 'meko', fs: 'r', ts: 'l', fy: 318, ty: 330, label: 'remember', kind: 'meko', n: 8, lp: [794, 306] },
  { from: 'ledger', to: 'bus', fs: 'b', ts: 't', label: '', kind: 'studio', n: 9 },
  { from: 'bus', to: 'ui', fs: 'l', ts: 'l', label: '', kind: 'studio', n: 9, via: [238, 280], lp: [246, 470] },
  { from: 'github', to: 'f05', fs: 'b', ts: 't', label: 'merge → deploy edge-staging', kind: 'github', lp: [930, 590] },
  { from: 'edge', to: 'f03', fs: 'b', ts: 't', label: 'runs features', kind: 'product', lp: [600, 590] },
  { from: 'ot', to: 'f01', fs: 'r', ts: 'l', label: '', kind: 'product' },
  { from: 'f01', to: 'f02', fs: 'r', ts: 'l', label: '', kind: 'product' },
  { from: 'f02', to: 'f03', fs: 'r', ts: 'l', label: '', kind: 'product' },
  { from: 'f03', to: 'f04', fs: 'r', ts: 'l', label: '', kind: 'product' },
  { from: 'f03', to: 'f05', fs: 'b', ts: 'b', label: 'reserve parts', kind: 'product', arc: 40, lp: [760, 782] },
  { from: 'f06', to: 'meko', fs: 't', ts: 'r', label: 'NL query recall', kind: 'meko', via: [1196, 470], lp: [1120, 590] },
];

const KIND = { team: '#64748b', studio: '#7c3aed', meko: '#7c3aed', claude: '#d97706', github: '#0f172a', product: '#0891b2' };

const anchor = (n, side, at) => {
  const { x, y, w, h } = n === 'api' ? API_BOX : NODES[n];
  const my = at ?? y + h / 2;
  return { l: [x, my], r: [x + w, my], t: [x + w / 2, y], b: [x + w / 2, y + h] }[side];
};

function pathFor(e) {
  const [x1, y1] = anchor(e.from, e.fs, e.fy);
  const [x2, y2] = anchor(e.to, e.ts, e.ty);
  if (e.arc) return `M${x1},${y1} C${x1},${y1 + e.arc} ${x2},${y2 + e.arc} ${x2},${y2}`;
  if (e.via) { const [vx, vy] = e.via; return `M${x1},${y1} Q${vx},${vy} ${x2},${y2}`; }
  const horiz = ['l', 'r'].includes(e.fs);
  const d = horiz ? Math.max(30, Math.abs(x2 - x1) / 2) : Math.max(20, Math.abs(y2 - y1) / 2);
  return horiz ? `M${x1},${y1} C${x1 + (e.fs === 'r' ? d : -d)},${y1} ${x2 + (e.ts === 'l' ? -d : d)},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1},${y1 + (e.fs === 'b' ? d : -d)} ${x2},${y2 + (e.ts === 't' ? -d : d)} ${x2},${y2}`;
}

const STEPS = [
  { n: 1, title: 'Spec → agent', text: 'The orchestrator picks the next stage for a feature; the owning agent gets the task and the feature spec (the source of truth).' },
  { n: 2, title: 'Recall from Meko', text: 'memory_search and knowledgebase_search pull the top-k decisions, standards, lessons and knowledge chunks written by other agents — instead of re-reading the whole repo.' },
  { n: 3, title: 'Guard the input', text: 'Recalled memories are screened for prompt injection and provenance; the prompt goes through the privacy shield (PII → [REDACTED:TYPE]).' },
  { n: 4, title: 'Call Claude', text: 'claude-sonnet-5 receives only task + spec + recall. The memory-less baseline is measured with count_tokens and never sent.' },
  { n: 5, title: 'Artifact back', text: 'Claude returns the plan / design / code / review plus 2–5 durable decisions for the team; usage is recorded in the token ledger and in Meko.' },
  { n: 6, title: 'Gate', text: 'Guardrails (pii, secret, scope, deps, transport, OT, syntax…) and evals (acceptance tests, behavioural, LLM-judge) decide pass / block.' },
  { n: 7, title: 'GitHub', text: 'The agent commits to its feature branch, the PR gets a gate report and an adlc/* commit status; Helm merges and deploys after human approval.' },
  { n: 8, title: 'Remember in Meko', text: 'Decisions are written with memory_add; passing artifacts are stored by content hash so an unchanged spec re-uses them with zero LLM tokens.' },
  { n: 9, title: 'Everyone sees it', text: 'The ledger, run log, Meko wire and GitHub activity stream to every open Studio over SSE.' },
];

const FLOWS = [
  ['Studio → Claude API', 'HTTPS, TLS 1.2+', 'API key (secret store)', 'C1–C2 task context', 'Privacy shield redacts; never C3'],
  ['Studio → Meko (MCP)', 'Streamable HTTP, TLS 1.2+', 'Bearer API key', 'C1–C2 decisions & knowledge', 'secret-scan + pii-scan before write'],
  ['Studio → GitHub', 'HTTPS REST v3', 'gh OAuth token', 'C0–C1 code, specs, reports', 'Privacy shield on bodies; CI secret scan'],
  ['Plant PLC → Edge gateway', 'OPC-UA SignAndEncrypt', 'App-instance X.509 certs', 'C2 process values', 'Read-only; legacy fieldbus point-to-point'],
  ['Edge gateway → Cloud', 'MQTT 5 on 8883, TLS 1.3', 'Per-device X.509 mTLS', 'C2 aggregates + anomalies', 'Raw 1 Hz data stays at the edge (7 days)'],
  ['Cloud → Edge (OTA/config)', 'HTTPS / MQTT mTLS', 'Code-signing cert in HSM', 'Signed firmware / config', 'Verify before install, anti-rollback'],
  ['Browser ↔ Studio', 'HTTP + SSE (localhost)', 'Local only (OIDC in prod)', 'All Studio state', 'Approvals by team id / role'],
];

const STACK = [
  ['Frontend', 'React 18, Vite 5, Recharts, lucide-react, EventSource'],
  ['Backend', 'Node 20, Express, Server-Sent Events, node:test'],
  ['LLM', 'Claude Sonnet 5 via @anthropic-ai/sdk (streaming, count_tokens)'],
  ['Shared memory', 'Meko MCP (@modelcontextprotocol/sdk, streamable HTTP) + REST KB upload'],
  ['Source & CI/CD', 'GitHub REST (Git Data, PRs, statuses, reviews, deployments), GitHub Actions'],
  ['Governance', 'Spec-driven ACs, 16 guardrails, 6 evals, human release gate, privacy shield'],
  ['Edge product', 'Pure ES modules: simulator, detector, WO, CAR, inventory, NL planner'],
];

export default function Architecture({ s }) {
  const [sel, setSel] = useState('meko');
  const [animate, setAnimate] = useState(true);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => setStep(x => (x >= STEPS.length ? 1 : x + 1)), 1800);
    return () => clearInterval(timer.current);
  }, [playing]);

  const live = {
    meko: `${fmt.n(s.meko?.stats?.calls ?? 0)} MCP calls · ${fmt.n(s.meko?.memories?.length ?? 0)} memories`,
    github: `${s.github?.snapshot?.pulls?.length ?? 0} PRs · ${s.github?.snapshot?.runs?.length ?? 0} Actions runs`,
    claude: `${s.claude?.model} · ${fmt.k(s.economics?.totals?.mekoIn ?? 0)} input tokens`,
    shield: `${fmt.n(s.privacy?.redactions ?? 0)} redactions`,
    ledger: `${fmt.pct(s.economics?.totals?.savedPct)} saved`,
    edge: `tick ${s.edge?.tick ?? 0} · ${s.edge?.workOrders?.filter(w => w.status !== 'closed').length ?? 0} open WOs`,
    orch: `${s.runs.filter(r => r.status === 'running').length} running · ${s.runs.filter(r => r.stages?.deploy?.status === 'awaiting_approval').length} awaiting approval`,
  };
  const node = NODES[sel];
  const activeEdge = e => step > 0 && e.n === step;

  return (
    <>
      <Card glow>
        <div className="row wrap" style={{ gap: 14 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>How 10 people + 10 agents build the product with GitHub, Claude and Meko</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Click any component for its technology, data and protections. Play “one agent step” to follow the numbered data flow.</div>
          </div>
          <div style={{ marginLeft: 'auto' }} className="row wrap">
            <Toggle on={animate} onChange={setAnimate} label="Animate flows" />
            <button className="btn primary" onClick={() => { setPlaying(p => !p); if (!step) setStep(1); }}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? 'Pause' : 'Play one agent step'}</button>
          </div>
        </div>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <Card style={{ padding: 10 }}>
          <svg viewBox="0 0 1200 800" style={{ width: '100%', display: 'block' }}>
            <defs>
              {Object.entries(KIND).map(([k, c]) => <marker key={k} id={`ah-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={c} /></marker>)}
              <filter id="soft" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#0f172a" floodOpacity="0.08" /></filter>
            </defs>

            {/* zones */}
            <Zone x={8} y={14} w={216} h={446} label="TEAM & SPECS" />
            <Zone x={252} y={14} w={506} h={530} label="ADLC STUDIO (this repo · Node + React)" />
            <rect x={API_BOX.x} y={API_BOX.y} width={API_BOX.w} height={API_BOX.h} rx={14} fill="#f5f3ff" stroke="#ddd6fe" strokeDasharray="4 4" />
            <text x={API_BOX.x + 14} y={API_BOX.y + 22} fontSize="11" fontWeight="700" fill="#6d28d9">Node API — Express</text>
            <Zone x={830} y={14} w={362} h={540} label="MANAGED SERVICES" />
            <Zone x={8} y={606} w={1184} h={188} label="THE PRODUCT — EDGE ASSET INTELLIGENCE (OT → EDGE → CLOUD)" />
            {/* edges */}
            {EDGES.map((e, i) => {
              const d = pathFor(e);
              const on = activeEdge(e);
              const dim = step > 0 && !on;
              const c = KIND[e.kind];
              return (
                <g key={i} opacity={dim ? 0.18 : 1}>
                  <path id={`e${i}`} d={d} fill="none" stroke={c} strokeWidth={on ? 3.2 : 1.6} strokeOpacity={on ? 1 : 0.55} markerEnd={`url(#ah-${e.kind})`} className={animate ? 'flow-line' : ''} />
                  {animate && <circle r={on ? 5 : 3.2} fill={c}><animateMotion dur={`${2.2 + (i % 4) * 0.4}s`} repeatCount="indefinite"><mpath href={`#e${i}`} /></animateMotion></circle>}
                  {(e.label || e.n) && <EdgeLabel d={d} at={e.lp} text={e.label} n={e.n} color={c} strong={on} />}
                </g>
              );
            })}

            {/* nodes */}
            {Object.entries(NODES).map(([id, n]) => {
              const on = sel === id;
              const I = n.icon;
              const liveTxt = live[id];
              return (
                <g key={id} transform={`translate(${n.x},${n.y})`} style={{ cursor: 'pointer' }} onClick={() => setSel(id)}>
                  <rect width={n.w} height={n.h} rx={12} fill="#ffffff" stroke={on ? n.color : '#e2e8f0'} strokeWidth={on ? 2.4 : 1.2} filter="url(#soft)" />
                  <rect width={5} height={n.h - 16} x={0} y={8} rx={2.5} fill={n.color} />
                  {I && <g transform="translate(14,12)" color={n.color}><I size={16} /></g>}
                  <text x={I ? 38 : 16} y={25} fontSize={13.5} fontWeight="750" fill="#0f172a">{n.title}</text>
                  <foreignObject x={14} y={33} width={n.w - 22} height={n.h - 36}>
                    <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.35 }}>{n.sub}</div>
                    {liveTxt && <div style={{ fontSize: 10.5, color: n.color, fontWeight: 700, marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>● {liveTxt}</div>}
                  </foreignObject>
                </g>
              );
            })}
          </svg>
        </Card>

        <div className="col" style={{ gap: 16 }}>
          <Card title={node.title} hint={node.group === 'ext' ? 'managed service' : node.group === 'product' ? 'edge product' : node.group === 'studio' ? 'ADLC Studio' : 'team'} icon={<span style={{ width: 10, height: 10, borderRadius: 3, background: node.color, display: 'inline-block' }} />}>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>{node.sub}</div>
            <div className="dim" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em' }}>TECHNOLOGY</div>
            <ul style={{ margin: '6px 0 12px', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55 }}>{node.tech.map(t => <li key={t}>{t}</li>)}</ul>
            <div className="dim" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em' }}>DATA</div>
            <div style={{ fontSize: 12.5, margin: '6px 0 12px' }}>{node.data}</div>
            <div className="dim" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em' }}>PROTECTION</div>
            <div className="row" style={{ fontSize: 12.5, marginTop: 6, alignItems: 'flex-start' }}><ShieldCheck size={14} color="#16a34a" style={{ flex: 'none', marginTop: 2 }} />{node.security}</div>
          </Card>
          <Card title="One agent step, end to end" icon={<Workflow size={16} color="#7c3aed" />}>
            <div className="col" style={{ gap: 6 }}>
              {STEPS.map(st => (
                <div key={st.n} onClick={() => { setStep(st.n); setPlaying(false); }} className="row" style={{ alignItems: 'flex-start', gap: 10, padding: '7px 9px', borderRadius: 10, cursor: 'pointer', background: step === st.n ? '#f5f3ff' : 'transparent', border: `1px solid ${step === st.n ? '#ddd6fe' : 'transparent'}` }}>
                  <span style={{ flex: 'none', width: 22, height: 22, borderRadius: 7, background: step === st.n ? 'var(--grad)' : '#eef1f7', color: step === st.n ? 'white' : '#475569', display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 800 }}>{st.n}</span>
                  <div><div style={{ fontWeight: 700, fontSize: 12.5 }}>{st.title}</div>{step === st.n && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{st.text}</div>}</div>
                </div>
              ))}
              {step > 0 && <button className="btn sm ghost" onClick={() => { setStep(0); setPlaying(false); }}>Show all flows</button>}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid g-3-2">
        <Card title="Data flows, protocols and protection" hint="specs/02-design/security.md" icon={<Lock size={16} color="#c026d3" />}>
          <table className="t">
            <thead><tr><th>Flow</th><th>Protocol</th><th>Authentication / certificates</th><th>Data class</th><th>Controls</th></tr></thead>
            <tbody>{FLOWS.map(f => <tr key={f[0]}><td style={{ fontWeight: 650 }}>{f[0]}</td><td className="mono" style={{ fontSize: 11.5 }}>{f[1]}</td><td>{f[2]}</td><td><Badge tone={f[3].startsWith('C2') ? 'amber' : f[3].startsWith('C0') ? 'green' : 'blue'}>{f[3]}</Badge></td><td className="muted" style={{ fontSize: 12 }}>{f[4]}</td></tr>)}</tbody>
          </table>
        </Card>
        <Card title="Technology stack" icon={<Layers size={16} color="#0891b2" />}>
          <table className="t"><tbody>{STACK.map(([k, v]) => <tr key={k}><td style={{ fontWeight: 700, width: 120 }}>{k}</td><td className="muted" style={{ fontSize: 12.5 }}>{v}</td></tr>)}</tbody></table>
        </Card>
      </div>
    </>
  );
}

function Zone({ x, y, w, h, label }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={16} fill="rgba(248,250,252,0.7)" stroke="#e2e8f0" />
      <text x={x + 14} y={y + 20} fontSize="10.5" fontWeight="800" letterSpacing="0.1em" fill="#94a3b8">{label}</text>
    </g>
  );
}

// Places a small pill label at the middle of an edge path.
function EdgeLabel({ d, at, text, n, color, strong }) {
  const ref = useRef(null);
  const [pt, setPt] = useState(at ?? null);
  useEffect(() => {
    if (at) return;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    const len = p.getTotalLength();
    const m = p.getPointAtLength(len / 2);
    setPt([m.x, m.y]);
  }, [d]);
  if (!pt) return null;
  const w = text ? text.length * 5.6 + (n ? 26 : 14) : 20;
  return (
    <g ref={ref} transform={`translate(${pt[0] - w / 2},${pt[1] - 10})`}>
      <rect width={w} height={20} rx={10} fill="#ffffff" stroke={color} strokeOpacity={strong ? 1 : 0.35} strokeWidth={strong ? 1.6 : 1} />
      {n && <><circle cx={text ? 11 : 10} cy={10} r={7} fill={color} /><text x={text ? 11 : 10} y={13.5} fontSize="9.5" fontWeight="800" fill="white" textAnchor="middle">{n}</text></>}
      {text && <text x={n ? 22 : 7} y={13.5} fontSize="10" fontWeight="650" fill="#334155">{text}</text>}
    </g>
  );
}
