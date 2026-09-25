import React, { useState } from 'react';
import { Coins, Brain, Rocket, ShieldCheck, Play, GitPullRequest, Github, Zap, Recycle, Lock, ArrowRight, Factory } from 'lucide-react';
import { Card, Stat, Avatar, StatusIcon, Badge, Sparkline } from '../components/ui.jsx';
import { post, fmt } from '../api.js';
import { STAGES, agentOf, latestRun } from '../lib.js';


export default function Mission({ s, go }) {
  const [busy, setBusy] = useState(false);
  const e = s.economics?.totals ?? {};
  const deployed = Object.keys(s.deployments ?? {}).length;
  const allStages = s.runs.filter(r => r.status !== 'superseded').flatMap(r => Object.values(r.stages));
  const passed = allStages.filter(x => x.status === 'passed').length;
  const decided = allStages.filter(x => ['passed', 'failed'].includes(x.status)).length;
  const tl = s.economics?.timeline ?? [];
  const sprint = async () => { setBusy(true); try { await post('/sprint', {}); go('pipeline'); } finally { setBusy(false); } };

  return (
    <>
      <div className="card glow hero">
        <HeroArt />
        <div className="row" style={{ gap: 8, marginBottom: 10 }}><Badge tone="violet"><Brain size={11} />Meko shared memory</Badge><Badge tone="cyan"><Github size={11} />Live GitHub</Badge><Badge tone="amber"><Zap size={11} />{s.claude?.model}</Badge><Badge tone="pink"><Lock size={11} />PII shield on</Badge></div>
        <h1>10 agents. <span className="grad-text">One shared memory.</span> Six gates to production.</h1>
        <p>A spec-driven team builds an IoT edge analytics product. Each agent recalls the team's decisions and knowledge from one Meko datapack instead of re-reading the whole project. Every stage lands on GitHub and must pass its guardrails and evals.</p>
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn primary" onClick={sprint} disabled={busy || s.runs.some(r => r.status === 'running')}><Play size={15} />Run full sprint (6 features)</button>
          <button className="btn" onClick={() => go('pipeline')}><GitPullRequest size={15} />Open pipeline</button>
          <a className="btn" href={s.github?.url} target="_blank" rel="noreferrer"><Github size={15} />{s.github?.repo}</a>
        </div>
      </div>

      <div className="grid g5">
        <Stat label="Tokens saved by Meko" icon={<Coins size={14} color="#7c3aed" />} value={<span className="grad-text">{fmt.k(e.tokensSaved ?? 0)}</span>} foot={`${fmt.pct(e.savedPct)} fewer than memory-less agents`} spark={tl.map(t => t.baseline - t.meko)} />
        <Stat label="LLM spend avoided" icon={<Coins size={14} color="#16a34a" />} value={fmt.usd(e.costSaved ?? 0)} foot={`${fmt.usd(e.costMeko)} spent vs ${fmt.usd(e.costBaseline)} baseline`} sparkColor="#22c55e" spark={tl.map(t => t.baseline)} />
        <Stat label="Cross-agent memory reuse" icon={<Recycle size={14} color="#0891b2" />} value={fmt.n(e.crossAgentReuse ?? 0)} foot={`${fmt.n(e.memoriesWritten)} written · ${fmt.n(e.reusedArtifacts)} artifacts reused`} sparkColor="#06b6d4" />
        <Stat label="Gates passed" icon={<ShieldCheck size={14} color="#16a34a" />} value={`${passed}/${decided || 0}`} foot="guardrails + evals on every stage" />
        <Stat label="Features in edge-staging" icon={<Rocket size={14} color="#c026d3" />} value={`${deployed}/6`} foot={deployed ? `latest ${Object.values(s.deployments).sort((a, b) => b.at.localeCompare(a.at))[0]?.at.slice(11, 16)} UTC` : 'waiting for first release'} />
      </div>

      <div className="grid g-3-2">
        <Card title="Live pipeline" hint="latest run per feature" right={<button className="btn sm" onClick={() => go('pipeline')}>Details <ArrowRight size={13} /></button>}>
          <table className="t">
            <thead><tr><th>Feature</th>{STAGES.map(st => <th key={st} style={{ textAlign: 'center' }}>{st}</th>)}<th className="num">Tokens (Meko / baseline)</th></tr></thead>
            <tbody>
              {s.features.map(f => {
                const r = latestRun(s, f.id);
                const tok = r ? Object.values(r.stages).reduce((a, x) => ({ m: a.m + (x.tokens?.meko ?? 0) + (x.tokens?.output ?? 0), b: a.b + (x.tokens?.baseline ?? 0) + (x.tokens?.output ?? 0) }), { m: 0, b: 0 }) : null;
                return (
                  <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => go('pipeline')}>
                    <td><div className="row"><Avatar agent={agentOf(s, f.owner)} size="sm" /><div><div style={{ fontWeight: 650 }}>{f.title}</div><div className="dim mono" style={{ fontSize: 10.5 }}>{f.id}{s.deployments?.[f.id] ? ' · deployed' : ''}</div></div></div></td>
                    {STAGES.map(st => <td key={st} style={{ textAlign: 'center' }}><StatusIcon status={r?.stages[st]?.status ?? 'pending'} size={16} /></td>)}
                    <td className="num mono" style={{ fontSize: 11.5 }}>{tok && tok.b ? <><span style={{ color: '#7c3aed' }}>{fmt.k(tok.m)}</span> / <span className="dim">{fmt.k(tok.b)}</span></> : <span className="dim">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="Agents at work" hint="live LLM activity">
          <div className="grid g2" style={{ gap: 10 }}>
            {s.roster.agents.map(a => {
              const l = s.llm?.[a.id];
              const busy = l?.phase === 'start';
              const running = s.runs.some(r => r.status === 'running' && Object.values(r.stages).some(x => x.status === 'running' && x.agent === a.id));
              return (
                <div key={a.id} className="row" style={{ padding: '8px 10px', borderRadius: 12, border: '1px solid var(--line)', background: busy || running ? '#f5f3ff' : 'var(--surface)' }}>
                  <Avatar agent={a} size="sm" busy={busy || running} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 650, fontSize: 12.5 }}>{a.name} <span className="dim" style={{ fontWeight: 500 }}>· {a.owner}</span></div>
                    <div className="dim ellipsis" style={{ fontSize: 11 }}>{busy ? `thinking · ${l.label}` : running ? 'recalling from Meko…' : l?.phase === 'done' ? `${fmt.n(l.usage?.input_tokens)} in · ${fmt.n(l.usage?.output_tokens)} out` : a.role}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid g3">
        <Card title="Meko wire" hint="real MCP calls" icon={<Brain size={16} color="#7c3aed" />} right={<button className="btn sm" onClick={() => go('meko')}>Open</button>}>
          <div className="feed" style={{ maxHeight: 300 }}>
            {(s.meko?.wire ?? []).slice(0, 30).map(w => (
              <div className="feed-item" key={w.id}>
                <Avatar agent={agentOf(s, w.agent) ?? { name: w.agent, color: '#475569', icon: 'x' }} size="sm" />
                <div className="main-t"><span className="mono" style={{ color: w.isError ? '#e11d48' : '#7c3aed' }}>{w.tool}</span> <span className="dim">{w.args.slice(0, 70)}</span></div>
                <span className="t">{w.ms}ms</span>
              </div>
            ))}
            {!s.meko?.wire?.length && <div className="empty">No Meko traffic yet — run a feature.</div>}
          </div>
        </Card>
        <Card title="GitHub activity" hint="commits, PRs, statuses" icon={<Github size={16} />} right={<button className="btn sm" onClick={() => go('github')}>Open</button>}>
          <div className="feed" style={{ maxHeight: 300 }}>
            {(s.github?.activity ?? []).slice(0, 30).map((g, i) => (
              <a className="feed-item" key={i} href={g.url} target="_blank" rel="noreferrer">
                <Avatar agent={agentOf(s, g.agent)} size="sm" />
                <div className="main-t">{g.kind === 'status' ? <Badge tone={g.state === 'success' ? 'green' : g.state === 'failure' ? 'red' : 'amber'}>{g.context}</Badge> : <Badge tone="gray">{g.kind}</Badge>} {g.title}</div>
                <span className="t">{fmt.ago(g.at)}</span>
              </a>
            ))}
            {!s.github?.activity?.length && <div className="empty">No agent activity on GitHub yet.</div>}
          </div>
        </Card>
        <Card title="Fleet health" hint="the product, live" icon={<Factory size={16} color="#0891b2" />} right={<button className="btn sm" onClick={() => go('edge')}>Edge Ops</button>}>
          <div className="col" style={{ gap: 9 }}>
            {(s.edge?.assets ?? []).map(a => (
              <div key={a.id} className="row" style={{ fontSize: 12.5 }}>
                <span className="mono" style={{ width: 64 }}>{a.id}</span>
                <div className="gauge" style={{ flex: 1 }}><span style={{ width: `${a.health}%`, background: a.health > 80 ? 'var(--green)' : a.health > 50 ? 'var(--amber)' : 'var(--red)' }} /></div>
                <span className="mono" style={{ width: 30, textAlign: 'right' }}>{a.health}</span>
                <Sparkline data={a.history?.slice(-40).map(h => h.vibration)} width={70} height={20} color={a.health > 80 ? '#22c55e' : '#f43f5e'} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 380 260">
      <defs>
        <radialGradient id="hg" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#8b5cf6" stopOpacity="0.9" /><stop offset="1" stopColor="#8b5cf6" stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx="220" cy="140" r="70" fill="url(#hg)" opacity="0.5" />
      {Array.from({ length: 10 }).map((_, i) => {
        const a = (i / 10) * Math.PI * 2, x = 220 + Math.cos(a) * 105, y = 140 + Math.sin(a) * 85;
        return <g key={i}><line x1="220" y1="140" x2={x} y2={y} stroke="#7c3aed" strokeOpacity="0.5" className="flow-line" /><circle cx={x} cy={y} r="7" fill={['#8b5cf6', '#06b6d4', '#22c55e', '#f43f5e', '#f59e0b', '#3b82f6', '#14b8a6', '#65a30d', '#ef4444', '#e879f9'][i]} /></g>;
      })}
      <circle cx="220" cy="140" r="22" fill="#1e1b4b" stroke="#7c3aed" strokeWidth="2" />
      <text x="220" y="145" textAnchor="middle" fill="#6d28d9" fontSize="13" fontWeight="800" fontFamily="Inter">Meko</text>
    </svg>
  );
}
