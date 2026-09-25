import React, { useState } from 'react';
import { Play, RotateCcw, GitPullRequest, ExternalLink, CheckCircle2, XCircle, AlertTriangle, Brain, BookOpen, Lightbulb, FileCode2, ShieldCheck, FlaskConical, Rocket, PauseCircle, Recycle, GitCommit, Zap, Clock } from 'lucide-react';
import { Card, Avatar, StatusBadge, StatusIcon, Badge, Toggle, Drawer, Modal, BarCompare, Markdown, Empty } from '../components/ui.jsx';
import { post, api, fmt } from '../api.js';
import { STAGES, agentOf, latestRun } from './Mission.jsx';

const LABEL = { plan: 'Plan', design: 'Design', develop: 'Develop', test: 'Test', review: 'Review', deploy: 'Deploy' };

export default function Pipeline({ s, go }) {
  const [open, setOpen] = useState(null); // { runId, stage }
  const [approving, setApproving] = useState(null);
  const [busy, setBusy] = useState(false);
  const settings = s.settings ?? {};
  const setSetting = patch => api('/settings', { method: 'PATCH', body: patch });
  const gateOf = id => s.gates.stages.find(g => g.id === id);
  const waiting = s.runs.filter(r => r.stages?.deploy?.status === 'awaiting_approval');
  const active = s.runs.filter(r => r.status === 'running');
  const logRun = active[0] ?? s.runs[0];

  const run = async fid => { setBusy(true); try { await post('/runs', { feature: fid }); } catch (e) { alert(e.message); } finally { setBusy(false); } };
  const retry = async rid => { setBusy(true); try { await post(`/runs/${rid}/retry`, {}); } catch (e) { alert(e.message); } finally { setBusy(false); } };
  const sprint = () => post('/sprint', {});

  return (
    <>
      <Card>
        <div className="row wrap" style={{ gap: 14 }}>
          <button className="btn primary" onClick={sprint} disabled={active.length > 0}><Play size={15} />Run sprint</button>
          <span className="dim" style={{ fontSize: 12.5 }}>Runs all six features in dependency order ({settings.concurrency ?? 2} at a time). Dependents wait until upstream decisions are in Meko.</span>
          <div style={{ marginLeft: 'auto' }} className="row wrap">
            <Toggle on={!settings.autoApprove} onChange={v => setSetting({ autoApprove: !v })} label="Human approval at G6" />
            <Toggle on={settings.useArtifactCache !== false} onChange={v => setSetting({ useArtifactCache: v })} label="Reuse artifacts from Meko" />
            <select className="input" style={{ width: 'auto' }} value={settings.concurrency ?? 2} onChange={e => setSetting({ concurrency: Number(e.target.value) })}>{[1, 2, 3].map(n => <option key={n} value={n}>{n} parallel</option>)}</select>
          </div>
        </div>
      </Card>

      {waiting.map(r => (
        <div key={r.id} className="card" style={{ borderColor: '#fcd34d', background: 'linear-gradient(135deg, #fffbeb, #ffffff)' }}>
          <div className="row wrap">
            <PauseCircle size={22} color="#d97706" />
            <div><div style={{ fontWeight: 750 }}>{r.feature} · {r.title} is ready to ship</div><div className="muted" style={{ fontSize: 12.5 }}>All automated gates are green on PR #{r.pr}. Helm is waiting for a human release approval.</div></div>
            <div style={{ marginLeft: 'auto' }} className="row">
              <a className="btn sm" href={r.prUrl} target="_blank" rel="noreferrer"><GitPullRequest size={13} />PR #{r.pr}</a>
              <button className="btn success" onClick={() => setApproving(r)}><CheckCircle2 size={15} />Review & approve</button>
            </div>
          </div>
        </div>
      ))}

      <Card title="Feature pipeline" hint="click any stage for its gate report, Meko recall and artifact">
        <div style={{ overflowX: 'auto' }}>
          <div className="pipe" style={{ minWidth: 1040 }}>
            <div className="pipe-head">Feature</div>
            {STAGES.map(st => { const g = gateOf(st); return <div key={st} className="pipe-head">{LABEL[st]}<small>{g.gate} · {st === 'develop' ? 'feature agent' : agentOf(s, g.agent)?.name}</small></div>; })}
            {s.features.map(f => {
              const r = latestRun(s, f.id);
              const owner = agentOf(s, f.owner);
              return (
                <React.Fragment key={f.id}>
                  <div className="pipe-feature">
                    <div className="row between"><span className="fid">{f.id}</span>{r ? <StatusBadge status={r.status} /> : <Badge>not started</Badge>}</div>
                    <div className="ft">{f.title}</div>
                    <div className="row" style={{ gap: 6 }}><Avatar agent={owner} size="sm" /><span className="dim" style={{ fontSize: 11.5 }}>{owner?.name} · {owner?.owner}</span></div>
                    <div className="row" style={{ gap: 6 }}>
                      {(!r || ['deployed', 'failed', 'error', 'interrupted'].includes(r.status)) && <button className="btn sm" disabled={busy} onClick={() => run(f.id)}><Play size={12} />{r ? 'Re-run' : 'Run'}</button>}
                      {r && ['failed', 'error', 'interrupted'].includes(r.status) && <button className="btn sm" disabled={busy} onClick={() => retry(r.id)} title={r.failedStage === 'test' || r.failedStage === 'review' ? 'Send back to the developer with the findings' : 'Retry the failed stage'}><RotateCcw size={12} />{r.failedStage === 'test' || r.failedStage === 'review' ? 'Fix' : 'Retry'}</button>}
                      {r?.prUrl && <a className="btn sm ghost" href={r.prUrl} target="_blank" rel="noreferrer"><GitPullRequest size={12} />#{r.pr}</a>}
                    </div>
                  </div>
                  {STAGES.map(st => <StageCell key={st} s={s} run={r} stage={st} onClick={() => r && setOpen({ runId: r.id, stage: st })} />)}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </Card>

      <div className="grid g-2-1">
        <Card title="Run log" hint={logRun ? `${logRun.feature} · ${logRun.id}` : ''} icon={<Clock size={16} className="dim" />}>
          {logRun ? (
            <div className="feed" style={{ maxHeight: 360 }}>
              {[...logRun.log].reverse().map((l, i) => (
                <div className="feed-item" key={i}>
                  {l.level === 'error' ? <XCircle size={14} color="#e11d48" /> : l.level === 'success' ? <CheckCircle2 size={14} color="#16a34a" /> : l.level === 'warn' ? <AlertTriangle size={14} color="#d97706" /> : <Zap size={14} color="#7c3aed" />}
                  <div style={{ whiteSpace: 'normal' }}><Badge tone="gray">{l.stage}</Badge> {l.message}</div>
                  <span className="t">{l.at.slice(11, 19)}</span>
                </div>
              ))}
            </div>
          ) : <Empty>No runs yet — start one above.</Empty>}
        </Card>
        <Card title="Recent runs">
          <div className="feed" style={{ maxHeight: 360 }}>
            {s.runs.slice(0, 20).map(r => (
              <div className="feed-item" key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpen({ runId: r.id, stage: r.failedStage ?? STAGES.findLast(st => r.stages[st].status !== 'pending') ?? 'plan' })}>
                <StatusIcon status={r.status} />
                <div className="main-t"><b>{r.feature}</b> <span className="dim mono" style={{ fontSize: 11 }}>{r.id}</span>{r.from !== 'plan' && <Badge tone="blue">from {r.from}</Badge>}</div>
                <span className="t">{fmt.ago(r.createdAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {open && <StageDrawer s={s} open={open} onClose={() => setOpen(null)} setOpen={setOpen} />}
      <ApproveModal s={s} run={approving} onClose={() => setApproving(null)} />
    </>
  );
}

function StageCell({ s, run, stage, onClick }) {
  const st = run?.stages?.[stage];
  const status = st?.status ?? 'pending';
  const agent = agentOf(s, st?.agent);
  const t = st?.tokens;
  const saved = t && t.baseline ? 1 - (t.meko || 0) / t.baseline : null;
  return (
    <div className={`stage ${status}`} onClick={onClick}>
      <div className="st-top"><StatusIcon status={status} />{status === 'awaiting_approval' ? 'Needs approval' : status === 'pending' ? 'Waiting' : status.charAt(0).toUpperCase() + status.slice(1)}{agent && <span style={{ marginLeft: 'auto' }}><Avatar agent={agent} size="sm" busy={status === 'running'} /></span>}</div>
      {t && <div className="save">{t.reused ? '♻ reused · 0 LLM tokens' : `−${Math.round(saved * 100)}% tokens`}</div>}
      <div className="st-meta">
        {st?.recalled?.length > 0 && <span title="memories recalled from Meko"><Brain size={11} /> {st.recalled.length}</span>}
        {st?.gate && <span title="guardrails passed">{st.gate.guardrails.filter(g => g.pass).length}/{st.gate.guardrails.length} guards</span>}
        {st?.acceptance && <span>{st.acceptance.passed}/{st.acceptance.total} ACs</span>}
        {st?.judge && <span>judge {st.judge.score}</span>}
        {st?.durationMs && <span>{fmt.ms(st.durationMs)}</span>}
      </div>
    </div>
  );
}

function StageDrawer({ s, open, onClose, setOpen }) {
  const run = s.runs.find(r => r.id === open.runId);
  if (!run) return null;
  const st = run.stages[open.stage];
  const agent = agentOf(s, st.agent);
  const gate = s.gates.stages.find(g => g.id === open.stage);
  const commits = run.commits.filter(c => c.agent === st.agent);
  const isCode = open.stage === 'develop';
  return (
    <Drawer open onClose={onClose} icon={<Avatar agent={agent} size="lg" busy={st.status === 'running'} />}
      title={`${gate.gate} · ${run.feature} ${run.title}`}
      subtitle={`${agent?.name} — ${agent?.role} · owner ${agent?.owner} (${agent?.ownerRole})`}
      actions={<StatusBadge status={st.status} />}>
      <div className="tabs" style={{ justifySelf: 'start' }}>{STAGES.map(x => <button key={x} className={x === open.stage ? 'on' : ''} onClick={() => setOpen({ ...open, stage: x })}>{LABEL[x]}</button>)}</div>
      <div className="muted" style={{ fontSize: 13 }}>{gate.description}</div>
      {st.error && <div className="card" style={{ borderColor: 'rgba(244,63,94,0.5)' }}><b style={{ color: '#e11d48' }}>Error</b> <span className="mono">{st.error}</span></div>}
      {st.status === 'pending' && <Empty>This stage hasn't run yet.</Empty>}

      {st.tokens && (
        <Card title="Meko token economics" icon={<Brain size={16} color="#7c3aed" />} right={st.tokens.reused ? <Badge tone="violet"><Recycle size={11} />artifact reused</Badge> : <Badge tone="green">−{Math.round((1 - st.tokens.meko / Math.max(1, st.tokens.baseline)) * 100)}% input tokens</Badge>}>
          <BarCompare baseline={st.tokens.baseline} meko={st.tokens.meko} labelBase="Memory-less agent (full specs, knowledge base, standards, all upstream artifacts)" labelMeko="With Meko recall (task + spec + top-k memories and knowledge)" />
          <div className="dim" style={{ fontSize: 11.5, marginTop: 10 }}>Baseline measured with Claude count_tokens and never sent. Output: {fmt.n(st.tokens.output)} tokens{st.tokens.llm ? ` from ${s.claude?.model}` : ''}.</div>
        </Card>
      )}

      {st.gate && (
        <Card title="Gate result" icon={<ShieldCheck size={16} color={st.gate.pass ? '#16a34a' : '#e11d48'} />} right={<Badge tone={st.gate.pass ? 'green' : 'red'}>{st.gate.pass ? 'PASSED' : 'BLOCKED'}</Badge>}>
          <table className="t">
            <tbody>
              {st.gate.guardrails.map(g => (
                <tr key={g.id}><td style={{ width: 26 }}>{g.pass ? <CheckCircle2 size={15} color="#16a34a" /> : g.severity === 'warn' ? <AlertTriangle size={15} color="#d97706" /> : <XCircle size={15} color="#e11d48" />}</td><td className="mono" style={{ width: 200 }}>{g.id}</td><td>{g.detail}</td></tr>
              ))}
              {st.gate.evals.map(e => (
                <tr key={e.id}><td>{e.pass ? <CheckCircle2 size={15} color="#16a34a" /> : <XCircle size={15} color="#e11d48" />}</td><td className="mono"><FlaskConical size={12} /> {e.id}</td><td><b>{e.value}</b> <span className="dim">≥ {e.threshold}</span> · {e.detail}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {st.acceptance && (
        <Card title="Acceptance suite" hint={`${st.acceptance.passed}/${st.acceptance.total} · ${st.behavioural?.detail}`} icon={<FlaskConical size={16} color="#65a30d" />}>
          <table className="t"><tbody>{st.acceptance.tests.map((t, i) => <tr key={i}><td style={{ width: 26 }}>{t.ok ? <CheckCircle2 size={15} color="#16a34a" /> : <XCircle size={15} color="#e11d48" />}</td><td className="mono" style={{ width: 90 }}>{t.ac}</td><td>{t.name.replace(/^AC-F\d\d-\d+\s*/, '')}</td></tr>)}</tbody></table>
          {st.failures?.length > 0 && <pre className="code" style={{ marginTop: 10 }}>{st.failures.join('\n')}</pre>}
        </Card>
      )}

      {st.judge && (
        <Card title="Sentinel review" hint={`LLM-judge ${st.judge.score}`} icon={<ShieldCheck size={16} color="#ef4444" />}>
          <div className="md"><p>{st.judge.summary}</p></div>
          {st.judge.findings.map((x, i) => <div key={i} className="mem"><div className="row"><Badge tone={{ critical: 'red', high: 'red', medium: 'amber', low: 'blue' }[String(x.severity).toLowerCase()] ?? 'gray'}>{x.severity}</Badge><b>{x.title}</b></div><div className="muted">{x.detail}</div></div>)}
        </Card>
      )}

      {st.approval && <Card title="Release approval" icon={<Rocket size={16} color="#c026d3" />}><div>{st.approval.rejected ? 'Rejected' : 'Approved'} by <b>{st.approval.by}</b> at {st.approval.at?.slice(0, 19).replace('T', ' ')} UTC{st.approval.note ? ` — “${st.approval.note}”` : ''}</div></Card>}

      {st.recalled?.length > 0 && (
        <Card title={`Recalled from Meko (${st.recalled.length})`} hint="team memory this agent reused instead of re-reading the repo" icon={<Brain size={16} color="#7c3aed" />}>
          <div className="col">
            {st.recalled.map(m => {
              const writer = agentOf(s, m.agent?.replace('adlc:', ''));
              const other = m.agent !== `adlc:${st.agent}`;
              return (
                <div key={m.id} className={`mem ${other ? 'reused' : ''}`}>
                  <div className="who">{writer ? <Avatar agent={writer} size="sm" /> : <Badge tone="gray">org</Badge>}<span>{writer ? `${writer.name} wrote` : 'Org standard'}</span>{m.kind && <Badge tone={m.kind.includes('security') ? 'red' : 'gray'}>{m.kind}</Badge>}{m.score && <span className="mono" style={{ marginLeft: 'auto' }}>{m.score.toFixed(2)}</span>}</div>
                  <div>{m.text}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {st.kb?.length > 0 && (
        <Card title="Knowledge chunks from Meko" icon={<BookOpen size={16} color="#0891b2" />}>
          <div className="col">{st.kb.map((k, i) => <div key={i} className="mem"><div className="who"><BookOpen size={11} />{k.doc}</div><div className="muted">{k.text}…</div></div>)}</div>
        </Card>
      )}

      {st.decisions?.length > 0 && (
        <Card title="Decisions written to Meko for the team" icon={<Lightbulb size={16} color="#d97706" />}>
          <div className="col">{st.decisions.map((d, i) => <div key={i} className="mem"><div>{d}</div></div>)}</div>
        </Card>
      )}

      {st.artifact && (
        <Card title={isCode ? run.stages.develop && `edge/features/${run.slug}/index.js` : `specs/features/${run.slug}/${open.stage}.md`} icon={<FileCode2 size={16} />}>
          {isCode ? <pre className="code">{st.artifact}</pre> : <Markdown text={st.artifact} />}
        </Card>
      )}

      <Card title="On GitHub" icon={<GitCommit size={16} />}>
        <div className="col">
          <div className="row wrap"><Badge tone="gray">branch</Badge><a className="mono" href={`${s.github.url}/tree/${run.branch}`} target="_blank" rel="noreferrer">{run.branch} <ExternalLink size={11} /></a>{run.prUrl && <a className="btn sm" href={run.prUrl} target="_blank" rel="noreferrer"><GitPullRequest size={12} />PR #{run.pr}</a>}</div>
          {commits.map(c => <a key={c.sha} className="row" href={`${s.github.url}/commit/${c.sha}`} target="_blank" rel="noreferrer"><span className="mono" style={{ color: '#7c3aed' }}>{c.sha.slice(0, 7)}</span><span className="ellipsis">{c.message}</span></a>)}
          <div className="row wrap">{Object.entries(run.statuses ?? {}).map(([k, v]) => <Badge key={k} tone={v.state === 'success' ? 'green' : v.state === 'failure' ? 'red' : 'amber'}>{k}</Badge>)}</div>
        </div>
      </Card>
    </Drawer>
  );
}

function ApproveModal({ s, run, onClose }) {
  const approvers = s.roster.agents.map(a => `${a.owner} · ${a.ownerRole}`).concat(['Release manager']);
  const owner = run && agentOf(s, s.features.find(f => f.id === run.feature)?.owner);
  const [by, setBy] = useState('');
  const [note, setNote] = useState('');
  if (!run) return null;
  const who = by || (owner ? `${owner.owner} · ${owner.ownerRole}` : 'Release manager');
  const act = async reject => { await post(`/runs/${run.id}/approve`, { by: who, note, reject }); onClose(); };
  return (
    <Modal open onClose={onClose}>
      <div className="row" style={{ marginBottom: 14 }}><Rocket size={22} color="#c026d3" /><div><div style={{ fontWeight: 800, fontSize: 17 }}>Release {run.feature} to edge-staging?</div><div className="dim" style={{ fontSize: 12.5 }}>Helm will squash-merge PR #{run.pr} and record a GitHub deployment.</div></div></div>
      <div className="col" style={{ marginBottom: 14 }}>
        {STAGES.slice(0, 5).map(st => <div key={st} className="row" style={{ fontSize: 13 }}><StatusIcon status={run.stages[st].status} /><span style={{ width: 70 }}>{LABEL[st]}</span><span className="dim">{run.stages[st].gate ? `${run.stages[st].gate.guardrails.filter(g => g.pass).length}/${run.stages[st].gate.guardrails.length} guardrails · ${run.stages[st].gate.evals.map(e => `${e.id} ${e.value}`).join(', ')}` : ''}</span></div>)}
      </div>
      <label className="dim" style={{ fontSize: 12 }}>Approver (pseudonymous team id — no personal names)</label>
      <select className="input" value={who} onChange={e => setBy(e.target.value)} style={{ margin: '6px 0 12px' }}>{approvers.map(a => <option key={a}>{a}</option>)}</select>
      <input className="input" placeholder="Note for the PR (optional — personal data is redacted)" value={note} onChange={e => setNote(e.target.value)} />
      <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        <a className="btn" href={run.prUrl} target="_blank" rel="noreferrer"><GitPullRequest size={14} />Inspect PR</a>
        <button className="btn danger" onClick={() => act(true)}>Reject</button>
        <button className="btn success" onClick={() => act(false)}><CheckCircle2 size={15} />Approve & deploy</button>
      </div>
    </Modal>
  );
}
