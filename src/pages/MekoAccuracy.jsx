import React, { useEffect, useState } from 'react';
import { Target, Play, Loader2, CheckCircle2, XCircle, HelpCircle, BookOpen, Brain, Eraser, ChevronDown, ChevronRight, MapPin, ShieldCheck } from 'lucide-react';
import { Card, Badge, Empty } from '../components/ui.jsx';
import { api, post, fmt } from '../api.js';

const V = '#7c3aed', CY = '#0891b2', GR = '#16a34a', RD = '#e5484d';

export default function MekoAccuracy({ s, go }) {
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState(null);
  const [hyg, setHyg] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [retracted, setRetracted] = useState(null);
  const [open, setOpen] = useState(null);

  const loadHyg = () => api('/meko/hygiene').then(setHyg).catch(() => setHyg(null));
  useEffect(() => { api('/reval').then(setMeta).catch(e => setErr(e.message)); loadHyg(); }, []);

  const live = s.reval ?? meta;
  const res = live?.result ?? meta?.result;
  const running = live?.running, prog = live?.progress;
  const sm = res?.summary;

  const run = async () => { setErr(null); try { await post('/reval/run', {}); } catch (e) { setErr(e.message); } };
  const retract = async () => { const r = await post('/meko/hygiene/retract', {}); setRetracted(r); setConfirm(false); loadHyg(); };

  return (
    <>
      <div className="card glow" style={{ padding: '20px 24px' }}>
        <div className="row wrap" style={{ gap: 16 }}>
          <div style={{ flex: 1, minWidth: 320 }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>Is Meko’s context <span className="grad-text">accurate and relevant?</span> Measured.</div>
            <div className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>{meta?.questions ?? 30} ADLC questions with known answers. For each: what Meko retrieves, whether the answer-bearing fact is in it and at what rank, how relevant each retrieved item is, and whether an answer built only from that context is correct.</div>
          </div>
          <div className="col" style={{ alignItems: 'flex-end', gap: 6 }}>
            <button className="btn primary" onClick={run} disabled={running}>{running ? <Loader2 size={15} className="spin" /> : <Play size={15} />}{running ? 'Evaluating…' : 'Run evaluation'}</button>
            <span className="dim" style={{ fontSize: 11.5 }}>≈ $0.15 · {meta?.questions ?? 30} questions · {res ? `last run ${fmt.dateTime(res.at)}` : 'not run yet'}</span>
          </div>
        </div>
        {running && prog && <div style={{ marginTop: 12 }}><div className="gauge" style={{ height: 8 }}><span style={{ width: `${(prog.done / prog.total) * 100}%`, background: 'var(--grad)' }} /></div></div>}
      </div>

      {err && <div className="card" style={{ borderColor: '#fde68a', background: '#fffbeb', fontSize: 13 }}>{/404|Cannot/.test(err) ? <>The evaluation API isn’t loaded yet — restart <span className="kbd">npm run dev</span>.</> : err}</div>}

      {sm ? (
        <>
          <div className="grid g4">
            <Ring label="Answer accuracy" sub="correct answers from Meko context only" v={sm.accuracy} target={0.9} color={GR} />
            <Ring label="Hit@3" sub="answer-bearing fact in the top 3" v={sm.hitAt[2].v} target={0.9} color={V} />
            <Ring label="MRR" sub="mean reciprocal rank of the first correct fact" v={sm.mrr} target={0.8} color={CY} />
            <Ring label="Top-3 precision" sub="top-3 items judged relevant" v={sm.top3Precision} target={0.75} color="#d97706" />
          </div>

          <div className="grid g3">
            <Card title="Hit@k — is the right fact retrieved?" icon={<Target size={16} color={V} />} hint="share of questions whose gold evidence is within the top k">
              <HitCurve data={sm.hitAt} />
            </Card>
            <Card title="Meko relevance score vs judged relevance" icon={<Brain size={16} color={V} />} hint="memory items by Meko score bucket">
              <Calibration data={sm.scoreBuckets} />
            </Card>
            <Card title="In numbers" icon={<ShieldCheck size={16} color={GR} />}>
              <div className="cq-facts">
                <Fact k="Grounded accuracy" v={fmt.pct(sm.grounded)} d="correct and the supporting evidence was retrieved — not a lucky guess" />
                <Fact k="Hit@1 / Hit@5" v={`${fmt.pct(sm.hitAt[0].v)} / ${fmt.pct(sm.hitAt[4].v)}`} d="right fact ranked first / in the top five" />
                <Fact k="Context precision" v={fmt.pct(sm.precision)} d={`of all retrieved items; ${fmt.pct(sm.highlyRelevant)} directly answer the question`} />
                <Fact k="Said “unknown”" v={sm.unknown} d="the model refused to guess when context was missing" />
                <Fact k="Context per answer" v={`${fmt.n(sm.avgTokens)} tokens`} d={`whole evaluation cost ${fmt.usd(sm.cost)}`} />
              </div>
            </Card>
          </div>

          <Card title="Every question — what Meko retrieved and how relevant it was" hint="click a row to see the retrieved items, their scores, gold evidence ✓ and relevance 2/1/0" icon={<Brain size={16} color={V} />}>
            <table className="t">
              <thead><tr><th /><th>Question</th><th>Expected</th><th style={{ textAlign: 'center' }}>Gold rank</th><th>Relevance of top 5</th><th style={{ textAlign: 'center' }}>Answer</th></tr></thead>
              <tbody>{res.rows.map(r => (
                <React.Fragment key={r.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td>{open === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                    <td style={{ maxWidth: 380 }}><b className="mono">{r.id}</b> <span className="muted" style={{ fontSize: 12.5 }}>{r.q}</span></td>
                    <td style={{ fontSize: 12 }}>{r.expected}</td>
                    <td style={{ textAlign: 'center' }}>{r.firstGoldRank ? <Badge tone={r.firstGoldRank === 1 ? 'green' : r.firstGoldRank <= 3 ? 'blue' : 'amber'}>#{r.firstGoldRank}</Badge> : <Badge tone="red">miss</Badge>}</td>
                    <td><div className="row" style={{ gap: 3 }}>{[...r.items].sort((a, b) => a.rank - b.rank || (a.source === 'memory' ? -1 : 1)).slice(0, 5).map((it, i) => <span key={i} className={`rv rv${it.judge ?? 'x'} ${it.gold ? 'gold' : ''}`} title={`${it.source} #${it.rank} · relevance ${it.judge ?? '?'}${it.gold ? ' · gold evidence' : ''}`}>{it.judge ?? '·'}</span>)}</div></td>
                    <td style={{ textAlign: 'center' }} title={r.answer}>{r.correct ? <CheckCircle2 size={16} color={GR} /> : r.unknown ? <HelpCircle size={16} color="#d97706" /> : <XCircle size={16} color={RD} />}</td>
                  </tr>
                  {open === r.id && (
                    <tr><td /><td colSpan={5}>
                      <div className="col" style={{ gap: 6, padding: '6px 0 10px' }}>
                        <div style={{ fontSize: 12.5 }}><b>Answer from Meko context:</b> {r.answer}</div>
                        {r.items.map((it, i) => (
                          <div key={i} className={`mem ${it.gold ? 'reused' : ''}`}>
                            <div className="who">
                              {it.source === 'memory' ? <Brain size={11} /> : <BookOpen size={11} />}{it.source} #{it.rank}
                              {it.agent && <Badge tone="violet">{it.agent}</Badge>}{it.kind && <Badge tone="gray">{it.kind}</Badge>}
                              {it.gold && <Badge tone="green">gold evidence</Badge>}
                              <span className={`rv rv${it.judge ?? 'x'}`} style={{ marginLeft: 'auto' }}>{it.judge ?? '·'}</span>
                              {it.score != null && <span className="mono">score {Number(it.score).toFixed(2)}</span>}
                            </div>
                            <div style={{ fontSize: 12.5 }}>{String(it.text).slice(0, 420)}</div>
                          </div>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}</tbody>
            </table>
          </Card>
        </>
      ) : <Card><Empty icon={<Target />}>No evaluation yet — press <b>Run evaluation</b> (≈ $0.15).</Empty></Card>}

      <div className="grid g2">
        <Card title="Memory hygiene" icon={<Eraser size={16} color="#d97706" />} hint="keeping shared memory correct is part of accuracy">
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Developer decisions now reach Meko only after the test gate proves them. Decisions written earlier by runs that later failed their test or review gate may be wrong (e.g. a guessed <span className="mono">consume(sku, qty)</span>) — and a wrong memory is recalled just as confidently as a right one.
          </div>
          {retracted && <div className="badge b-green" style={{ marginBottom: 10, padding: '6px 10px' }}>Retracted {retracted.removed} decision(s) from failed runs. Re-run the evaluation to measure the effect.</div>}
          {hyg ? (hyg.length ? (
            <>
              <div className="feed" style={{ maxHeight: 200, marginBottom: 10 }}>
                {hyg.slice(0, 40).map(m => <div key={m.id} className="feed-item" style={{ gridTemplateColumns: 'auto 1fr' }}><Badge tone="amber">{m.feature}/{m.stage}</Badge><div className="main-t" title={m.text}><span className="mono dim" style={{ fontSize: 11 }}>{m.run}</span> {m.text}</div></div>)}
              </div>
              {!confirm
                ? <button className="btn" onClick={() => setConfirm(true)}><Eraser size={14} />Retract {hyg.length} decision(s) from failed runs…</button>
                : <div className="row wrap"><span style={{ fontSize: 12.5 }}>This permanently deletes {hyg.length} memories from the Meko datapack. Lessons and passing runs’ decisions are kept.</span><button className="btn danger" onClick={retract}>Delete {hyg.length} from Meko</button><button className="btn ghost" onClick={() => setConfirm(false)}>Cancel</button></div>}
            </>
          ) : <div className="badge b-green" style={{ padding: '6px 10px' }}>No decisions from failed runs in shared memory.</div>) : <div className="dim" style={{ fontSize: 12.5 }}>Loading…</div>}
        </Card>

        <Card title="Where relevance shows up in the Studio" icon={<MapPin size={16} color={CY} />}>
          <div className="col" style={{ gap: 8 }}>
            <Where onClick={() => go('pipeline')} t="Pipeline → any stage → “Recalled from Meko”" d="the exact memories each agent received, who wrote them and Meko’s relevance score" />
            <Where onClick={() => go('meko')} t="Meko Memory → Semantic search" d="query the datapack and see scored memories and knowledge chunks" />
            <Where onClick={() => go('ask')} t="Ask the Fleet → Grounding" d="the memories and knowledge behind every answer" />
            <Where onClick={() => go('context-quality')} t="Context Quality" d="accuracy and cost vs context size — stuffing against Meko" />
            <Where onClick={() => go('meko-internals')} t="Meko Internals → Trace a recall" d="step through a live recall with scores and provenance" />
          </div>
        </Card>
      </div>
    </>
  );
}

function Ring({ label, sub, v, target, color }) {
  const r = 44, c = 2 * Math.PI * r, pass = v >= target;
  const ta = target * 2 * Math.PI - Math.PI / 2;
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16 }}>
      <svg width="112" height="112" viewBox="0 0 112 112">
        <circle cx="56" cy="56" r={r} fill="none" stroke="#eef1f6" strokeWidth="10" />
        <circle cx="56" cy="56" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * Math.min(1, v)} ${c}`} transform="rotate(-90 56 56)" />
        <line x1={56 + Math.cos(ta) * (r - 8)} y1={56 + Math.sin(ta) * (r - 8)} x2={56 + Math.cos(ta) * (r + 8)} y2={56 + Math.sin(ta) * (r + 8)} stroke="#0f172a" strokeWidth="2.5" />
        <text x="56" y="61" textAnchor="middle" fontSize="20" fontWeight="800" fill="#0f172a">{v <= 1 && label !== 'MRR' ? `${Math.round(v * 100)}%` : v.toFixed(2)}</text>
      </svg>
      <div>
        <div style={{ fontWeight: 800, fontSize: 14.5 }}>{label}</div>
        <div className="muted" style={{ fontSize: 12, margin: '3px 0 6px' }}>{sub}</div>
        <Badge tone={pass ? 'green' : 'amber'}>{pass ? '✓ meets' : 'below'} target {label === 'MRR' ? target.toFixed(2) : `${Math.round(target * 100)}%`}</Badge>
      </div>
    </div>
  );
}

function HitCurve({ data }) {
  const Wd = 420, Ht = 200, L = 36, R = 12, T = 12, B = 30;
  const x = i => L + (i * (Wd - L - R)) / (data.length - 1), y = v => T + (1 - v) * (Ht - T - B);
  const d = data.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${Wd} ${Ht}`} style={{ width: '100%' }}>
      {[0, 0.25, 0.5, 0.75, 1].map(v => <g key={v}><line x1={L} x2={Wd - R} y1={y(v)} y2={y(v)} stroke="#eef1f6" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{v * 100}</text></g>)}
      <line x1={L} x2={Wd - R} y1={y(0.9)} y2={y(0.9)} stroke="#16a34a" strokeDasharray="4 4" /><text x={Wd - R} y={y(0.9) - 4} textAnchor="end" fontSize="10" fill="#16a34a">90% target</text>
      <path d={`${d} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="#7c3aed14" />
      <path d={d} fill="none" stroke="#7c3aed" strokeWidth="3" />
      {data.map((p, i) => <g key={p.k}><circle cx={x(i)} cy={y(p.v)} r="4.5" fill="#7c3aed" stroke="#fff" strokeWidth="2" /><text x={x(i)} y={Ht - 10} textAnchor="middle" fontSize="11" fill="#475569">k={p.k}</text></g>)}
    </svg>
  );
}

function Calibration({ data }) {
  const max = Math.max(1, ...data.map(b => b.relevant + b.irrelevant));
  return (
    <div className="col" style={{ gap: 6 }}>
      {data.map(b => (
        <div key={b.range} className="row" style={{ gap: 8, fontSize: 11.5 }}>
          <span className="mono" style={{ width: 62 }}>{b.range}</span>
          <div style={{ flex: 1, display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: '#f1f4f9' }}>
            <div style={{ width: `${(b.relevant / max) * 100}%`, background: '#7c3aed' }} title={`${b.relevant} relevant`} />
            <div style={{ width: `${(b.irrelevant / max) * 100}%`, background: '#cbd5e1' }} title={`${b.irrelevant} irrelevant`} />
          </div>
          <span className="mono" style={{ width: 54, textAlign: 'right' }}>{b.relevant}/{b.relevant + b.irrelevant}</span>
        </div>
      ))}
      <div className="row dim" style={{ gap: 14, fontSize: 11, marginTop: 4 }}><span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#7c3aed', marginRight: 5 }} />judged relevant</span><span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#cbd5e1', marginRight: 5 }} />judged irrelevant</span></div>
    </div>
  );
}

const Fact = ({ k, v, d }) => <div><div className="row between"><b style={{ fontSize: 12.5 }}>{k}</b><span className="mono" style={{ fontWeight: 800 }}>{v}</span></div><div className="dim" style={{ fontSize: 11.5 }}>{d}</div></div>;
const Where = ({ t, d, onClick }) => <div className="mem" style={{ cursor: 'pointer' }} onClick={onClick}><b style={{ fontSize: 12.5 }}>{t}</b><div className="muted" style={{ fontSize: 12 }}>{d}</div></div>;
