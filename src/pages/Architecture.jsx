import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Users, Bot, Layers, Workflow, ShieldCheck, FlaskConical, Lock, Coins, Radio, Factory, Cpu, Brain, Github, UserCheck, Rocket, ChevronRight, KeyRound, Network, FileText } from 'lucide-react';
import { Card, Badge, AgentIcon } from '../components/ui.jsx';
import { fmt } from '../api.js';

// Canvas: every connector is a straight horizontal line between columns.
const W = 1440, H = 620;
const COL = { team: [30, 220], studio: [340, 360], svc: [840, 240], edge: [1220, 200] };
const C = { team: '#4f46e5', meko: '#7c3aed', claude: '#d97706', github: '#0f172a', product: '#0891b2', studio: '#6d28d9' };

const LINKS = [
  { id: 'run', x1: 250, x2: 340, y: 330, label: 'run stages', color: C.team },
  { id: 'prompt', x1: 700, x2: 840, y: 96, label: 'prompt · PII-redacted', color: C.claude },
  { id: 'artifact', x1: 840, x2: 700, y: 134, label: 'artifact + usage', color: C.claude },
  { id: 'remember', x1: 700, x2: 840, y: 290, label: 'remember decisions', color: C.meko },
  { id: 'recall', x1: 840, x2: 700, y: 328, label: 'recall memory', color: C.meko },
  { id: 'commit', x1: 700, x2: 840, y: 486, label: 'commit · PR · status', color: C.github },
  { id: 'ci', x1: 840, x2: 700, y: 524, label: 'CI · reviews · merge', color: C.github },
  { id: 'nlq', x1: 1220, x2: 1080, y: 115, label: 'NL answers (F06)', color: C.claude },
  { id: 'kb', x1: 1220, x2: 1080, y: 309, label: 'knowledge recall', color: C.meko },
  { id: 'deploy', x1: 1080, x2: 1220, y: 505, label: 'deploy edge-staging', color: C.github },
];

const STEPS = [
  { n: 1, title: 'Spec → agent', text: 'The orchestrator picks the next gated stage; the owning agent receives the task and the feature spec — the source of truth.', links: ['run'], nodes: ['agents', 'orch'] },
  { n: 2, title: 'Recall from Meko', text: 'memory_search + knowledgebase_search return the top-k decisions, standards and lessons other agents wrote — instead of re-reading the repo.', links: ['recall'], nodes: ['meko', 'orch'] },
  { n: 3, title: 'Guard the input', text: 'Recalled memories are screened for prompt injection and provenance; the privacy shield redacts any PII before anything leaves.', links: [], nodes: ['shield', 'guard'] },
  { n: 4, title: 'Call Claude', text: 'claude-sonnet-5 gets only task + spec + recall. The memory-less baseline is measured with count_tokens and never sent.', links: ['prompt'], nodes: ['claude', 'shield'] },
  { n: 5, title: 'Artifact back', text: 'Plan, design, code or review returns with 2–5 durable decisions; usage lands in the token ledger and in Meko.', links: ['artifact'], nodes: ['claude', 'ledger'] },
  { n: 6, title: 'Gate', text: '16 guardrails (PII, secrets, scope, deps, transport, OT…) and evals (acceptance, behavioural, LLM-judge) decide pass or block.', links: [], nodes: ['guard', 'evals'] },
  { n: 7, title: 'GitHub', text: 'The agent commits to its feature branch; the PR gets a gate report and an adlc/* status. CI re-checks everything independently.', links: ['commit', 'ci'], nodes: ['github'] },
  { n: 8, title: 'Remember in Meko', text: 'Decisions go in with memory_add; passing artifacts are stored by content hash, so an unchanged spec is reused with zero LLM tokens.', links: ['remember'], nodes: ['meko'] },
  { n: 9, title: 'Release', text: 'A human approves; Helm squash-merges and records a deployment to edge-staging — the feature goes live in Edge Ops.', links: ['deploy'], nodes: ['hitl', 'github', 'edge'] },
];

const INFO = {
  team: { title: '10 team members', tone: C.team, tech: ['Pseudonymous ids TM-01…TM-10 with roles', 'Each owns one agent and approves its releases'], data: 'Approvals, team knowledge, questions', protect: 'No personal names anywhere — privacy shield + pii-scan' },
  agents: { title: '10 AI agents', tone: C.team, tech: ['specs/agents/roster.json — role, scope, guardrails, evals, token budget', 'Meko agent_id adlc:<agent>'], data: 'Plans, designs, code, tests, reviews, releases', protect: 'Per-agent write scope and token budget' },
  orch: { title: 'Orchestrator', tone: C.studio, tech: ['server/adlc/orchestrator.js', 'Six gated stages, dependency-ordered sprints, retries with lessons, auto-resume'], data: 'Runs, stages, artifacts', protect: 'Blocking gates stop the run' },
  guard: { title: 'Guardrails', tone: '#16a34a', tech: ['16 deterministic checks from specs/gates/gates.json', 'pii · secret · path-scope · deps · syntax · no-exec · transport · OT-write · injection · provenance'], data: 'Artifacts, decisions, PR text, recalled memories', protect: 'block vs warn severities' },
  evals: { title: 'Evals', tone: '#65a30d', tech: ['node:test acceptance suites (immutable)', 'Behavioural evals — precision/recall, scenario replays', 'Sentinel LLM-judge ≥ 0.7'], data: 'Test reports, scores', protect: 'Candidate code runs isolated with a timeout' },
  shield: { title: 'Privacy shield', tone: '#c026d3', tech: ['server/security/privacy.js wraps Claude, Meko and GitHub clients', 'Names, emails, phones, national ids, cards, IBAN, addresses, IPs, DOB, health, salary'], data: 'Every outbound payload', protect: 'Values never logged — only type + destination' },
  ledger: { title: 'Token ledger', tone: '#d97706', tech: ['Meko-recall tokens vs memory-less baseline (count_tokens)', 'Per stage, agent and feature, priced at the model rate'], data: 'Tokens, cost, reuse edges', protect: 'Numbers only' },
  sse: { title: 'Live event stream', tone: '#475569', tech: ['Server-Sent Events from an in-process bus', 'Pipeline, Meko wire, GitHub activity, ledger, edge, privacy'], data: 'State changes', protect: 'Local only' },
  edgert: { title: 'Edge runtime', tone: C.product, tech: ['1 Hz fleet: simulator → detector → WO → CAR → inventory', 'Fault injection and tamper tests'], data: 'C2 telemetry, anomalies, WOs', protect: 'Rejects non-finite / tampered readings' },
  hitl: { title: 'Human release gate', tone: '#16a34a', tech: ['G6 — feature owner or release manager approves', 'Recorded by team id and role'], data: 'Approval + note', protect: 'Nothing merges without a human' },
  claude: { title: 'Claude API', tone: C.claude, tech: ['claude-sonnet-5 via @anthropic-ai/sdk', 'messages.stream().finalMessage(), messages.countTokens'], data: 'Task + spec + top-k recall → artifacts, reviews, answers', protect: 'Prompts pass the privacy shield; never C3 or secrets' },
  meko: { title: 'Meko datapack · iot-edge-adlc', tone: C.meko, tech: ['MCP over streamable HTTP (@modelcontextprotocol/sdk)', 'memory_search · memory_add · knowledgebase_search · artifact_put/get · track_token_usage', 'REST knowledge-base upload'], data: 'Decisions, standards, lessons, artifacts, knowledge chunks', protect: 'secret-scan + pii-scan on write; injection screening on read' },
  github: { title: 'GitHub · seethb/adlc-demo', tone: C.github, tech: ['REST v3 — Git Data commits authored by agents', 'PRs, reviews, labels, adlc/* statuses, squash merge, Deployments', 'Actions CI: spec lint, tests, evals, secret + edge-security scans'], data: 'Specs, code, reports, gate reports', protect: 'Bodies pass the privacy shield; CI re-checks' },
  edge: { title: 'Edge product · edge-staging', tone: C.product, tech: ['Pure ES modules F01–F06 built by the agents', 'OT read-only via OPC-UA; MQTT 5 over mTLS to cloud'], data: 'C2 plant data; raw 1 Hz stays at the edge', protect: 'ot-write-prohibited · plaintext-transport · AC-F02-6' },
};

const FLOWS = [
  ['Studio → Claude', 'HTTPS · TLS 1.2+', 'API key (secret store)', 'C1–C2', 'PII redacted · never C3'],
  ['Studio ⇄ Meko', 'MCP streamable HTTP · TLS', 'Bearer key', 'C1–C2', 'secret + PII scan on write'],
  ['Studio → GitHub', 'HTTPS REST v3', 'gh OAuth token', 'C0–C1', 'Shield on bodies · CI scans'],
  ['PLC → Edge gateway', 'OPC-UA SignAndEncrypt', 'App-instance X.509', 'C2', 'Read-only towards OT'],
  ['Edge → Cloud', 'MQTT 5 · 8883 · TLS 1.3', 'Per-device X.509 mTLS', 'C2', 'Raw 1 Hz stays at edge'],
  ['Cloud → Edge (OTA)', 'HTTPS / MQTT mTLS', 'Code-signing cert (HSM)', 'Signed', 'Verify · anti-rollback'],
];

const STACK = [
  [Layers, 'Frontend', 'React 18 · Vite · Recharts'],
  [Workflow, 'Backend', 'Node 20 · Express · SSE'],
  [Cpu, 'LLM', 'Claude Sonnet 5 · Anthropic SDK'],
  [Brain, 'Shared memory', 'Meko MCP · knowledge base'],
  [Github, 'Code & CI/CD', 'GitHub REST · Actions'],
  [ShieldCheck, 'Governance', 'Specs · 16 guardrails · evals · HITL'],
  [Factory, 'Edge', 'ES modules · OPC-UA · MQTT/mTLS'],
];

export default function Architecture({ s }) {
  const [sel, setSel] = useState('meko');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const wrap = useRef(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setStep(x => (x >= STEPS.length ? 1 : x + 1)), 2600);
    return () => clearInterval(t);
  }, [playing]);

  const cur = STEPS.find(x => x.n === step);
  const litLink = id => !cur || cur.links.includes(id);
  const focus = id => (cur ? (cur.nodes.includes(id) ? 'lit' : 'dim') : sel === id ? 'sel' : '');
  const pick = id => setSel(id);

  const e = s.economics?.totals ?? {};
  const running = s.runs.filter(r => r.status === 'running').length;
  const waiting = s.features.filter(f => s.runs.find(r => r.feature === f.id && r.status !== 'superseded')?.stages?.deploy?.status === 'awaiting_approval').length;
  const deployed = s.deployments ?? {};
  const info = INFO[sel];

  return (
    <>
      <div className="arch-head card">
        <div>
          <div className="arch-title">How <span className="grad-text">10 people + 10 agents</span> build with GitHub, Claude and Meko</div>
          <div className="muted" style={{ fontSize: 13 }}>Every connection runs left → right. Click any component for details, or play one agent step.</div>
        </div>
        <div className="arch-legend">
          {[['Control', C.team], ['LLM', C.claude], ['Memory', C.meko], ['Code & release', C.github]].map(([l, c]) => <span key={l}><i style={{ background: c }} />{l}</span>)}
        </div>
      </div>

      <div className="card arch-stage">
        <div className="arch-steps">
          <button className={`btn ${playing ? '' : 'primary'} sm`} onClick={() => { if (!step) setStep(1); setPlaying(p => !p); }}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? 'Pause' : step ? 'Resume' : 'Play one agent step'}</button>
          <div className="arch-dots">
            {STEPS.map(x => <button key={x.n} className={x.n === step ? 'on' : x.n < step ? 'done' : ''} onClick={() => { setStep(x.n); setPlaying(false); }} title={x.title}>{x.n}</button>)}
          </div>
          {step > 0 && <button className="btn ghost sm" onClick={() => { setStep(0); setPlaying(false); }}><RotateCcw size={13} />All flows</button>}
          <div className="arch-caption">{cur ? <><b>{cur.n} · {cur.title}</b><span>{cur.text}</span></> : <span className="dim">All data flows animating live — {fmt.n(s.meko?.stats?.calls ?? 0)} Meko calls, {s.github?.snapshot?.pulls?.length ?? 0} PRs and {fmt.k(e.mekoIn ?? 0)} Claude input tokens so far.</span>}</div>
        </div>

        <div ref={wrap} className="arch-canvas" style={{ height: H * scale }}>
          <div className="arch-inner" style={{ width: W, height: H, transform: `scale(${scale})` }}>
            <svg width={W} height={H} className="arch-svg">
              <defs>
                {Object.entries(C).map(([k, c]) => <marker key={k} id={`m-${k}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill={c} /></marker>)}
              </defs>
              <line x1={140} y1={216} x2={140} y2={246} stroke={C.team} strokeWidth="2" strokeDasharray="3 4" markerEnd="url(#m-team)" opacity={cur ? 0.14 : 1} />
              {LINKS.map(l => {
                const on = litLink(l.id);
                const key = Object.keys(C).find(k => C[k] === l.color);
                const len = Math.abs(l.x2 - l.x1);
                return (
                  <g key={l.id} opacity={on ? 1 : 0.12} style={{ transition: 'opacity .35s' }}>
                    <path d={`M${l.x1},${l.y} L${l.x2 + (l.x2 > l.x1 ? -4 : 4)},${l.y}`} stroke={l.color} strokeWidth={cur && on ? 3 : 2} fill="none" markerEnd={`url(#m-${key})`} strokeLinecap="round" />
                    <circle r={cur && on ? 5 : 3.5} fill={l.color}><animateMotion dur={`${1.4 + len / 160}s`} repeatCount="indefinite" path={`M${l.x1},${l.y} L${l.x2},${l.y}`} /></circle>
                    <foreignObject x={Math.min(l.x1, l.x2) - 12} y={l.y - 25} width={len + 24} height={20}>
                      <div className="arch-pill" style={{ color: l.color, borderColor: `${l.color}40` }}>{l.label}</div>
                    </foreignObject>
                  </g>
                );
              })}
            </svg>

            {/* column 1 — people */}
            <Box x={COL.team[0]} y={40} w={COL.team[1]} h={176} id="team" focus={focus} pick={pick} tone={C.team} icon={Users} title="10 team members" sub="own, steer & approve">
              <div className="arch-people">{s.roster.agents.map(a => <span key={a.id} title={`${a.owner} · ${a.ownerRole}`} style={{ background: `${a.color}14`, color: a.color, borderColor: `${a.color}40` }}>{a.owner.replace('TM-', '')}</span>)}</div>
              <div className="arch-note">TM-01 … TM-10 · roles, never names</div>
            </Box>
            <Box x={COL.team[0]} y={250} w={COL.team[1]} h={330} id="agents" focus={focus} pick={pick} tone={C.team} icon={Bot} title="10 AI agents" sub="one shared memory">
              <div className="arch-agents">
                {s.roster.agents.map(a => (
                  <div key={a.id}><span className="ai" style={{ background: a.color }}><AgentIcon agent={a} size={11} /></span><b>{a.name}</b><em>{a.role.replace(/ Agent$| Engineer$|Solution | & Evaluation| & Guardrail/g, '')}</em></div>
                ))}
              </div>
            </Box>

            {/* column 2 — studio */}
            <div className="arch-box big" style={{ left: COL.studio[0], top: 40, width: COL.studio[1], height: 540, '--tone': C.studio }}>
              <div className="arch-box-h"><span className="arch-ic"><Layers size={16} /></span><div><b>ADLC Studio</b><small>Node 20 · Express · React 18 · Vite · SSE</small></div></div>
              <div className="arch-sub-h"><FileText size={12} />Spec-driven lifecycle · 6 gates</div>
              <div className="arch-stages">{['Plan', 'Design', 'Develop', 'Test', 'Review', 'Deploy'].map((x, i) => <React.Fragment key={x}><span>{x}</span>{i < 5 && <ChevronRight size={11} />}</React.Fragment>)}</div>
              <div className="arch-sub-h" style={{ marginTop: 14 }}><Workflow size={12} />Components</div>
              <div className="arch-tiles">
                <Tile id="orch" icon={Workflow} tone={C.studio} title="Orchestrator" sub={`${running} running`} focus={focus} pick={pick} />
                <Tile id="guard" icon={ShieldCheck} tone="#16a34a" title="Guardrails" sub="16 checks" focus={focus} pick={pick} />
                <Tile id="evals" icon={FlaskConical} tone="#65a30d" title="Evals" sub="acceptance · judge" focus={focus} pick={pick} />
                <Tile id="shield" icon={Lock} tone="#c026d3" title="Privacy shield" sub={`${fmt.n(s.privacy?.redactions ?? 0)} redacted`} focus={focus} pick={pick} />
                <Tile id="ledger" icon={Coins} tone="#d97706" title="Token ledger" sub={`${fmt.pct(e.savedPct)} saved`} focus={focus} pick={pick} />
                <Tile id="hitl" icon={UserCheck} tone="#16a34a" title="Human gate" sub={`${waiting} awaiting`} focus={focus} pick={pick} />
                <Tile id="edgert" icon={Factory} tone={C.product} title="Edge runtime" sub={`tick ${s.edge?.tick ?? 0}`} focus={focus} pick={pick} />
                <Tile id="sse" icon={Radio} tone="#475569" title="Live stream" sub="SSE to every UI" focus={focus} pick={pick} />
              </div>
              <div className="arch-kpis">
                <div><b className="grad-text">{fmt.k(e.tokensSaved ?? 0)}</b><span>tokens saved by Meko</span></div>
                <div><b>{gatesPassed(s)}</b><span>gates passed</span></div>
                <div><b>{Object.keys(deployed).length}/6</b><span>features live</span></div>
              </div>
            </div>

            {/* column 3 — managed services */}
            <Box x={COL.svc[0]} y={40} w={COL.svc[1]} h={150} id="claude" focus={focus} pick={pick} tone={C.claude} icon={Cpu} title="Claude API" sub={s.claude?.model}>
              <Chips items={['Messages · streaming', 'count_tokens']} tone={C.claude} />
              <Stat text={`${fmt.k(e.mekoIn ?? 0)} in · ${fmt.k(e.output ?? 0)} out`} tone={C.claude} />
            </Box>
            <Box x={COL.svc[0]} y={222} w={COL.svc[1]} h={176} id="meko" focus={focus} pick={pick} tone={C.meko} icon={Brain} title="Meko" sub="datapack iot-edge-adlc" hero>
              <Chips items={['memory_search', 'memory_add', 'knowledgebase_search', 'artifacts', 'token usage']} tone={C.meko} />
              <Stat text={`${fmt.n(s.meko?.memories?.length ?? 0)} memories · ${fmt.n(e.crossAgentReuse ?? 0)} reuses`} tone={C.meko} />
            </Box>
            <Box x={COL.svc[0]} y={430} w={COL.svc[1]} h={150} id="github" focus={focus} pick={pick} tone={C.github} icon={Github} title="GitHub" sub="seethb/adlc-demo">
              <Chips items={['commits', 'PRs · reviews', 'statuses', 'Actions', 'deploys']} tone={C.github} />
              <Stat text={`${s.github?.snapshot?.pulls?.length ?? 0} PRs · ${s.github?.snapshot?.deployments?.length ?? 0} deployments`} tone={C.github} />
            </Box>

            {/* column 4 — the product */}
            <Box x={COL.edge[0]} y={40} w={COL.edge[1]} h={540} id="edge" focus={focus} pick={pick} tone={C.product} icon={Rocket} title="Edge product" sub="edge-staging">
              <div className="arch-ot"><Network size={12} />Plant OT · OPC-UA · read-only</div>
              <div className="arch-rail">
                {s.features.map(f => {
                  const live = deployed[f.id];
                  return (
                    <div key={f.id} className={live ? 'live' : ''}>
                      <i />
                      <div><b>{f.id}</b>{f.title.replace(/\s*\(.*\)/, '').replace('Natural-language asset queries', 'NL asset queries').replace('Spare-parts inventory tracking', 'Inventory').replace('Streaming anomaly detection', 'Anomaly detection').replace('IoT telemetry simulator', 'Telemetry simulator')}</div>
                      <small>{live ? `live · PR #${live.pr}` : 'preview'}</small>
                    </div>
                  );
                })}
              </div>
              <div className="arch-ot" style={{ marginTop: 'auto' }}><KeyRound size={12} />MQTT 5 · mTLS · X.509 → cloud</div>
            </Box>
          </div>
        </div>
      </div>

      <div className="grid g-2-1">
        <Card title="Data flows & protection" hint="specs/02-design/security.md" icon={<Lock size={16} color="#c026d3" />}>
          <table className="t arch-flows">
            <thead><tr><th>Flow</th><th>Protocol</th><th>Auth / certificates</th><th>Class</th><th>Controls</th></tr></thead>
            <tbody>{FLOWS.map(f => <tr key={f[0]}><td><b>{f[0]}</b></td><td className="mono">{f[1]}</td><td>{f[2]}</td><td><Badge tone={f[3].startsWith('C2') ? 'amber' : f[3].startsWith('C0') ? 'green' : f[3] === 'Signed' ? 'violet' : 'blue'}>{f[3]}</Badge></td><td className="muted">{f[4]}</td></tr>)}</tbody>
          </table>
        </Card>
        <Card title={info.title} icon={<span className="arch-swatch" style={{ background: info.tone }} />} hint="selected component">
          <div className="arch-detail">
            <label>Technology</label>
            <ul>{info.tech.map(t => <li key={t}>{t}</li>)}</ul>
            <label>Data</label>
            <p>{info.data}</p>
            <label>Protection</label>
            <p className="row" style={{ alignItems: 'flex-start' }}><ShieldCheck size={14} color="#16a34a" style={{ flex: 'none', marginTop: 2 }} />{info.protect}</p>
          </div>
        </Card>
      </div>

      <div className="arch-stack">
        {STACK.map(([I, k, v]) => <div key={k} className="card"><span className="arch-ic"><I size={16} /></span><div><b>{k}</b><span>{v}</span></div></div>)}
      </div>
    </>
  );
}

function gatesPassed(s) {
  const stages = s.runs.filter(r => r.status !== 'superseded').flatMap(r => Object.values(r.stages));
  return `${stages.filter(x => x.status === 'passed').length}/${stages.filter(x => ['passed', 'failed'].includes(x.status)).length}`;
}

function Box({ x, y, w, h, id, focus, pick, tone, icon: I, title, sub, children, hero }) {
  return (
    <div className={`arch-box ${hero ? 'hero' : ''} ${focus(id)}`} style={{ left: x, top: y, width: w, height: h, '--tone': tone }} onClick={() => pick(id)}>
      <div className="arch-box-h">
        <span className="arch-ic"><I size={16} /></span>
        <div><b>{title}</b>{sub && <small>{sub}</small>}</div>
      </div>
      {children}
    </div>
  );
}

function Tile({ id, icon: I, tone, title, sub, focus, pick }) {
  return (
    <div className={`arch-tile ${focus(id)}`} style={{ '--tone': tone }} onClick={() => pick(id)}>
      <span className="arch-ic sm"><I size={14} /></span>
      <div><b>{title}</b><small>{sub}</small></div>
    </div>
  );
}

const Chips = ({ items, tone }) => <div className="arch-chips">{items.map(i => <span key={i} style={{ color: tone, background: `${tone}0d`, borderColor: `${tone}2e` }}>{i}</span>)}</div>;
const Stat = ({ text, tone }) => <div className="arch-stat" style={{ color: tone }}><i style={{ background: tone }} />{text}</div>;
