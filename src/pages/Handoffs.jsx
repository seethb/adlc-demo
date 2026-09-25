import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, SkipForward, Radio, Brain, Sparkles, Recycle, ShieldCheck, FlaskConical, GitBranch, ArrowRight, History, Grid3x3 } from 'lucide-react';
import { Card, Badge, Tabs, AgentIcon, Empty } from '../components/ui.jsx';
import { fmt } from '../api.js';

const STAGES = ['plan', 'design', 'develop', 'test', 'review', 'deploy'];
const ORG = { id: 'org', name: 'Org', role: 'Team standards (adlc:org)', color: '#64748b', icon: 'shield' };
const W = 1000, H = 640, CX = 500, CY = 320;

// Scripted scenarios — patterns that happen in real runs, told step by step.
const SCENARIOS = {
  design: {
    title: 'A design decision travels downstream', icon: GitBranch,
    steps: [
      { writer: 'vega', reader: 'lyra', feature: 'F02', stage: 'develop', kind: 'decision', text: 'F02 anomaly shape: { id, ts, assetId, assetType, severity: low|medium|high|critical, rule, failureMode, confidence, metrics[] }.' },
      { writer: 'vega', reader: 'nova', feature: 'F03', stage: 'design', kind: 'decision', text: 'F02 anomaly shape: { id, ts, assetId, assetType, severity, rule, failureMode, … } — F03 raises work orders from it.' },
      { writer: 'nova', reader: 'nova', feature: 'F04', stage: 'develop', kind: 'decision', text: 'F03 priority mapping: critical→P1, high→P2, medium→P3; one open WO per asset + failure mode.', self: true },
      { writer: 'nova', reader: 'sage', feature: 'F06', stage: 'design', kind: 'decision', text: 'Work orders carry { id, priority, status, title, occurrences } — F06 lists open WOs from this shape.' },
    ],
    outcome: 'Four agents build against one shape without anyone re-reading the F02 spec or design.',
  },
  lesson: {
    title: 'A failed test becomes a lesson', icon: FlaskConical,
    steps: [
      { writer: 'quill', reader: 'rigel', feature: 'F05', stage: 'develop', kind: 'lesson', text: 'Test lesson F05: AC-F05-3 needs exactly one open requisition per SKU at the reorder point; AC-F05-4 receive() must restock and close it.' },
      { writer: 'sentinel', reader: 'rigel', feature: 'F05', stage: 'develop', kind: 'lesson', text: 'Review finding: reservations keyed by ref must not overwrite — re-reserving a WO leaked stock.' },
      { writer: 'rigel', reader: 'quill', feature: 'F05', stage: 'test', kind: 'decision', text: 'F05 reservations are an append-only list per ref; consume(ref) and release(ref) clear all entries for that ref.' },
      { writer: 'quill', reader: 'helm', feature: 'F05', stage: 'deploy', kind: 'test-result', text: 'Test result F05: 5/5 acceptance tests and behavioural eval (0 negative states) passed.' },
    ],
    outcome: 'The fix is driven by what Quill and Sentinel wrote — the developer never re-runs the whole investigation.',
  },
  security: {
    title: 'A security rule reaches every agent', icon: ShieldCheck,
    steps: [
      { writer: 'org', reader: 'vega', feature: 'F01', stage: 'design', kind: 'security-standard', text: 'Transport security: gateway→cloud is MQTT 5 on 8883 over TLS 1.3 with a per-device X.509 certificate; plaintext mqtt:// is forbidden.' },
      { writer: 'org', reader: 'lyra', feature: 'F02', stage: 'develop', kind: 'security-standard', text: 'IoT security standard: treat telemetry as untrusted input — reject NaN/Infinity, unknown assets and metrics.' },
      { writer: 'org', reader: 'nova', feature: 'F03', stage: 'develop', kind: 'security-standard', text: 'IoT security standard: edge analytics is read-only towards OT — never write PLC registers, coils or setpoints.' },
      { writer: 'org', reader: 'sentinel', feature: 'F03', stage: 'review', kind: 'security-standard', text: 'Privacy standard: no PII in prompts, memories or PRs — names, emails, phones, national ids, addresses.' },
    ],
    outcome: 'One standard, written once, is recalled at the exact stage each agent needs it.',
  },
  reuse: {
    title: 'An artifact is reused at zero tokens', icon: Recycle,
    steps: [
      { writer: 'vega', reader: 'vega', feature: 'F04', stage: 'design', kind: 'artifact', text: 'ARTIFACT F04 design spec 9c1e…: Vega’s design for CARs, stored by content hash.', self: true },
      { writer: 'vega', reader: 'nova', feature: 'F04', stage: 'develop', kind: 'artifact', text: 'Nova recalls the design artifact by hash — no need to regenerate it.' },
      { writer: 'nova', reader: 'nova', feature: 'F04', stage: 'develop', kind: 'artifact', text: 'Re-run with an unchanged spec: code artifact found in Meko → reused, 0 LLM tokens.', self: true },
    ],
    outcome: 'Unchanged work is never paid for twice — the ledger records the reuse as zero tokens.',
  },
};

export default function Handoffs({ s }) {
  const agents = useMemo(() => [ORG, ...s.roster.agents], [s.roster]);
  const byId = useMemo(() => Object.fromEntries(agents.map(a => [a.id, a])), [agents]);
  const pos = useMemo(() => Object.fromEntries(agents.map((a, i) => {
    const t = (i / agents.length) * Math.PI * 2 - Math.PI / 2;
    return [a.id, [CX + Math.cos(t) * 380, CY + Math.sin(t) * 250]];
  })), [agents]);

  // Every real cross-agent recall recorded in pipeline runs.
  const events = useMemo(() => {
    const out = [], seen = new Set();
    for (const r of s.runs) for (const st of STAGES) {
      const x = r.stages?.[st];
      if (!x?.recalled?.length) continue;
      for (const m of x.recalled) {
        const writer = (m.agent ?? '').replace('adlc:', '');
        if (!writer || writer === x.agent || !byId[writer] || !byId[x.agent]) continue;
        const key = `${writer}|${x.agent}|${r.feature}|${st}|${m.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, at: x.startedAt ?? r.createdAt, writer, reader: x.agent, text: m.text, kind: m.kind, score: m.score, feature: r.feature, stage: st, run: r.id });
      }
    }
    return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }, [s.runs, byId]);

  const [mode, setMode] = useState('replay');
  const [scenario, setScenario] = useState('design');
  const [range, setRange] = useState('latest');
  const seq = mode === 'simulate' ? SCENARIOS[scenario].steps : mode === 'replay' && range === 'latest' ? events.slice(-40) : events;
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [t, setT] = useState(0);
  const played = useRef(new Map());
  const [, force] = useState(0);
  const liveCount = useRef(events.length);

  useEffect(() => { setIdx(0); setT(0); played.current = new Map(); force(x => x + 1); setPlaying(mode !== 'live'); }, [mode, scenario, range]);

  // Live mode: animate each new handoff as runs record it.
  useEffect(() => {
    if (mode !== 'live') { liveCount.current = events.length; return; }
    if (events.length > liveCount.current) { setIdx(liveCount.current); setT(0); setPlaying(true); }
    liveCount.current = events.length;
  }, [events.length, mode]);

  // Packet animation: writer → Meko (0–0.5) → reader (0.5–1).
  useEffect(() => {
    if (!playing || !seq.length) return;
    let raf, last = performance.now();
    const tick = now => {
      const dt = (now - last) / 1000; last = now;
      setT(prev => {
        const next = prev + dt * 0.55 * speed;
        if (next < 1) return next;
        const ev = seq[idx];
        if (ev && !ev.self) { const k = `${ev.writer}>${ev.reader}`; played.current.set(k, (played.current.get(k) ?? 0) + 1); }
        if (idx + 1 < seq.length) { setIdx(i => i + 1); return 0; }
        setPlaying(false); force(x => x + 1); return 1;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, idx, seq, speed]);

  const ev = seq[Math.min(idx, seq.length - 1)];
  const packet = ev && t < 1 ? packetAt(ev, t, pos) : null;
  const phase = t < 0.5 ? 'write' : 'recall';

  const matrix = useMemo(() => {
    const m = {};
    for (const e of events) m[`${e.writer}>${e.reader}`] = (m[`${e.writer}>${e.reader}`] ?? 0) + 1;
    return m;
  }, [events]);
  const maxCell = Math.max(1, ...Object.values(matrix));
  const top = Object.entries(matrix).sort((a, b) => b[1] - a[1]).slice(0, 1)[0];

  return (
    <>
      <div className="arch-head card">
        <div>
          <div className="arch-title">Agent → <span className="grad-text">Meko</span> → agent: how context moves between the team</div>
          <div className="muted" style={{ fontSize: 13 }}>Agents never message each other directly. One writes a decision, lesson or artifact to the shared datapack; another recalls it at the moment it needs it.</div>
        </div>
        <div className="arch-legend"><span><i style={{ background: '#7c3aed' }} />write (memory_add)</span><span><i style={{ background: '#0891b2' }} />recall (memory_search)</span></div>
      </div>

      <div className="grid g4">
        <Kpi icon={<Sparkles size={14} color="#7c3aed" />} label="Cross-agent handoffs" value={fmt.n(events.length)} foot="recalls of another agent’s memory" />
        <Kpi icon={<Brain size={14} color="#0891b2" />} label="Agents that received context" value={new Set(events.map(e => e.reader)).size} foot={`from ${new Set(events.map(e => e.writer)).size} writers`} />
        <Kpi icon={<ArrowRight size={14} color="#d97706" />} label="Busiest handoff" value={top ? `${byId[top[0].split('>')[0]]?.name} → ${byId[top[0].split('>')[1]]?.name}` : '—'} foot={top ? `${top[1]} recalls` : 'run a feature'} small />
        <Kpi icon={<Recycle size={14} color="#16a34a" />} label="Tokens saved by shared context" value={fmt.k(s.economics?.totals?.tokensSaved ?? 0)} foot="vs agents re-reading everything" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.75fr) minmax(300px, 1fr)', alignItems: 'start' }}>
        <div className="card arch-stage">
          <div className="arch-steps">
            <Tabs value={mode} onChange={setMode} options={[{ value: 'replay', label: 'Replay real handoffs' }, { value: 'simulate', label: 'Simulate a scenario' }, { value: 'live', label: 'Live' }]} />
            {mode === 'simulate' && (
              <select className="input" style={{ width: 'auto' }} value={scenario} onChange={e => setScenario(e.target.value)}>
                {Object.entries(SCENARIOS).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
              </select>
            )}
            {mode === 'replay' && <Tabs value={range} onChange={setRange} options={[{ value: 'latest', label: 'Latest 40' }, { value: 'all', label: `All ${events.length}` }]} />}
            {mode !== 'live' && <>
              <button className="btn sm primary" onClick={() => { if (idx >= seq.length - 1 && t >= 1) { setIdx(0); setT(0); played.current = new Map(); } setPlaying(p => !p); }} disabled={!seq.length}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? 'Pause' : 'Play'}</button>
              <button className="btn sm" onClick={() => { setT(0); setIdx(i => Math.min(seq.length - 1, i + 1)); }} disabled={!seq.length}><SkipForward size={14} />Next</button>
              <Tabs value={speed} onChange={setSpeed} options={[{ value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 4, label: '4×' }]} />
            </>}
            {mode === 'live' && <span className="row" style={{ fontSize: 12.5 }}><Radio size={14} color="#16a34a" className={playing ? 'spin' : ''} />Waiting for agents to recall each other’s memories — run a feature in the Pipeline.</span>}
          </div>

          <div className="ho-canvas">
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
              <defs>
                <radialGradient id="hoHub"><stop offset="0" stopColor="#ede9fe" /><stop offset="1" stopColor="#ede9fe" stopOpacity="0" /></radialGradient>
                <filter id="hoGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
              </defs>
              <circle cx={CX} cy={CY} r={200} fill="url(#hoHub)" />
              <ellipse cx={CX} cy={CY} rx={380} ry={250} fill="none" stroke="#eceff5" strokeDasharray="3 6" />

              {/* accumulated handoffs (played so far) */}
              {[...played.current.entries()].map(([k, n]) => {
                const [w, r] = k.split('>');
                if (!pos[w] || !pos[r]) return null;
                return <path key={k} d={curve(pos[w], pos[r])} fill="none" stroke="#a78bfa" strokeOpacity={0.18 + Math.min(0.5, n * 0.08)} strokeWidth={1 + Math.min(4, n * 0.6)} />;
              })}

              {/* spokes to Meko */}
              {agents.map(a => {
                const active = ev && (a.id === ev.writer || a.id === ev.reader) && t < 1;
                const col = ev && a.id === ev.writer && phase === 'write' ? '#7c3aed' : ev && a.id === ev.reader && phase === 'recall' ? '#0891b2' : '#e2e8f0';
                return <line key={a.id} x1={pos[a.id][0]} y1={pos[a.id][1]} x2={CX} y2={CY} stroke={active ? col : '#eef1f6'} strokeWidth={active ? 2.5 : 1} strokeDasharray={active ? '0' : '2 5'} />;
              })}

              {/* Meko hub */}
              <circle cx={CX} cy={CY} r={62} fill="#ffffff" stroke="#c4b5fd" strokeWidth="2" />
              {packet && <circle cx={CX} cy={CY} r={62 + (phase === 'write' ? t * 30 : (1 - t) * 30)} fill="none" stroke={phase === 'write' ? '#7c3aed' : '#0891b2'} strokeOpacity={0.25} strokeWidth="6" />}
              <text x={CX} y={CY - 4} textAnchor="middle" fontSize="20" fontWeight="800" fill="#5b21b6">Meko</text>
              <text x={CX} y={CY + 16} textAnchor="middle" fontSize="10.5" fill="#64748b">iot-edge-adlc</text>

              {/* agents */}
              {agents.map(a => {
                const [x, y] = pos[a.id];
                const isW = ev && a.id === ev.writer && t < 1, isR = ev && a.id === ev.reader && t < 1;
                return (
                  <g key={a.id} transform={`translate(${x},${y})`}>
                    {(isW || isR) && <circle r={34} fill={isW && phase === 'write' ? '#7c3aed' : '#0891b2'} opacity={0.25} filter="url(#hoGlow)" />}
                    <circle r={25} fill={a.color} stroke="#fff" strokeWidth="3" />
                    <foreignObject x={-10} y={-10} width={20} height={20}><div style={{ color: '#fff', display: 'grid', placeItems: 'center', height: 20 }}>{a.id === 'org' ? <ShieldCheck size={16} /> : <AgentIcon agent={a} size={16} />}</div></foreignObject>
                    <text y={44} textAnchor="middle" fontSize="12.5" fontWeight="750" fill="#0f172a">{a.name}</text>
                    <text y={58} textAnchor="middle" fontSize="10" fill="#94a3b8">{a.id === 'org' ? 'standards' : a.owner}</text>
                  </g>
                );
              })}

              {/* the travelling memory packet */}
              {packet && (
                <g transform={`translate(${packet[0]},${packet[1]})`}>
                  <circle r={14} fill={phase === 'write' ? '#7c3aed' : '#0891b2'} opacity={0.2} />
                  <rect x={-11} y={-8} width={22} height={16} rx={4} fill={phase === 'write' ? '#7c3aed' : '#0891b2'} />
                  <path d="M-7,-3 L0,2 L7,-3" stroke="#fff" strokeWidth="1.6" fill="none" />
                </g>
              )}
            </svg>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <Card title={mode === 'simulate' ? SCENARIOS[scenario].title : mode === 'live' ? 'Latest handoff' : 'Now replaying'} hint={seq.length ? `${Math.min(idx + 1, seq.length)} of ${seq.length}` : ''} glow>
            {ev ? (
              <div className="col" style={{ gap: 12 }}>
                <div className="ho-route">
                  <Who a={byId[ev.writer]} label="wrote" active={phase === 'write' && t < 1} tone="#7c3aed" />
                  <div className="ho-mid"><Brain size={16} color="#7c3aed" /><small>Meko</small></div>
                  <Who a={byId[ev.reader]} label={ev.self ? 'reuses' : 'recalled'} active={phase === 'recall' && t < 1} tone="#0891b2" />
                </div>
                <div className="row wrap" style={{ gap: 5 }}>
                  <Badge tone="cyan">{ev.feature}</Badge><Badge tone="violet">{ev.stage}</Badge>
                  {ev.kind && <Badge tone={String(ev.kind).includes('security') ? 'red' : ev.kind === 'lesson' ? 'amber' : ev.kind === 'artifact' ? 'blue' : 'gray'}>{ev.kind}</Badge>}
                  {ev.score && <span className="mono dim" style={{ fontSize: 11 }}>relevance {Number(ev.score).toFixed(2)}</span>}
                  {ev.at && mode !== 'simulate' && <span className="dim" style={{ fontSize: 11 }}>{fmt.time(ev.at)}</span>}
                </div>
                <div className="ho-memory">“{ev.text}”</div>
                <div className="gauge"><span style={{ width: `${((idx + Math.min(t, 1)) / Math.max(1, seq.length)) * 100}%`, background: 'var(--grad)' }} /></div>
                {mode === 'simulate' && idx >= seq.length - 1 && t >= 1 && <div className="badge b-green" style={{ whiteSpace: 'normal', padding: '6px 10px' }}>{SCENARIOS[scenario].outcome}</div>}
              </div>
            ) : <Empty>{mode === 'live' ? 'No handoffs yet in this session.' : 'No cross-agent recalls recorded yet — run a feature in the Pipeline.'}</Empty>}
          </Card>
          <Card title="Handoff log" icon={<History size={16} className="dim" />}>
            <div className="feed" style={{ maxHeight: 300 }}>
              {seq.slice(0, Math.min(seq.length, idx + 1)).slice(-30).reverse().map((e, i) => (
                <div key={e.key ?? i} className="feed-item" style={{ gridTemplateColumns: 'auto 1fr' }}>
                  <span className="row" style={{ gap: 4 }}><Dot a={byId[e.writer]} /><ArrowRight size={11} className="dim" /><Dot a={byId[e.reader]} /></span>
                  <div className="main-t" title={e.text}><b>{byId[e.writer]?.name} → {byId[e.reader]?.name}</b> <span className="dim">{e.feature} {e.stage} · {e.text}</span></div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid g2">
        <Card title="Who feeds whom" hint="rows wrote the memory · columns recalled it" icon={<Grid3x3 size={16} color="#7c3aed" />}>
          {events.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="ho-matrix">
                <thead><tr><th />{agents.map(a => <th key={a.id} title={a.name}><Dot a={a} /></th>)}</tr></thead>
                <tbody>{agents.map(w => (
                  <tr key={w.id}><th><span className="row" style={{ gap: 6 }}><Dot a={w} />{w.name}</span></th>{agents.map(r => {
                    const n = matrix[`${w.id}>${r.id}`] ?? 0;
                    return <td key={r.id} title={`${w.name} → ${r.name}: ${n}`} style={{ background: n ? `rgba(124, 58, 237, ${0.08 + 0.72 * (n / maxCell)})` : undefined, color: n / maxCell > 0.5 ? '#fff' : '#334155' }}>{n || ''}</td>;
                  })}</tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty>No handoffs recorded yet.</Empty>}
        </Card>
        <ContextThread s={s} byId={byId} />
      </div>
    </>
  );
}

// For one feature: what each stage's agent inherited from others through Meko.
function ContextThread({ s, byId }) {
  const withRuns = s.features.filter(f => s.runs.some(r => r.feature === f.id));
  const [fid, setFid] = useState(withRuns[0]?.id ?? s.features[0]?.id);
  const run = s.runs.find(r => r.feature === fid && STAGES.some(st => r.stages?.[st]?.recalled?.length));
  return (
    <Card title="Context thread for a feature" hint="what each stage inherited through Meko" icon={<GitBranch size={16} color="#0891b2" />}
      right={<select className="input" style={{ width: 'auto' }} value={fid} onChange={e => setFid(e.target.value)}>{s.features.map(f => <option key={f.id} value={f.id}>{f.id} · {f.title}</option>)}</select>}>
      {run ? (
        <div className="ho-thread">
          {STAGES.map(st => {
            const x = run.stages[st];
            if (!x || x.status === 'pending') return null;
            const a = byId[x.agent];
            const from = (x.recalled ?? []).filter(m => m.agent && m.agent !== `adlc:${x.agent}`);
            const writers = [...new Set(from.map(m => m.agent.replace('adlc:', '')))];
            return (
              <div key={st} className="ho-stage">
                <div className="ho-stage-h"><Dot a={a} /><b>{st}</b><span className="dim">{a?.name}</span>{x.tokens?.baseline ? <Badge tone="green">−{Math.round((1 - x.tokens.meko / Math.max(1, x.tokens.baseline)) * 100)}% tokens</Badge> : null}</div>
                {writers.length ? <div className="row wrap" style={{ gap: 5 }}><span className="dim" style={{ fontSize: 11.5 }}>inherited from</span>{writers.map(w => <span key={w} className="ho-chip"><Dot a={byId[w]} />{byId[w]?.name ?? w} · {from.filter(m => m.agent === `adlc:${w}`).length}</span>)}</div> : <span className="dim" style={{ fontSize: 11.5 }}>no context from other agents</span>}
                {(x.decisions ?? []).length > 0 && <div className="ho-passes">passes on: {x.decisions[0]}</div>}
              </div>
            );
          })}
        </div>
      ) : <Empty>No runs with recalled context for this feature yet.</Empty>}
    </Card>
  );
}

function packetAt(ev, t, pos) {
  const a = pos[ev.writer], b = pos[ev.reader], hub = [CX, CY];
  if (!a || !b) return null;
  const ease = x => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
  if (t < 0.5) { const k = ease(t / 0.5); return [a[0] + (hub[0] - a[0]) * k, a[1] + (hub[1] - a[1]) * k]; }
  const k = ease((t - 0.5) / 0.5);
  return [hub[0] + (b[0] - hub[0]) * k, hub[1] + (b[1] - hub[1]) * k];
}

function curve(a, b) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const cx = mx + (CX - mx) * 0.55, cy = my + (CY - my) * 0.55;
  return `M${a[0]},${a[1]} Q${cx},${cy} ${b[0]},${b[1]}`;
}

const Dot = ({ a }) => <span className="ho-dot" style={{ background: a?.color ?? '#94a3b8' }} title={a?.name} />;

function Who({ a, label, active, tone }) {
  return (
    <div className={`ho-who ${active ? 'on' : ''}`} style={{ '--tone': tone }}>
      <span className="ho-av" style={{ background: a?.color }}>{a?.id === 'org' ? <ShieldCheck size={16} /> : <AgentIcon agent={a} size={16} />}</span>
      <b>{a?.name}</b><small>{label}</small>
    </div>
  );
}

function Kpi({ icon, label, value, foot, small }) {
  return <div className="card stat"><div className="label">{icon}{label}</div><div className="value" style={small ? { fontSize: 19 } : undefined}>{value}</div><div className="foot">{foot}</div></div>;
}
