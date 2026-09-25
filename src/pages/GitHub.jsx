import React from 'react';
import { GitPullRequest, GitMerge, GitBranch, Rocket, PlayCircle, GitCommit, ExternalLink, Github, CheckCircle2, XCircle, Loader2, CircleDot } from 'lucide-react';
import { Card, Stat, Avatar, Badge, Empty } from '../components/ui.jsx';
import { fmt } from '../api.js';
import { agentOf } from '../lib.js';

const runIcon = r => r.status !== 'completed' ? <Loader2 size={15} className="spin" color="#d97706" /> : r.conclusion === 'success' ? <CheckCircle2 size={15} color="#16a34a" /> : <XCircle size={15} color="#e11d48" />;

export default function GitHubPage({ s }) {
  const g = s.github?.snapshot;
  if (!g) return <Empty icon={<Github />}>Connecting to GitHub…</Empty>;
  const runByPr = Object.fromEntries(s.runs.filter(r => r.pr).map(r => [r.pr, r]));
  const agentFromCommit = name => s.roster.agents.find(a => name?.startsWith(a.name + ' ('));

  return (
    <>
      <div className="card glow" style={{ padding: '18px 22px' }}>
        <div className="row wrap">
          <Github size={26} />
          <div><a href={g.url} target="_blank" rel="noreferrer" style={{ fontWeight: 800, fontSize: 18 }}>{g.repo} <ExternalLink size={13} /></a><div className="dim" style={{ fontSize: 12.5 }}>{g.visibility} · default branch {g.defaultBranch} · refreshed live every 20 s · API budget {g.rate?.remaining}/{g.rate?.limit}</div></div>
          <div style={{ marginLeft: 'auto' }} className="row">
            <a className="btn sm" href={`${g.url}/pulls`} target="_blank" rel="noreferrer"><GitPullRequest size={13} />Pull requests</a>
            <a className="btn sm" href={`${g.url}/actions`} target="_blank" rel="noreferrer"><PlayCircle size={13} />Actions</a>
            <a className="btn sm" href={`${g.url}/deployments`} target="_blank" rel="noreferrer"><Rocket size={13} />Deployments</a>
          </div>
        </div>
      </div>

      <div className="grid g5">
        <Stat label="Open PRs" icon={<GitPullRequest size={14} color="#16a34a" />} value={g.pulls.filter(p => p.state === 'open').length} />
        <Stat label="Merged by Helm" icon={<GitMerge size={14} color="#7c3aed" />} value={g.pulls.filter(p => p.state === 'merged').length} />
        <Stat label="Branches" icon={<GitBranch size={14} color="#0891b2" />} value={g.branches.length} foot={`${g.branches.filter(b => b.startsWith('adlc/')).length} agent branches`} />
        <Stat label="Actions runs" icon={<PlayCircle size={14} color="#d97706" />} value={g.runs.length} foot={`${g.runs.filter(r => r.conclusion === 'success').length} green`} />
        <Stat label="Deployments" icon={<Rocket size={14} color="#c026d3" />} value={g.deployments.length} foot="environment edge-staging" />
      </div>

      <div className="grid g-3-2">
        <Card title="Pull requests" hint="one per feature; each stage adds commits, statuses and a gate report">
          <table className="t">
            <thead><tr><th>PR</th><th>Feature</th><th>Gate statuses (adlc/*)</th><th>Updated</th></tr></thead>
            <tbody>
              {g.pulls.map(p => {
                const r = runByPr[p.number];
                return (
                  <tr key={p.number}>
                    <td><a href={p.url} target="_blank" rel="noreferrer" className="row" style={{ gap: 6 }}>{p.state === 'merged' ? <GitMerge size={15} color="#7c3aed" /> : p.state === 'open' ? <GitPullRequest size={15} color="#16a34a" /> : <CircleDot size={15} color="#e11d48" />}<b>#{p.number}</b></a></td>
                    <td><div style={{ fontWeight: 600 }}>{p.title}</div><div className="row wrap" style={{ gap: 4, marginTop: 3 }}>{p.labels.map(l => <Badge key={l} tone={l.startsWith('stage') ? 'violet' : l.includes('deployed') ? 'pink' : 'gray'}>{l}</Badge>)}</div></td>
                    <td><div className="row wrap" style={{ gap: 4 }}>{r ? Object.entries(r.statuses ?? {}).map(([k, v]) => <Badge key={k} tone={v.state === 'success' ? 'green' : v.state === 'failure' ? 'red' : 'amber'} title={v.description}>{k.replace('adlc/', '')}</Badge>) : <span className="dim">—</span>}</div></td>
                    <td className="dim" style={{ fontSize: 12 }}>{fmt.ago(p.updated)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!g.pulls.length && <Empty>No pull requests yet.</Empty>}
        </Card>
        <Card title="Agent activity" hint="streamed as it happens">
          <div className="feed" style={{ maxHeight: 460 }}>
            {(s.github?.activity ?? []).map((e, i) => (
              <a key={i} className="feed-item" href={e.url} target="_blank" rel="noreferrer">
                <Avatar agent={agentOf(s, e.agent)} size="sm" />
                <div style={{ whiteSpace: 'normal', fontSize: 12.5 }}>{e.kind === 'status' ? <Badge tone={e.state === 'success' ? 'green' : e.state === 'failure' ? 'red' : 'amber'}>{e.context}</Badge> : <Badge tone="gray">{e.kind}</Badge>} {e.title}</div>
                <span className="t">{e.at.slice(11, 19)}</span>
              </a>
            ))}
            {!s.github?.activity?.length && <Empty>Nothing yet this session.</Empty>}
          </div>
        </Card>
      </div>

      <div className="grid g3">
        <Card title="Commits on main" icon={<GitCommit size={16} />}>
          <div className="feed" style={{ maxHeight: 380 }}>
            {g.commits.map(c => { const a = agentFromCommit(c.author); return (
              <a key={c.sha} className="feed-item" href={c.url} target="_blank" rel="noreferrer">
                {a ? <Avatar agent={a} size="sm" /> : <GitCommit size={15} className="dim" />}
                <div className="main-t"><span className="mono" style={{ color: '#7c3aed' }}>{c.sha.slice(0, 7)}</span> {c.message}</div>
                <span className="t">{fmt.ago(c.date)}</span>
              </a>
            ); })}
          </div>
        </Card>
        <Card title="GitHub Actions" hint="adlc-ci re-runs spec lint, tests, evals and scans" icon={<PlayCircle size={16} color="#d97706" />}>
          <div className="feed" style={{ maxHeight: 380 }}>
            {g.runs.map(r => (
              <a key={r.id} className="feed-item" href={r.url} target="_blank" rel="noreferrer">
                {runIcon(r)}
                <div className="main-t">{r.name} <span className="dim mono" style={{ fontSize: 11 }}>{r.branch}</span></div>
                <span className="t">{fmt.ago(r.created)}</span>
              </a>
            ))}
            {!g.runs.length && <Empty>No workflow runs yet.</Empty>}
          </div>
        </Card>
        <Card title="Deployments · edge-staging" icon={<Rocket size={16} color="#c026d3" />}>
          <div className="feed" style={{ maxHeight: 380 }}>
            {g.deployments.map(d => (
              <div key={d.id} className="feed-item">
                <Rocket size={15} color="#c026d3" />
                <div className="main-t">{d.description} <span className="mono dim" style={{ fontSize: 11 }}>{d.sha.slice(0, 7)}</span></div>
                <span className="t">{fmt.ago(d.created)}</span>
              </div>
            ))}
            {!g.deployments.length && <Empty>No deployments yet — approve a release in the Pipeline.</Empty>}
          </div>
        </Card>
      </div>
    </>
  );
}
