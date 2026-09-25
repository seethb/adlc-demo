import React, { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area, Legend } from 'recharts';
import { Coins, Recycle, Brain, TrendingDown, Calculator, Info } from 'lucide-react';
import { Card, Stat, Avatar, Badge, BarCompare, Empty } from '../components/ui.jsx';
import { fmt } from '../api.js';
import { agentOf } from './Mission.jsx';

const tip = { contentStyle: { background: '#121628', border: '1px solid rgba(148,163,255,0.28)', borderRadius: 12, fontSize: 12 }, labelStyle: { color: '#e8ebff' }, cursor: { fill: 'rgba(148,163,255,0.06)' } };
const ORDER = ['plan', 'design', 'develop', 'review', 'nlq', 'test', 'deploy'];

export default function Economics({ s }) {
  const e = s.economics;
  const [perMonth, setPerMonth] = useState(40);
  if (!e?.totals?.steps) return <Empty icon={<Coins />}>No agent steps recorded yet. Run a feature in the Pipeline or ask the fleet a question.</Empty>;
  const t = e.totals;
  const byStage = [...e.byStage].filter(x => x.baselineIn > 0).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)).map(x => ({ stage: x.key, 'Without Meko': x.baselineIn + x.baselineOut, 'With Meko': x.mekoIn + x.output }));
  const byAgent = [...e.byAgent].filter(x => x.baselineIn > 0).map(x => ({ agent: agentOf(s, x.key)?.name ?? x.key, 'Without Meko': x.baselineIn + x.baselineOut, 'With Meko': x.mekoIn + x.output }));
  // Per-feature averages over the features that have at least one measured step.
  const featureCount = Math.max(1, new Set(e.recent.concat(e.timeline.map(x => ({ feature: x.label.split(' ')[0] }))).map(r => r.feature).filter(f => /^F\d\d$/.test(f))).size);
  const perFeature = t.costSaved / featureCount;
  const perFeatureTok = t.tokensSaved / featureCount;

  return (
    <>
      <div className="grid g4">
        <Stat label="Total tokens — without Meko" icon={<Brain size={14} className="dim" />} value={fmt.k(t.baselineIn + t.baselineOut)} foot={`${fmt.k(t.baselineIn)} in · ${fmt.k(t.baselineOut)} out`} />
        <Stat label="Total tokens — with Meko" icon={<Brain size={14} color="#a78bfa" />} value={<span className="grad-text">{fmt.k(t.mekoIn + t.output)}</span>} foot={`${fmt.k(t.mekoIn)} in · ${fmt.k(t.output)} out · ${t.llmCalls} LLM calls`} />
        <Stat label="Saved" icon={<TrendingDown size={14} color="#86efac" />} value={<span style={{ color: '#86efac' }}>{fmt.pct(t.savedPct)}</span>} foot={`${fmt.k(t.tokensSaved)} tokens · ${fmt.usd(t.costSaved)}`} />
        <Stat label="Reuse" icon={<Recycle size={14} color="#67e8f9" />} value={fmt.n(t.crossAgentReuse)} foot={`cross-agent recalls · ${t.reusedArtifacts} artifacts reused with zero LLM tokens`} />
      </div>

      <div className="grid g2">
        <Card title="Tokens per stage" hint="input and output, summed over all runs">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byStage} barGap={4}>
              <CartesianGrid stroke="rgba(148,163,255,0.08)" vertical={false} />
              <XAxis dataKey="stage" stroke="#6b7399" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#6b7399" fontSize={11} tickFormatter={fmt.k} tickLine={false} axisLine={false} />
              <Tooltip {...tip} formatter={v => fmt.n(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Without Meko" fill="#64748b" radius={[6, 6, 0, 0]} />
              <Bar dataKey="With Meko" fill="url(#gm)" radius={[6, 6, 0, 0]} />
              <defs><linearGradient id="gm" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#a78bfa" /><stop offset="1" stopColor="#06b6d4" /></linearGradient></defs>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Cumulative LLM spend" hint={`${s.claude?.model} at $${s.claude?.price?.in}/$${s.claude?.price?.out} per million tokens`}>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={e.timeline}>
              <defs>
                <linearGradient id="ab" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#94a3b8" stopOpacity={0.4} /><stop offset="1" stopColor="#94a3b8" stopOpacity={0} /></linearGradient>
                <linearGradient id="am" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#8b5cf6" stopOpacity={0.6} /><stop offset="1" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148,163,255,0.08)" vertical={false} />
              <XAxis dataKey="i" stroke="#6b7399" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#6b7399" fontSize={11} tickFormatter={v => `$${v.toFixed(v < 1 ? 3 : 2)}`} tickLine={false} axisLine={false} />
              <Tooltip {...tip} formatter={v => `$${Number(v).toFixed(4)}`} labelFormatter={i => e.timeline[i - 1]?.label} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="baseline" name="Without Meko" stroke="#94a3b8" fill="url(#ab)" strokeWidth={2} />
              <Area type="monotone" dataKey="meko" name="With Meko" stroke="#a78bfa" fill="url(#am)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid g-3-2">
        <Card title="Tokens per agent">
          <ResponsiveContainer width="100%" height={Math.max(220, byAgent.length * 38)}>
            <BarChart data={byAgent} layout="vertical" barGap={2}>
              <CartesianGrid stroke="rgba(148,163,255,0.08)" horizontal={false} />
              <XAxis type="number" stroke="#6b7399" fontSize={11} tickFormatter={fmt.k} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="agent" stroke="#9aa3c7" fontSize={12} width={80} tickLine={false} axisLine={false} />
              <Tooltip {...tip} formatter={v => fmt.n(v)} />
              <Bar dataKey="Without Meko" fill="#64748b" radius={[0, 6, 6, 0]} />
              <Bar dataKey="With Meko" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Team-scale projection" icon={<Calculator size={16} color="#fcd34d" />} glow>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Uses the savings measured so far in this session.</div>
          <label className="dim" style={{ fontSize: 12 }}>Features shipped per month by the team: <b style={{ color: 'var(--text)' }}>{perMonth}</b></label>
          <input type="range" min={5} max={200} value={perMonth} onChange={ev => setPerMonth(Number(ev.target.value))} style={{ width: '100%', accentColor: '#8b5cf6', margin: '10px 0 16px' }} />
          <div className="grid g2" style={{ gap: 12 }}>
            <div className="card" style={{ padding: 14 }}><div className="dim" style={{ fontSize: 12 }}>Tokens saved / month</div><div className="grad-text" style={{ fontSize: 24, fontWeight: 800 }}>{fmt.k(perFeatureTok * perMonth)}</div></div>
            <div className="card" style={{ padding: 14 }}><div className="dim" style={{ fontSize: 12 }}>LLM spend avoided / year</div><div style={{ fontSize: 24, fontWeight: 800, color: '#86efac' }}>{fmt.usd(perFeature * perMonth * 12)}</div></div>
          </div>
          <div className="dim" style={{ fontSize: 11.5, marginTop: 12 }}>The gap widens as the datapack grows: a memory-less agent's context grows with every spec and artifact, while Meko recall stays at top-k.</div>
        </Card>
      </div>

      <Card title="Ledger" hint="every agent step, newest first" icon={<Info size={16} className="dim" />}>
        <div style={{ maxHeight: 420, overflow: 'auto' }}>
          <table className="t">
            <thead><tr><th>Time</th><th>Agent</th><th>Feature · stage</th><th className="num">Baseline in</th><th className="num">Meko in</th><th className="num">Output</th><th>Saving</th><th className="num">Recalled</th><th className="num">Written</th></tr></thead>
            <tbody>
              {e.recent.map((r, i) => (
                <tr key={i}>
                  <td className="mono dim">{r.at.slice(11, 19)}</td>
                  <td><div className="row" style={{ gap: 6 }}><Avatar agent={agentOf(s, r.agent)} size="sm" />{agentOf(s, r.agent)?.name}</div></td>
                  <td>{r.feature} · {r.stage} {r.reused && <Badge tone="violet">♻ reused</Badge>}</td>
                  <td className="num mono">{fmt.n(r.baselineIn)}</td>
                  <td className="num mono" style={{ color: '#c4b5fd' }}>{fmt.n(r.mekoIn)}</td>
                  <td className="num mono">{fmt.n(r.output)}</td>
                  <td style={{ width: 160 }}>{r.baselineIn ? <BarCompare baseline={r.baselineIn} meko={r.mekoIn} labelBase="" labelMeko="" unit="" /> : <span className="dim">no LLM</span>}</td>
                  <td className="num mono">{r.recalled}</td>
                  <td className="num mono">{r.written}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
