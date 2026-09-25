import React, { useState } from 'react';
import { Search, Brain, BookOpen, Plus, Activity, Database, Timer, ShieldAlert } from 'lucide-react';
import { Card, Stat, Avatar, Badge, Tabs, Empty } from '../components/ui.jsx';
import { api, post, fmt } from '../api.js';
import { agentOf } from './Mission.jsx';

const SUGGEST = ['anomaly severity scale and priority mapping', 'does gateway to cloud traffic need certificates', 'PII privacy rules for agents', 'inventory reservation shortfall', 'ISO 10816 vibration zones', 'cavitation symptoms centrifugal pump'];

export default function Meko({ s }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [text, setText] = useState('');
  const [who, setWho] = useState('org');
  const [msg, setMsg] = useState(null);
  const wire = s.meko?.wire ?? [];
  const mems = s.meko?.memories ?? [];
  const avg = wire.length ? Math.round(wire.reduce((n, w) => n + w.ms, 0) / wire.length) : 0;

  const search = async query => {
    const qq = query ?? q;
    if (!qq.trim()) return;
    setQ(qq); setLoading(true);
    try { setRes(await api(`/meko/search?q=${encodeURIComponent(qq)}`)); } finally { setLoading(false); }
  };
  const add = async () => {
    setMsg(null);
    try { await post('/meko/memories', { agent: who, text, kind: 'team-note' }); setText(''); setMsg({ ok: true, text: 'Written to Meko — every agent can recall it now.' }); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
  };
  const kinds = ['all', ...new Set(mems.map(m => m.metadata?.kind).filter(Boolean))];

  return (
    <>
      <div className="grid g5">
        <Stat label="Datapack" icon={<Database size={14} color="#7c3aed" />} value={<span style={{ fontSize: 18 }}>{s.meko?.datapackName}</span>} foot={<span className="mono" style={{ fontSize: 10.5 }}>{s.meko?.datapackId}</span>} />
        <Stat label="Team memories" icon={<Brain size={14} color="#7c3aed" />} value={fmt.n(mems.length)} foot={`${new Set(mems.map(m => m.agent)).size} writers`} />
        <Stat label="Knowledge documents" icon={<BookOpen size={14} color="#0891b2" />} value={fmt.n(s.meko?.kb?.length ?? 0)} foot="specs, domain & security docs" />
        <Stat label="MCP calls this session" icon={<Activity size={14} color="#16a34a" />} value={fmt.n(s.meko?.stats?.calls ?? 0)} foot={`${s.meko?.stats?.errors ?? 0} errors`} />
        <Stat label="Avg call latency" icon={<Timer size={14} color="#d97706" />} value={`${avg}ms`} foot="memory_search, memory_add, artifacts…" />
      </div>

      <div className="grid g-3-2">
        <Card title="Semantic search across the datapack" hint="exactly what an agent sees when it recalls" glow>
          <div className="row"><input className="input" placeholder="Ask the team memory…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} /><button className="btn primary" onClick={() => search()} disabled={loading}><Search size={15} />{loading ? 'Searching…' : 'Search'}</button></div>
          <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>{SUGGEST.map(x => <span key={x} className="chip" onClick={() => search(x)}>{x}</span>)}</div>
          {res && (
            <div className="grid g2" style={{ marginTop: 16 }}>
              <div className="col">
                <div className="dim" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>MEMORIES ({res.memories.length})</div>
                {res.memories.map(m => <MemoryCard key={m.id} s={s} m={{ agent: m.agent, text: m.text, metadata: m.metadata, score: m.score }} />)}
                {!res.memories.length && <span className="dim">No memories above the relevance threshold.</span>}
              </div>
              <div className="col">
                <div className="dim" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>KNOWLEDGE ({res.knowledge.length})</div>
                {res.knowledge.map((k, i) => <div key={i} className="mem"><div className="who"><BookOpen size={11} />{k.doc}{k.score && <span className="mono" style={{ marginLeft: 'auto' }}>{Number(k.score).toFixed(2)}</span>}</div><div className="muted" style={{ fontSize: 12 }}>{String(k.text).slice(0, 420)}…</div></div>)}
              </div>
            </div>
          )}
        </Card>
        <Card title="Add team knowledge" hint="a person teaches every agent at once">
          <div className="col">
            <select className="input" value={who} onChange={e => setWho(e.target.value)}>
              <option value="org">Org standard (adlc:org)</option>
              {s.roster.agents.map(a => <option key={a.id} value={a.id}>{a.name} — {a.owner} · {a.ownerRole}</option>)}
            </select>
            <textarea className="input" rows={4} placeholder="e.g. Org standard: gearbox oil temperature alarm is 80 °C and trip is 90 °C." value={text} onChange={e => setText(e.target.value)} />
            <div className="row"><button className="btn primary" onClick={add} disabled={text.trim().length < 10}><Plus size={15} />Write to Meko</button><span className="dim" style={{ fontSize: 11.5 }}><ShieldAlert size={12} /> secret-scan and pii-scan run before anything is written</span></div>
            {msg && <div className={`badge ${msg.ok ? 'b-green' : 'b-red'}`} style={{ whiteSpace: 'normal', padding: '6px 10px' }}>{msg.text}</div>}
          </div>
        </Card>
      </div>

      <div className="grid g-1-2">
        <Card title="Team memory stream" right={<select className="input" style={{ width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value)}>{kinds.map(k => <option key={k}>{k}</option>)}</select>}>
          <div className="feed" style={{ maxHeight: 560, gap: 8 }}>
            {mems.filter(m => filter === 'all' || m.metadata?.kind === filter).slice(0, 120).map((m, i) => <MemoryCard key={i} s={s} m={m} />)}
            {!mems.length && <Empty>No memories yet.</Empty>}
          </div>
        </Card>
        <Card title="Live MCP wire" hint="every Meko tool call made by an agent" icon={<Activity size={16} color="#16a34a" />}>
          <div style={{ maxHeight: 560, overflow: 'auto' }}>
            <table className="t">
              <thead><tr><th>Time</th><th>Agent</th><th>Tool</th><th>Arguments</th><th className="num">ms</th></tr></thead>
              <tbody>
                {wire.slice(0, 120).map(w => (
                  <tr key={w.id}>
                    <td className="mono dim">{w.at.slice(11, 19)}</td>
                    <td><div className="row" style={{ gap: 6 }}><Avatar agent={agentOf(s, w.agent) ?? { name: w.agent, color: '#475569' }} size="sm" /><span style={{ fontSize: 12 }}>{agentOf(s, w.agent)?.name ?? w.agent}</span></div></td>
                    <td><span className="mono" style={{ color: w.isError ? '#e11d48' : '#7c3aed' }}>{w.tool}</span></td>
                    <td className="mono dim" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }} title={w.args}>{w.args}</td>
                    <td className="num mono">{w.ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!wire.length && <Empty>Waiting for traffic…</Empty>}
          </div>
        </Card>
      </div>
    </>
  );
}

function MemoryCard({ s, m }) {
  const id = m.agent?.replace('adlc:', '');
  const a = agentOf(s, id);
  const kind = m.metadata?.kind;
  const tone = kind?.includes('security') ? 'red' : kind === 'decision' ? 'violet' : kind === 'artifact' ? 'cyan' : kind === 'lesson' ? 'amber' : kind === 'release' ? 'pink' : 'gray';
  return (
    <div className="mem">
      <div className="who">{a ? <Avatar agent={a} size="sm" /> : <Badge tone="gray">org</Badge>}<span>{a?.name ?? 'Org'}</span>{kind && <Badge tone={tone}>{kind}</Badge>}{m.metadata?.feature && m.metadata.feature !== '*' && <Badge tone="cyan">{m.metadata.feature}{m.metadata.stage ? `/${m.metadata.stage}` : ''}</Badge>}<span className="mono" style={{ marginLeft: 'auto' }}>{m.score ? m.score.toFixed(2) : m.at ? fmt.ago(m.at) : ''}</span></div>
      <div>{m.text}</div>
    </div>
  );
}
