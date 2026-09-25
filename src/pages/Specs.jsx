import React, { useEffect, useState } from 'react';
import { FileText, CheckCircle2, CircleDashed, Rocket, ExternalLink, BookOpen } from 'lucide-react';
import { Card, Avatar, Badge, Tabs, Markdown, Empty } from '../components/ui.jsx';
import { api } from '../api.js';
import { agentOf, latestRun } from '../lib.js';

export default function Specs({ s }) {
  const [sel, setSel] = useState(s.features[0]?.id);
  const [doc, setDoc] = useState(null);
  const [tab, setTab] = useState('spec');
  const [docs, setDocs] = useState([]);
  const [docSel, setDocSel] = useState(null);
  useEffect(() => { api('/docs').then(setDocs); }, []);
  useEffect(() => { if (sel) api(`/features/${sel}`).then(setDoc); setTab('spec'); }, [sel, s.runs.length]);

  const f = s.features.find(x => x.id === sel);
  const run = f && latestRun(s, f.id);
  const art = doc?.artifacts ?? {};
  const tabs = [{ value: 'spec', label: 'Spec' }, { value: 'plan', label: `Plan${art.plan ? '' : ' ·'}` }, { value: 'design', label: `Design${art.design ? '' : ' ·'}` }, { value: 'develop', label: `Code${art.develop ? '' : ' ·'}` }];

  return (
    <div className="grid" style={{ gridTemplateColumns: '300px minmax(0,1fr)', alignItems: 'start' }}>
      <div className="col" style={{ gap: 10 }}>
        {s.features.map(x => {
          const a = agentOf(s, x.owner);
          const r = latestRun(s, x.id);
          return (
            <div key={x.id} className="card" style={{ padding: 14, cursor: 'pointer', borderColor: x.id === sel && !docSel ? 'rgba(139,92,246,0.6)' : 'var(--line)' }} onClick={() => { setSel(x.id); setDocSel(null); }}>
              <div className="row between"><span className="mono dim" style={{ fontSize: 11 }}>{x.id} · {x.priority}</span>{s.deployments?.[x.id] ? <Badge tone="pink"><Rocket size={10} />deployed</Badge> : r ? <Badge tone="violet">{r.status}</Badge> : null}</div>
              <div style={{ fontWeight: 700, margin: '5px 0 8px' }}>{x.title}</div>
              <div className="row" style={{ gap: 6 }}><Avatar agent={a} size="sm" /><span className="dim" style={{ fontSize: 11.5 }}>{a?.name} · {x.acs.length} ACs{x.depends.length ? ` · needs ${x.depends.join(', ')}` : ''}</span></div>
            </div>
          );
        })}
        <div className="nav-label">Programme documents</div>
        {docs.map(d => <div key={d.path} className={`nav-item ${docSel === d.path ? 'active' : ''}`} onClick={() => setDocSel(d.path)}><BookOpen size={15} />{d.path.replace('specs/', '')}</div>)}
      </div>

      {docSel ? (
        <Card title={docSel} right={<a className="btn sm" href={`${s.github.url}/blob/main/${docSel}`} target="_blank" rel="noreferrer">GitHub <ExternalLink size={12} /></a>}><Markdown text={docs.find(d => d.path === docSel)?.text} /></Card>
      ) : f && (
        <div className="col" style={{ gap: 18 }}>
          <Card glow>
            <div className="row wrap">
              <FileText size={22} color="#7c3aed" />
              <div><div style={{ fontWeight: 800, fontSize: 18 }}>{f.id} · {f.title}</div><div className="dim mono" style={{ fontSize: 11.5 }}>{f.specFile} · spec hash {f.specHash} · exports {f.exports.join(', ')}</div></div>
              <div style={{ marginLeft: 'auto' }} className="row"><Tabs value={tab} onChange={setTab} options={tabs} /></div>
            </div>
          </Card>
          <Card title="Acceptance criteria" hint="executable — each maps to a test in the acceptance suite">
            <table className="t"><tbody>{f.acs.map(ac => {
              const t = run?.stages?.test?.acceptance?.tests?.find(x => x.ac === ac.id);
              return <tr key={ac.id}><td style={{ width: 26 }}>{t ? (t.ok ? <CheckCircle2 size={15} color="#16a34a" /> : <CircleDashed size={15} color="#e11d48" />) : <CircleDashed size={15} className="dim" />}</td><td className="mono" style={{ width: 90 }}>{ac.id}</td><td>{ac.text}</td></tr>;
            })}</tbody></table>
          </Card>
          <Card title={tab === 'spec' ? 'Specification' : tab === 'develop' ? f.module : `${tab}.md`} hint={tab !== 'spec' && art[tab] ? `run ${art[tab].run} · ${art[tab].at?.slice(0, 16).replace('T', ' ')}` : ''}>
            {tab === 'spec' ? <Markdown text={doc?.spec?.replace(/^---[\s\S]*?---\n/, '')} />
              : art[tab] ? (tab === 'develop' ? <pre className="code">{art[tab].text}</pre> : <Markdown text={art[tab].text} />)
              : <Empty>Not produced yet — run {f.id} in the Pipeline.</Empty>}
          </Card>
        </div>
      )}
    </div>
  );
}
