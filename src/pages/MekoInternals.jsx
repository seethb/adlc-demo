import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Brain, Bot, Layers, Terminal, Monitor, Plug, Upload, KeyRound, User, Database, Users, MessagesSquare, Tag, PenLine, Search, BookOpen, Boxes, HardDrive, Sparkles, ArrowDownToLine, ArrowUpFromLine, RotateCcw, Loader2, CheckCircle2, Wrench } from 'lucide-react';
import { Card, Badge, Stat, Empty } from '../components/ui.jsx';
import { api, fmt } from '../api.js';

const W = 1440, H = 760;
const V = '#7c3aed', CY = '#0891b2', SL = '#475569', AM = '#d97706';

// Pipelines per engine. o = observed in live API responses from this project; i = inferred.
const ENGINES = [
  { id: 'write', x: 40, title: 'Memory · write', tool: 'memory_add', icon: PenLine, tone: V, path: 'write', steps: [
    ['o', 'text + metadata, tagged agent_id and run_id'], ['i', 'LLM fact extraction & normalising'], ['o', 'content hash → de-dup (event ADD / UPDATE)'], ['i', 'embedding written to vector index'], ['o', 'versioned: created_at / updated_at'] ] },
  { id: 'read', x: 318, title: 'Memory · recall', tool: 'memory_search', icon: Search, tone: CY, path: 'read', steps: [
    ['o', 'scoped to datapack (+ optional agent_id)'], ['i', 'query embedding'], ['o', 'similarity → raw_similarity_score'], ['o', 're-scored → score + relevance cut-off'], ['o', 'top-k with agent_id, run_id, metadata'] ] },
  { id: 'learn', x: 596, title: 'Conversation learning', tool: 'conversation_add_message', icon: MessagesSquare, tone: V, path: 'write', steps: [
    ['o', 'every agent turn stored per conversation'], ['o', 'learnings auto-extracted → memories_added'], ['o', 'Meko’s own LLM calls counted (llm_calls)'], ['o', 'token usage via track_token_usage'], ['o', 'conversation_search_opt_out per datapack'] ] },
  { id: 'kb', x: 874, title: 'Knowledge base', tool: 'knowledgebase_search', icon: BookOpen, tone: CY, path: 'both', steps: [
    ['o', 'markdown upload (REST) per datapack'], ['o', 'section-aware chunks “Section: A > B”'], ['o', 'tables flattened to text rows'], ['i', 'chunk embeddings'], ['o', 'top-k chunks with scores'] ] },
  { id: 'ctx', x: 1152, title: 'Context & artifacts', tool: 'context_search · artifact_*', icon: Boxes, tone: AM, path: 'both', steps: [
    ['o', 'context_search fans out: memory + knowledge'], ['o', 'artifact_put → sha256 content_hash'], ['o', 'artifact_get by hash (re-use, zero tokens)'], ['o', 'memory_promote → collective memory'], ['o', 'grants: owner · maintainer · viewer'] ] },
];

const TRACES = {
  write: { label: 'Trace a write', icon: ArrowDownToLine, color: V, text: 'An agent calls memory_add → MCP server authenticates the key → the call is scoped to the datapack, the agent namespace and the conversation → the memory engine extracts and de-duplicates the fact → it is stored with its embedding.', nodes: ['agents', 'mcp', 'scope', 'write', 'learn', 'store', 'vec'] },
  read: { label: 'Trace a recall', icon: ArrowUpFromLine, color: CY, text: 'An agent calls memory_search / knowledgebase_search → scoped to the datapack → the query is embedded and matched against memories and knowledge chunks → re-scored, cut off by relevance and the top-k returned with provenance.', nodes: ['agents', 'mcp', 'scope', 'read', 'kb', 'ctx', 'vec', 'store'] },
};

const USED = new Set(['memory_search', 'memory_add', 'memory_get_all', 'memory_delete_by_id', 'knowledgebase_search', 'artifact_put', 'artifact_get', 'conversation_create', 'conversation_add_message', 'conversation_list', 'datapack_describe', 'datapack_list', 'datapack_create', 'track_token_usage']);
const GROUP = n => (n.startsWith('memory_') ? 'Memory' : n.startsWith('conversation_') ? 'Conversations' : n.startsWith('datapack_') ? 'Datapacks' : n.startsWith('artifact_') ? 'Artifacts' : n.includes('search') ? 'Search' : 'Usage');

export default function MekoInternals({ s }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [trace, setTrace] = useState(null);
  const [q, setQ] = useState('severity to priority mapping for work orders');
  const [recall, setRecall] = useState(null);
  const [busy, setBusy] = useState(false);
  const wrap = useRef(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / W));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const load = () => api('/meko/internals').then(d => { setData(d); setErr(null); }).catch(e => setErr(e.message));
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const runRecall = async () => {
    setBusy(true); setTrace('read');
    try { setRecall(await api(`/meko/search?q=${encodeURIComponent(q)}`)); } finally { setBusy(false); }
  };

  const d = data?.describe ?? {};
  const convs = (data?.conversations ?? []).filter(c => /ADLC/.test(c.title ?? ''));
  const sum = k => convs.reduce((n, c) => n + (c[k] ?? 0), 0);
  const tools = data?.tools ?? [];
  const groups = tools.reduce((m, t) => ((m[GROUP(t.name)] ??= []).push(t), m), {});
  const tr = trace && TRACES[trace];
  const f = id => (tr ? (tr.nodes.includes(id) ? 'lit' : 'dim') : '');
  const tone = p => (p === 'write' ? V : p === 'read' ? CY : SL);

  return (
    <>
      <div className="arch-head card">
        <div>
          <div className="arch-title">Inside <span className="grad-text">Meko</span> — how the shared memory works</div>
          <div className="muted" style={{ fontSize: 13 }}>From the MCP interface down to storage, built from what this project observes in Meko’s live API. <b>●</b> observed · <b>◌</b> inferred.</div>
        </div>
        <div className="arch-legend">
          <span><i style={{ background: V }} />write path</span>
          <span><i style={{ background: CY }} />recall path</span>
          <span><i style={{ background: AM }} />context & artifacts</span>
        </div>
      </div>

      {err && <div className="card" style={{ borderColor: '#fde68a', background: '#fffbeb', fontSize: 13 }}>Live internals unavailable ({err}). If you just updated the code, restart <span className="kbd">npm run dev</span> — the diagram below still works.</div>}

      <div className="grid g5">
        <Stat label="Memories in datapack" icon={<Brain size={14} color={V} />} value={fmt.n(d.memory_count ?? s.meko?.memories?.length ?? 0)} foot={`${fmt.n(d.learnings_count ?? 0)} learnings`} />
        <Stat label="Knowledge chunks" icon={<BookOpen size={14} color={CY} />} value={fmt.n(d.knowledge_chunk_count ?? 0)} foot={`${d.knowledge_base_file_count ?? 0} knowledge base · ${d.shared_knowledge_count ?? 0} shared`} />
        <Stat label="Auto-extracted from conversations" icon={<Sparkles size={14} color={V} />} value={fmt.n(sum('memoriesAdded'))} foot={`from ${fmt.n(sum('messages'))} agent turns in ${convs.length} conversations`} />
        <Stat label="Meko’s own LLM calls" icon={<Brain size={14} color={AM} />} value={fmt.n(sum('llmCalls'))} foot="extraction & learning, server-side" />
        <Stat label="Collective memory" icon={<Users size={14} color={SL} />} value={fmt.n(d.collective_memory_count ?? 0)} foot="promoted with memory_promote" />
      </div>

      <div className="card arch-stage">
        <div className="arch-steps">
          {Object.entries(TRACES).map(([k, t]) => { const I = t.icon; return <button key={k} className={`btn sm ${trace === k ? 'primary' : ''}`} onClick={() => setTrace(trace === k ? null : k)}><I size={14} />{t.label}</button>; })}
          {trace && <button className="btn ghost sm" onClick={() => setTrace(null)}><RotateCcw size={13} />Whole system</button>}
          <div className="arch-caption">{tr ? <><b style={{ color: tr.color }}>{tr.label}</b><span>{tr.text}</span></> : <span className="dim">Five layers: clients → MCP access → scoping → engines → storage. Writes flow down, recalls flow back up.</span>}</div>
        </div>

        <div ref={wrap} className="arch-canvas" style={{ height: H * scale }}>
          <div className="arch-inner" style={{ width: W, height: H, transform: `scale(${scale})` }}>
            <svg width={W} height={H} className="arch-svg">
              {/* band separators */}
              {[[138, 'CLIENTS'], [268, 'ACCESS'], [392, 'SCOPING'], [652, 'ENGINES']].map(([y, l]) => <line key={l} x1={20} x2={W - 20} y1={y} y2={y} stroke="#eef1f6" />)}
              {/* clients → access */}
              {[195, 545, 895, 1245].map((x, i) => <Flow key={`a${i}`} x={x} y1={112} y2={164} color={i === 2 ? SL : V} dim={tr && !(i < 2)} both />)}
              {/* access → scoping */}
              {[450, 1005].map((x, i) => <Flow key={`b${i}`} x={x} y1={246} y2={294} color={V} dim={tr && i === 1 && trace === 'read'} both />)}
              {/* scoping → engines */}
              {ENGINES.map(e => <Flow key={`c${e.id}`} x={e.x + 124} y1={372} y2={418} color={tone(e.path)} dim={tr && !tr.nodes.includes(e.id)} up={e.path === 'read'} both={e.path === 'both'} />)}
              {/* engines → storage */}
              {ENGINES.map(e => <Flow key={`d${e.id}`} x={e.x + 124} y1={640} y2={684} color={e.id === 'ctx' ? AM : tone(e.path)} dim={tr && !tr.nodes.includes(e.id)} up={e.path === 'read'} both={e.path === 'both'} />)}
              {[['CLIENTS', 30], ['ACCESS · MCP + REST', 158], ['SCOPING', 286], ['ENGINES', 410], ['STORAGE', 676]].map(([l, y]) => <text key={l} x={W - 24} y={y - 8} textAnchor="end" fontSize="10" fontWeight="800" letterSpacing="0.12em" fill="#b6bfcf">{l}</text>)}
            </svg>

            {/* clients */}
            <Node x={40} y={24} w={310} h={88} id="agents" f={f} tone={V} icon={Bot} title="10 ADLC agents" sub="MCP · agent_id adlc:<agent>" tag="o" />
            <Node x={390} y={24} w={310} h={88} id="studio" f={f} tone={V} icon={Layers} title="ADLC Studio" sub="MCP + REST · privacy shield on egress" tag="o" />
            <Node x={740} y={24} w={310} h={88} id="hooks" f={f} tone={SL} icon={Terminal} title="Claude Code hooks" sub="session capture · SessionStart / PreCompact / End" tag="o" />
            <Node x={1090} y={24} w={310} h={88} id="others" f={f} tone={SL} icon={Monitor} title="Other MCP clients" sub="Desktop, Cursor · common bucket meko_agent" tag="o" />

            {/* access */}
            <Node x={40} y={164} w={820} h={82} id="mcp" f={f} tone={V} icon={Plug} title="MCP server — streamable HTTP" sub={`mcp.mekodata.ai/mcp · ${tools.length || 24} tools`} tag="o">
              <div className="arch-chips" style={{ marginTop: -2 }}>{(Object.keys(groups).length ? Object.entries(groups) : [['Memory', { length: 8 }], ['Conversations', { length: 6 }], ['Datapacks', { length: 5 }], ['Search', { length: 2 }], ['Artifacts', { length: 2 }], ['Usage', { length: 1 }]]).map(([g, l]) => <span key={g} style={{ color: V, background: '#7c3aed0d', borderColor: '#7c3aed2e' }}>{g} · {l.length}</span>)}</div>
            </Node>
            <Node x={880} y={164} w={250} h={82} id="rest" f={f} tone={CY} icon={Upload} title="REST API" sub="knowledge-bases/upload" tag="o" />
            <Node x={1150} y={164} w={250} h={82} id="auth" f={f} tone={SL} icon={KeyRound} title="Auth & limits" sub="Bearer API key · per-account quotas" tag="o" />

            {/* scoping chain */}
            <div className={`arch-box ${f('scope')}`} style={{ left: 40, top: 294, width: 1360, height: 78, '--tone': V, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {[[KeyRound, 'API key', 'identifies the account'], [User, 'User', 'owner of the datapack'], [Database, 'Datapack', `${d.datapack_name ?? 'iot-edge-adlc'} · grant ${d.grant ?? 'owner'}`], [Tag, 'agent_id namespace', 'adlc:atlas … adlc:helm · meko_agent'], [MessagesSquare, 'Conversation = run_id', 'one per agent · turns + learnings'], [Tag, 'Metadata', '{ feature, stage, kind, run }']].map(([I, t, sub], i, arr) => (
                <React.Fragment key={t}>
                  <div className="mk-chain"><span className="arch-ic sm" style={{ '--tone': V }}><I size={14} /></span><div><b>{t}</b><small>{sub}</small></div></div>
                  {i < arr.length - 1 && <span className="mk-arrow">›</span>}
                </React.Fragment>
              ))}
            </div>

            {/* engines */}
            {ENGINES.map(e => (
              <div key={e.id} className={`arch-box ${f(e.id)}`} style={{ left: e.x, top: 418, width: 248, height: 222, '--tone': e.tone }}>
                <div className="arch-box-h"><span className="arch-ic"><e.icon size={16} /></span><div><b>{e.title}</b><small className="mono" style={{ fontSize: 10.5 }}>{e.tool}</small></div></div>
                <ol className="mk-steps">{e.steps.map(([k, t], i) => <li key={i} className={k}><span>{k === 'o' ? '●' : '◌'}</span>{t}</li>)}</ol>
              </div>
            ))}

            {/* storage */}
            <Node x={40} y={684} w={560} h={62} id="store" f={f} tone={SL} icon={Database} title="Datapack store — distributed SQL" sub="memories · conversations · learnings · grants · YugabyteDB YSQL (datapack_ysql_* fields)" tag="i" />
            <Node x={620} y={684} w={380} h={62} id="vec" f={f} tone={CY} icon={HardDrive} title="Vector index" sub="embeddings for memories and knowledge chunks" tag="i" />
            <Node x={1020} y={684} w={380} h={62} id="blob" f={f} tone={AM} icon={Boxes} title="Content-addressed artifacts" sub="sha256 content_hash · stored_in: db" tag="o" />
          </div>
        </div>
      </div>

      <div className="grid g2">
        <Card title="Trace a recall — live" hint="what an agent gets back, step by step" icon={<Search size={16} color={CY} />} glow>
          <div className="row"><input className="input" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && runRecall()} /><button className="btn primary" onClick={runRecall} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <Search size={14} />}Recall</button></div>
          {recall ? (
            <div className="col" style={{ marginTop: 14, gap: 10 }}>
              <TraceStep n={1} title="Scoped" text={`datapack ${d.datapack_name ?? 'iot-edge-adlc'} · all agent namespaces · PII shield applied to the query`} />
              <TraceStep n={2} title="Matched & re-scored" text={`${recall.memories.length} memories and ${recall.knowledge.length} knowledge chunks above the relevance cut-off`} />
              <div className="col" style={{ gap: 6 }}>
                {recall.memories.slice(0, 5).map(m => (
                  <div key={m.id} className="mem">
                    <div className="who"><Badge tone="violet">{m.agent}</Badge>{m.metadata?.kind && <Badge tone="gray">{m.metadata.kind}</Badge>}{m.metadata?.feature && <Badge tone="cyan">{m.metadata.feature}</Badge>}<span className="mono" style={{ marginLeft: 'auto' }}>score {Number(m.score).toFixed(2)}</span></div>
                    <div style={{ fontSize: 12.5 }}>{m.text}</div>
                    <div className="gauge" style={{ height: 5 }}><span style={{ width: `${Math.min(100, m.score * 100)}%`, background: 'linear-gradient(90deg,#7c3aed,#0891b2)' }} /></div>
                  </div>
                ))}
                {recall.knowledge.slice(0, 2).map((k, i) => <div key={i} className="mem"><div className="who"><BookOpen size={11} />knowledge chunk</div><div className="muted" style={{ fontSize: 12 }}>{String(k.text).slice(0, 260)}…</div></div>)}
              </div>
              <TraceStep n={3} title="Returned with provenance" text="each hit carries agent_id, run_id and metadata — the Studio screens it for prompt injection before it reaches a prompt" done />
            </div>
          ) : <div className="dim" style={{ fontSize: 12.5, marginTop: 12 }}>Runs a real memory_search + knowledgebase_search against the datapack and walks through the result.</div>}
        </Card>

        <Card title="Conversation learning by agent" hint="Meko extracts memories from each agent’s turns" icon={<Sparkles size={16} color={V} />}>
          {convs.length ? (
            <table className="t">
              <thead><tr><th>Conversation</th><th className="num">Turns</th><th className="num">Memories extracted</th><th className="num">Meko LLM calls</th><th>Last activity</th></tr></thead>
              <tbody>{convs.sort((a, b) => b.memoriesAdded - a.memoriesAdded).map(c => (
                <tr key={c.id}><td><b>{c.title?.replace('ADLC · ', '')}</b></td><td className="num mono">{c.messages}</td><td className="num"><Badge tone="violet">{c.memoriesAdded}</Badge></td><td className="num mono">{c.llmCalls}</td><td className="dim" style={{ fontSize: 12 }}>{fmt.time(c.lastActivity)}</td></tr>
              ))}</tbody>
            </table>
          ) : <Empty>{err ? 'Waiting for the live internals endpoint.' : 'Loading…'}</Empty>}
        </Card>
      </div>

      <Card title="MCP tool catalog" hint={`${tools.length} tools exposed by Meko · highlighted = used by the ADLC Studio`} icon={<Wrench size={16} color={V} />}>
        {tools.length ? (
          <div className="mk-tools">
            {Object.entries(groups).map(([g, ts]) => (
              <div key={g}>
                <div className="arch-sub-h" style={{ marginBottom: 8 }}>{g}</div>
                {ts.map(t => (
                  <div key={t.name} className={`mk-tool ${USED.has(t.name) ? 'used' : ''}`} title={t.description}>
                    <div className="row between"><span className="mono">{t.name}</span>{USED.has(t.name) && <CheckCircle2 size={13} color="#16a34a" />}</div>
                    <small>{t.description}</small>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : <Empty>Loading the live tool list…</Empty>}
      </Card>
    </>
  );
}

function Node({ x, y, w, h, id, f, tone, icon: I, title, sub, tag, children }) {
  return (
    <div className={`arch-box ${f(id)}`} style={{ left: x, top: y, width: w, height: h, '--tone': tone, cursor: 'default' }}>
      <div className="arch-box-h">
        <span className="arch-ic"><I size={16} /></span>
        <div style={{ minWidth: 0 }}><b>{title} <span className={`mk-tag ${tag}`}>{tag === 'o' ? '● observed' : '◌ inferred'}</span></b><small>{sub}</small></div>
      </div>
      {children}
    </div>
  );
}

// A vertical connector with a travelling dot (down = write, up = recall).
function Flow({ x, y1, y2, color, dim, up, both }) {
  const d = up ? `M${x},${y2} L${x},${y1}` : `M${x},${y1} L${x},${y2}`;
  return (
    <g opacity={dim ? 0.12 : 1} style={{ transition: 'opacity .35s' }}>
      <line x1={x} x2={x} y1={y1} y2={y2} stroke={color} strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" />
      <circle r="4" fill={color}><animateMotion dur="1.6s" repeatCount="indefinite" path={d} /></circle>
      {both && <circle r="3.2" fill={CY}><animateMotion dur="1.9s" repeatCount="indefinite" path={`M${x},${y2} L${x},${y1}`} /></circle>}
    </g>
  );
}

function TraceStep({ n, title, text, done }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
      <span style={{ flex: 'none', width: 22, height: 22, borderRadius: 7, display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 800, color: '#fff', background: done ? '#16a34a' : 'var(--grad)' }}>{n}</span>
      <div><b style={{ fontSize: 12.5 }}>{title}</b><div className="muted" style={{ fontSize: 12 }}>{text}</div></div>
    </div>
  );
}
