import React, { useState } from 'react';
import { Brain, ShieldCheck, FlaskConical, FolderLock, Coins, Recycle, PenLine } from 'lucide-react';
import { Card, Avatar, Badge, Drawer } from '../components/ui.jsx';
import { fmt } from '../api.js';
import { agentOf } from './Mission.jsx';

export default function Agents({ s }) {
  const [sel, setSel] = useState(null);
  const econ = s.economics ?? {};
  const by = Object.fromEntries((econ.byAgent ?? []).map(a => [a.key, a]));
  const edges = econ.edges ?? [];
  const reusedBy = id => edges.filter(e => e.from === id).reduce((n, e) => n + e.n, 0);
  const reusedFrom = id => edges.filter(e => e.to === id).reduce((n, e) => n + e.n, 0);

  return (
    <>
      <div className="grid g-3-2">
        <Card title="Memory reuse network" hint="an arrow means one agent recalled a memory another wrote — each one is context that didn't have to be re-derived" glow>
          <ReuseGraph s={s} edges={edges} onPick={setSel} />
        </Card>
        <Card title="Top knowledge contributors" hint="whose memories other agents recalled most">
          <div className="col" style={{ gap: 10 }}>
            {[{ id: 'org', name: 'Org standards', role: 'adlc:org', color: '#64748b', icon: 'x' }, ...s.roster.agents].map(a => ({ a, n: reusedBy(a.id) })).sort((x, y) => y.n - x.n).map(({ a, n }) => {
              const max = Math.max(1, ...[...s.roster.agents.map(x => reusedBy(x.id)), reusedBy('org')]);
              return (
                <div key={a.id} className="row">
                  <Avatar agent={a} size="sm" />
                  <span style={{ width: 110, fontWeight: 600, fontSize: 12.5 }}>{a.name}</span>
                  <div className="gauge" style={{ flex: 1, height: 8 }}><span style={{ width: `${(n / max) * 100}%`, background: `linear-gradient(90deg, ${a.color}, #06b6d4)` }} /></div>
                  <span className="mono" style={{ width: 40, textAlign: 'right' }}>{n}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid g5">
        {s.roster.agents.map(a => {
          const e = by[a.id];
          return (
            <div key={a.id} className="card" style={{ cursor: 'pointer', padding: 16 }} onClick={() => setSel(a)}>
              <div className="row"><Avatar agent={a} size="lg" /><div style={{ minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 15 }}>{a.name}</div><div className="dim ellipsis" style={{ fontSize: 12 }}>{a.role}</div></div></div>
              <div className="row wrap" style={{ gap: 5, margin: '12px 0 10px' }}>
                <Badge tone="gray">{a.owner}</Badge><Badge tone="violet">{a.stages.join(', ')}</Badge>{a.features[0] !== '*' && <Badge tone="cyan">{a.features.join(', ')}</Badge>}
              </div>
              <div className="grid g2" style={{ gap: 8, fontSize: 12 }}>
                <div><div className="dim">Tokens saved</div><div className="mono" style={{ color: '#c4b5fd', fontWeight: 700 }}>{e ? fmt.k(e.baselineIn + e.baselineOut - e.mekoIn - e.output) : '—'}</div></div>
                <div><div className="dim">Steps</div><div className="mono">{e?.steps ?? 0}</div></div>
                <div><div className="dim">Recalled</div><div className="mono">{e?.recalled ?? 0} <span className="dim">({reusedFrom(a.id)} from others)</span></div></div>
                <div><div className="dim">Written</div><div className="mono">{e?.written ?? 0} <span className="dim">(reused {reusedBy(a.id)}×)</span></div></div>
              </div>
            </div>
          );
        })}
      </div>

      {sel && <AgentDrawer s={s} a={sel.stages ? sel : null} onClose={() => setSel(null)} econ={by[sel.id]} />}
    </>
  );
}

function ReuseGraph({ s, edges, onPick }) {
  const W = 620, H = 400, cx = W / 2, cy = H / 2;
  const nodes = [{ id: 'org', name: 'Org', color: '#64748b', icon: 'x' }, ...s.roster.agents];
  const pos = Object.fromEntries(nodes.map((n, i) => {
    if (n.id === 'org') return [n.id, [cx, cy]];
    const a = ((i - 1) / (nodes.length - 1)) * Math.PI * 2 - Math.PI / 2;
    return [n.id, [cx + Math.cos(a) * 165, cy + Math.sin(a) * 150]];
  }));
  const max = Math.max(1, ...edges.map(e => e.n));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 400 }}>
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#a78bfa" /></marker>
        <radialGradient id="core"><stop offset="0" stopColor="#8b5cf6" stopOpacity="0.5" /><stop offset="1" stopColor="#8b5cf6" stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r="120" fill="url(#core)" />
      <text x={cx} y={cy + 52} textAnchor="middle" fill="#8b90b8" fontSize="11">Meko datapack iot-edge-adlc</text>
      {edges.filter(e => pos[e.from] && pos[e.to] && e.from !== e.to).map((e, i) => {
        const [x1, y1] = pos[e.from], [x2, y2] = pos[e.to];
        const mx = (x1 + x2) / 2 + (y2 - y1) * 0.18, my = (y1 + y2) / 2 - (x2 - x1) * 0.18;
        const dx = x2 - mx, dy = y2 - my, L = Math.hypot(dx, dy) || 1;
        return <path key={i} d={`M${x1},${y1} Q${mx},${my} ${x2 - (dx / L) * 22},${y2 - (dy / L) * 22}`} fill="none" stroke="#a78bfa" strokeOpacity={0.25 + 0.6 * (e.n / max)} strokeWidth={1 + 4 * (e.n / max)} markerEnd="url(#arr)" className="flow-line"><title>{`${e.from} → ${e.to}: ${e.n} memories`}</title></path>;
      })}
      {nodes.map(n => {
        const [x, y] = pos[n.id];
        return (
          <g key={n.id} transform={`translate(${x},${y})`} style={{ cursor: 'pointer' }} onClick={() => onPick(n)}>
            <circle r={n.id === 'org' ? 24 : 19} fill={n.color} opacity="0.95" stroke="#0b0e1a" strokeWidth="3" />
            <text y={n.id === 'org' ? 4 : 4} textAnchor="middle" fill="white" fontSize="11" fontWeight="800">{n.name.slice(0, 3)}</text>
            {n.id !== 'org' && <text y={34} textAnchor="middle" fill="#c9cdea" fontSize="11" fontWeight="600">{n.name}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function AgentDrawer({ s, a, onClose, econ }) {
  if (!a) return null;
  const mems = (s.meko?.memories ?? []).filter(m => m.agent === `adlc:${a.id}`);
  return (
    <Drawer open onClose={onClose} icon={<Avatar agent={a} size="lg" />} title={`${a.name} — ${a.role}`} subtitle={`Human owner ${a.owner} · ${a.ownerRole} · Meko agent_id adlc:${a.id}`}>
      <div className="grid g3">
        <Card title="Stages"><div className="row wrap">{a.stages.map(x => <Badge key={x} tone="violet">{x}</Badge>)}{a.features.map(x => <Badge key={x} tone="cyan">{x === '*' ? 'all features' : x}</Badge>)}</div></Card>
        <Card title="Token budget"><div className="mono" style={{ fontSize: 20, fontWeight: 800 }}>{fmt.n(a.tokenBudget)}</div><div className="dim" style={{ fontSize: 12 }}>input tokens per stage</div></Card>
        <Card title="Savings"><div className="mono grad-text" style={{ fontSize: 20, fontWeight: 800 }}>{econ ? fmt.k(econ.baselineIn + econ.baselineOut - econ.mekoIn - econ.output) : '—'}</div><div className="dim" style={{ fontSize: 12 }}>tokens vs memory-less</div></Card>
      </div>
      <Card title="Write scope" icon={<FolderLock size={16} />}>{a.scope.length ? a.scope.map(p => <div key={p} className="mono">{p}</div>) : <span className="dim">read-only agent</span>}</Card>
      <Card title="Guardrails" icon={<ShieldCheck size={16} color="#86efac" />}>
        <table className="t"><tbody>{a.guardrails.map(g => <tr key={g}><td className="mono" style={{ width: 200 }}>{g}</td><td className="muted">{s.gates.guardrails[g]?.description}</td><td><Badge tone={s.gates.guardrails[g]?.severity === 'block' ? 'red' : 'amber'}>{s.gates.guardrails[g]?.severity}</Badge></td></tr>)}</tbody></table>
      </Card>
      <Card title="Evals" icon={<FlaskConical size={16} color="#a3e635" />}>
        {Object.keys(a.evals).length ? <table className="t"><tbody>{Object.entries(a.evals).map(([k, v]) => <tr key={k}><td className="mono" style={{ width: 200 }}>{k}</td><td>≥ {v}</td><td className="muted">{s.gates.evals[k]?.description}</td></tr>)}</tbody></table> : <span className="dim">Release gate: all statuses green and a human approval.</span>}
      </Card>
      <Card title={`Memories written by ${a.name} (${mems.length})`} icon={<PenLine size={16} color="#fcd34d" />}>
        <div className="col">{mems.slice(0, 30).map((m, i) => <div key={i} className="mem"><div className="who"><Badge tone="gray">{m.metadata?.kind}</Badge>{m.metadata?.feature && <Badge tone="cyan">{m.metadata.feature}</Badge>}<span style={{ marginLeft: 'auto' }}>{fmt.ago(m.at)}</span></div><div>{m.text}</div></div>)}{!mems.length && <span className="dim">Nothing yet.</span>}</div>
      </Card>
    </Drawer>
  );
}
