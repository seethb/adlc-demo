import React, { useEffect, useState } from 'react';
import { LayoutDashboard, GitBranch, Users, Brain, Github, Coins, Factory, MessagesSquare, FileText, ShieldCheck, Network, Cpu, Share2, Sparkles, X, ExternalLink, AlertTriangle, Lock } from 'lucide-react';
import { useLive, fmt } from './api.js';
import Mission from './pages/Mission.jsx';
import Pipeline from './pages/Pipeline.jsx';
import Agents from './pages/Agents.jsx';
import Meko from './pages/Meko.jsx';
import GitHubPage from './pages/GitHub.jsx';
import Economics from './pages/Economics.jsx';
import EdgeOps from './pages/EdgeOps.jsx';
import Ask from './pages/Ask.jsx';
import Specs from './pages/Specs.jsx';
import Trust from './pages/Trust.jsx';
import Architecture from './pages/Architecture.jsx';
import MekoInternals from './pages/MekoInternals.jsx';
import Handoffs from './pages/Handoffs.jsx';

const PAGES = [
  { id: 'mission', label: 'Mission Control', icon: LayoutDashboard, group: 'ADLC', sub: 'Ten agents, one shared memory, every gate visible' },
  { id: 'pipeline', label: 'Pipeline', icon: GitBranch, group: 'ADLC', sub: 'Plan → Design → Develop → Test → Review → Deploy, gated on live GitHub' },
  { id: 'specs', label: 'Specs', icon: FileText, group: 'ADLC', sub: 'The source of truth — every artifact traces to an acceptance criterion' },
  { id: 'agents', label: 'Agents', icon: Users, group: 'ADLC', sub: 'Who owns what, and who reused whose memory' },
  { id: 'meko', label: 'Meko Memory', icon: Brain, group: 'Live systems', sub: 'The shared datapack every agent reads from and writes to' },
  { id: 'github', label: 'GitHub', icon: Github, group: 'Live systems', sub: 'Branches, PRs, gate statuses, Actions and deployments' },
  { id: 'economics', label: 'Token Economics', icon: Coins, group: 'Live systems', sub: 'What shared memory saves, measured on every agent step' },
  { id: 'trust', label: 'Guardrails & Privacy', icon: ShieldCheck, group: 'Live systems', sub: 'Guardrails, evals, the PII shield and data classification' },
  { id: 'edge', label: 'Edge Ops', icon: Factory, group: 'The product', sub: 'The running IoT edge analytics app the agents are building' },
  { id: 'architecture', label: 'Architecture & Data Flow', icon: Network, group: 'The product', sub: 'Components, technology and data flows — team, Studio, Claude, Meko, GitHub and the edge' },
  { id: 'ask', label: 'Ask the Fleet', icon: MessagesSquare, group: 'The product', sub: 'Natural-language asset condition queries' },
  { id: 'meko-internals', label: 'Meko Internals', icon: Cpu, group: 'Under the hood', sub: 'How Meko’s shared memory works — MCP access, scoping, engines and storage' },
  { id: 'handoffs', label: 'Agent Handoffs', icon: Share2, group: 'Under the hood', sub: 'Agent-to-agent communication through Meko shared memory — replay, simulate, live' },
];

// Keeps one page's crash from blanking the whole Studio.
class PageBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) { if (prev.page !== this.props.page && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" style={{ borderColor: '#fecdd3' }}>
        <div className="row"><AlertTriangle size={18} color="#e11d48" /><b>This page hit an error</b></div>
        <pre className="code" style={{ marginTop: 10 }}>{String(this.state.error?.message ?? this.state.error)}</pre>
        <button className="btn" style={{ marginTop: 12 }} onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}

export default function App() {
  const [s, dispatch] = useLive();
  const [page, setPage] = useState(() => location.hash.slice(1) || 'mission');
  useEffect(() => { const f = () => setPage(location.hash.slice(1) || 'mission'); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const go = p => { location.hash = p; setPage(p); };
  useEffect(() => { document.querySelector('.main')?.scrollTo(0, 0); }, [page]);

  useEffect(() => {
    if (!s.toasts.length) return;
    const t = setTimeout(() => dispatch({ type: 'untoast', id: s.toasts[0].id }), 6000);
    return () => clearTimeout(t);
  }, [s.toasts, dispatch]);

  const running = s.runs.filter(r => r.status === 'running').length;
  const approvals = (s.features ?? []).filter(f => s.runs.find(r => r.feature === f.id && r.status !== 'superseded')?.stages?.deploy?.status === 'awaiting_approval').length;
  const current = PAGES.find(p => p.id === page) ?? PAGES[0];
  const props = { s, dispatch, go };

  const body = (() => {
    if (!s.ready) return <div className="empty" style={{ marginTop: 120 }}><Sparkles className="spin" /> Connecting to Meko, GitHub and Claude…</div>;
    switch (current.id) {
      case 'pipeline': return <Pipeline {...props} />;
      case 'agents': return <Agents {...props} />;
      case 'meko': return <Meko {...props} />;
      case 'github': return <GitHubPage {...props} />;
      case 'economics': return <Economics {...props} />;
      case 'edge': return <EdgeOps {...props} />;
      case 'ask': return <Ask {...props} />;
      case 'specs': return <Specs {...props} />;
      case 'trust': return <Trust {...props} />;
      case 'architecture': return <Architecture {...props} />;
      case 'meko-internals': return <MekoInternals {...props} />;
      case 'handoffs': return <Handoffs {...props} />;
      default: return <Mission {...props} />;
    }
  })();

  let lastGroup = null;
  return (
    <>
      <div className="aurora"><i /></div>
      <div className="grid-bg" />
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17 L8 6 L13 14 L16 9 L21 17" /></svg></div>
            <div><h1>ADLC Studio</h1><small>Edge Asset Intelligence</small></div>
          </div>
          {PAGES.map(p => {
            const header = p.group !== lastGroup ? <div className="nav-label" key={`g-${p.group}`}>{p.group}</div> : null;
            lastGroup = p.group;
            const I = p.icon;
            return (
              <React.Fragment key={p.id}>
                {header}
                <div className={`nav-item ${current.id === p.id ? 'active' : ''}`} onClick={() => go(p.id)}>
                  <I size={17} />{p.label}
                  {p.id === 'pipeline' && approvals > 0 && <span className="count warn">{approvals} approve</span>}
                  {p.id === 'pipeline' && !approvals && running > 0 && <span className="count">{running} live</span>}
                  {p.id === 'meko' && s.meko?.stats?.calls > 0 && <span className="count">{fmt.k(s.meko.stats.calls)}</span>}
                </div>
              </React.Fragment>
            );
          })}
          <div className="sidebar-foot">
            <div className="row" style={{ fontSize: 12 }}><span className={`dot ${s.connected ? 'live' : 'off'}`} /><span className="muted">{s.connected ? 'Live stream connected' : 'Reconnecting…'}</span></div>
            {s.github?.url && <a className="row dim" style={{ fontSize: 12 }} href={s.github.url} target="_blank" rel="noreferrer"><Github size={13} />{s.github.repo}<ExternalLink size={11} /></a>}
            <div className="row dim" style={{ fontSize: 12 }}><Brain size={13} />datapack <span className="mono" style={{ fontSize: 11 }}>{s.meko?.datapackName}</span></div>
            <div className="row dim" style={{ fontSize: 12 }}><Lock size={13} />PII shield · {fmt.n(s.privacy?.redactions ?? 0)} redacted</div>
          </div>
        </aside>
        <main className="main">
          <div className="topbar">
            <div>
              <h2>{current.label}</h2>
              <div className="sub">{current.sub}</div>
            </div>
            <div className="spacer" />
            {s.ready && <HealthPills s={s} />}
          </div>
          <div className="page" key={current.id}><PageBoundary page={current.id}>{body}</PageBoundary></div>
        </main>
      </div>
      <div className="toasts">
        {s.toasts.map(t => (
          <div className="toast" key={t.id}>
            {t.kind === 'github' ? <Github size={16} /> : t.kind === 'security' ? <ShieldCheck size={16} color="#e11d48" /> : <AlertTriangle size={16} color="#d97706" />}
            <div style={{ flex: 1, minWidth: 0 }}>{t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.title}</a> : t.title}</div>
            <button className="btn ghost sm" onClick={() => dispatch({ type: 'untoast', id: t.id })}><X size={13} /></button>
          </div>
        ))}
      </div>
    </>
  );
}

function HealthPills({ s }) {
  const e = s.economics?.totals;
  return (
    <div className="row">
      {e && e.tokensSaved > 0 && <span className="health-pill" style={{ borderColor: '#ddd6fe' }}><Coins size={13} color="#7c3aed" />saved <b className="grad-text">{fmt.k(e.tokensSaved)} tokens</b></span>}
      <span className="health-pill"><span className="dot live" style={{ background: '#7c3aed' }} />Meko <b>{s.meko?.stats?.calls ?? 0} calls</b></span>
      <span className="health-pill"><span className={`dot ${s.github?.snapshot ? 'live' : 'off'}`} />GitHub <b>{s.github?.snapshot?.pulls?.length ?? 0} PRs</b></span>
      <span className="health-pill"><span className={`dot ${s.claude?.enabled ? 'live' : 'off'}`} style={{ background: '#f59e0b' }} /><b>{s.claude?.model}</b></span>
    </div>
  );
}
