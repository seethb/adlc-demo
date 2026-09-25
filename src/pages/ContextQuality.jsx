import React, { useEffect, useState } from 'react';
import { AlertTriangle, Zap, Play, Loader2, CheckCircle2, XCircle, HelpCircle, FlaskConical, Info } from 'lucide-react';
import { Card, Badge, Tabs, Empty } from '../components/ui.jsx';
import { api, post, fmt } from '../api.js';

const RED = '#e5484d', CY = '#06b6d4';

export default function ContextQuality({ s }) {
  const [meta, setMeta] = useState(null);
  const [n, setN] = useState(6);
  const [est, setEst] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => { api('/bench').then(setMeta).catch(e => setErr(e.message)); }, []);
  useEffect(() => { setEst(null); api(`/bench/estimate?n=${n}`).then(setEst).catch(() => {}); }, [n]);

  const live = s.bench ?? meta;
  const res = live?.result ?? meta?.result;
  const running = live?.running;
  const prog = live?.progress;

  const chart = res ? res.levels.map(l => ({ x: `${l.n}`, label: l.label, tokens: l.tokens, stuffing: Math.round(l.accuracy * 100), meko: Math.round(res.meko.accuracy * 100) })) : [];
  const costChart = res ? [...res.levels.map(l => ({ name: `L${l.n}`, tokens: l.tokens, cost: l.cost / Math.max(1, res.questions.length), ms: l.ms })), { name: 'Meko', tokens: res.meko.tokens, cost: res.meko.cost / Math.max(1, res.questions.length), ms: res.meko.ms }] : [];
  const L1 = res?.levels[0], L6 = res?.levels.at(-1), peak = res ? res.levels.reduce((a, b) => (b.accuracy > a.accuracy ? b : a)) : null;

  const run = async () => { setErr(null); try { await post('/bench/run', { questions: n }); } catch (e) { setErr(e.message); } };

  return (
    <>
      <div className="card glow" style={{ padding: '20px 24px' }}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>More context should mean better answers. <span style={{ color: RED }}>It doesn’t.</span></div>
        <div className="muted" style={{ fontSize: 13.5, marginTop: 6, maxWidth: 980 }}>
          Measured on this ADLC: the same engineering questions answered by <b>{res?.model ?? s.claude?.model}</b> with ever larger “stuffed” context — exactly how a pipeline session grows — versus only the context Meko recalls. Answers are graded automatically against the specs.
        </div>
      </div>

      {err && <div className="card" style={{ borderColor: '#fde68a', background: '#fffbeb', fontSize: 13 }}>{err.includes('HTTP 404') || err.includes('Cannot') ? <>The benchmark API isn’t loaded yet — restart <span className="kbd">npm run dev</span>.</> : err}</div>}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(300px, 1fr) minmax(0, 1.6fr)', alignItems: 'stretch' }}>
        <div className="col" style={{ gap: 14 }}>
          <Verdict icon={<AlertTriangle size={18} color={RED} />} tone={RED} title="Too little context" text="Insufficient data — the model guesses, and quality suffers."
            stat={L1 && `${fmt.pct(L1.accuracy)} correct · ${fmt.n(L1.tokens)} tokens`} />
          <Verdict icon={<AlertTriangle size={18} color={RED} />} tone={RED} title="Too much context" text="The model is overwhelmed by drafts, logs and superseded decisions — quality dilutes while cost climbs."
            stat={L6 && `${fmt.pct(L6.accuracy)} correct · ${fmt.k(L6.tokens)} tokens · ${fmt.usd(L6.cost / res.questions.length)} per answer`} />
          <Verdict icon={<Zap size={18} color={CY} />} tone={CY} title="Meko-engineered context" text="Meko structures the context, tracks provenance, and extracts only the relevant subset — quality stays high at a fraction of the cost." highlight
            stat={res && `${fmt.pct(res.meko.accuracy)} correct · ${fmt.n(res.meko.tokens)} tokens · ${fmt.usd(res.meko.cost / res.questions.length)} per answer`} />
        </div>

        <Card title="Output quality vs. context size" hint={res ? `run ${fmt.dateTime(res.at)} · ${res.questions.length} questions` : 'no run yet'}>
          {res ? (
            <>
              <QualityChart data={chart} peak={peak?.n} />
              {res.questions.length < 4 && <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Only {res.questions.length} question{res.questions.length > 1 ? 's' : ''} in this run — each point is 0 % or 100 %. Run 6 or 12 questions for a real curve.</div>}
            </>
          ) : <Empty icon={<FlaskConical />}>Run the benchmark below to draw this chart from real measurements.</Empty>}
        </Card>
      </div>

      <div className="grid g-2-1">
        <Card title="Run the benchmark" icon={<FlaskConical size={16} color="#7c3aed" />} hint="real Claude calls — you pay for them">
          <div className="row wrap" style={{ gap: 12 }}>
            <Tabs value={n} onChange={setN} options={[{ value: 4, label: '4 questions' }, { value: 6, label: '6 questions' }, { value: 12, label: 'All 12' }]} />
            <span className="muted" style={{ fontSize: 12.5 }}>{est ? <>{est.questions} × 6 context levels + Meko = {est.questions * 7} calls · est. <b>{fmt.usd(est.estCost)}</b> on {est.model}</> : 'estimating…'}</span>
            <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={run} disabled={running || !est}>{running ? <Loader2 size={15} className="spin" /> : <Play size={15} />}{running ? 'Running…' : 'Run benchmark'}</button>
          </div>
          {running && prog && <div style={{ marginTop: 12 }}><div className="gauge" style={{ height: 8 }}><span style={{ width: `${(prog.done / prog.total) * 100}%`, background: 'var(--grad)' }} /></div><div className="dim" style={{ fontSize: 12, marginTop: 6 }}>{prog.done} / {prog.total} answers graded</div></div>}
          {est && (
            <table className="t" style={{ marginTop: 14 }}>
              <thead><tr><th>Level</th><th>What the agent is given</th><th className="num">≈ tokens per question</th></tr></thead>
              <tbody>{est.levels.map(l => <tr key={l.n}><td className="mono">{l.n}</td><td>{l.label}</td><td className="num mono">{fmt.n(l.tokens)}</td></tr>)}
                <tr><td className="mono" style={{ color: CY }}>M</td><td><b>Meko recall</b> — top-k memories + knowledge chunks for the question</td><td className="num mono">{res ? fmt.n(res.meko.tokens) : '≈ 1–3k'}</td></tr></tbody>
            </table>
          )}
        </Card>
        <Card title="Cost and latency per answer" icon={<Info size={16} className="dim" />}>
          {res ? <CostBars data={costChart} /> : <Empty>—</Empty>}
        </Card>
      </div>

      {res && (
        <Card title="Every answer, graded" hint="✓ correct · ✗ wrong · ? said unknown — hover for the model’s answer" icon={<CheckCircle2 size={16} color="#16a34a" />}>
          <div style={{ overflowX: 'auto' }}>
            <table className="t">
              <thead><tr><th>Question</th><th>Expected</th>{res.levels.map(l => <th key={l.n} style={{ textAlign: 'center' }}>L{l.n}</th>)}<th style={{ textAlign: 'center', color: CY }}>Meko</th></tr></thead>
              <tbody>{res.questions.map(q => (
                <tr key={q.id}>
                  <td style={{ maxWidth: 360 }}><b className="mono">{q.id}</b> <span className="muted" style={{ fontSize: 12.5 }}>{q.q}</span></td>
                  <td style={{ fontSize: 12 }}>{q.answer}</td>
                  {[...res.levels.map(l => ['stuffing', l.n]), ['meko', 0]].map(([arm, lv]) => {
                    const r = res.rows.find(x => x.arm === arm && x.level === lv && x.q === q.id);
                    return <td key={`${arm}${lv}`} style={{ textAlign: 'center' }} title={r?.answer}>{!r ? '—' : r.correct ? <CheckCircle2 size={16} color="#16a34a" /> : r.unknown ? <HelpCircle size={16} color="#d97706" /> : <XCircle size={16} color={RED} />}</td>;
                  })}
                </tr>
              ))}
                <tr><td colSpan={2}><b>Accuracy</b></td>{res.levels.map(l => <td key={l.n} style={{ textAlign: 'center' }}><Badge tone={l.accuracy >= 0.8 ? 'green' : l.accuracy >= 0.5 ? 'amber' : 'red'}>{fmt.pct(l.accuracy)}</Badge></td>)}<td style={{ textAlign: 'center' }}><Badge tone="cyan">{fmt.pct(res.meko.accuracy)}</Badge></td></tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="How this is measured" icon={<Info size={16} className="dim" />}>
        <div className="md" style={{ fontSize: 13 }}>
          <ul>
            <li><b>Questions</b> are ones ADLC agents really need answered (priorities and SLAs, ISO zones, transport security, the F05 inventory contract, identifier formats, planner vocabulary, telemetry validation, import rules, limits, data residency, CAR triggers). Each has an exact answer in the specs or standards and is graded by pattern, not by an LLM.</li>
            <li><b>Context stuffing</b> grows the way a pipeline session does: the relevant spec → all specs → knowledge base and standards → every plan, design and code artifact → the full pipeline history, including failed attempts, review findings, an earlier F03 spec revision and the team memory log. Level 6 is trimmed only in its oldest history to stay near 160k tokens.</li>
            <li><b>Meko-engineered</b> gives the same model only what <span className="kbd">memory_search</span> and <span className="kbd">knowledgebase_search</span> return for the question.</li>
            <li>Tokens, cost and latency come from Claude’s real usage for each call. Results vary between runs — run it again to see the spread; nothing is hard-coded.</li>
          </ul>
        </div>
      </Card>
    </>
  );
}

function Verdict({ icon, tone, title, text, stat, highlight }) {
  return (
    <div className="card" style={{ flex: 1, display: 'flex', gap: 14, alignItems: 'flex-start', borderColor: highlight ? '#a5f3fc' : undefined, background: highlight ? 'linear-gradient(135deg,#ecfeff,#ffffff)' : undefined }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', flex: 'none', background: `${tone}14` }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{text}</div>
        {stat && <div className="mono" style={{ fontSize: 12, marginTop: 8, color: tone, fontWeight: 700 }}>{stat}</div>}
      </div>
    </div>
  );
}

// Hand-drawn SVG chart: quality (% correct) per context level, stuffing vs Meko.
function QualityChart({ data, peak }) {
  const [hover, setHover] = useState(null);
  const Wd = 720, Ht = 330, L = 52, R = 24, T = 20, B = 62;
  const x = i => L + (i * (Wd - L - R)) / Math.max(1, data.length - 1);
  const y = v => T + ((100 - v) * (Ht - T - B)) / 100;
  const smooth = key => data.map((d, i) => {
    const px = x(i), py = y(d[key]);
    if (!i) return `M${px},${py}`;
    const qx = x(i - 1), qy = y(data[i - 1][key]), cx = (qx + px) / 2;
    return `C${cx},${qy} ${cx},${py} ${px},${py}`;
  }).join(' ');
  return (
    <div style={{ position: 'relative' }}>
      <div className="cq-legend">
        <span><i style={{ background: RED }} />Context stuffing <em>status quo</em></span>
        <span><i style={{ background: CY }} />Meko-engineered context</span>
      </div>
      <svg viewBox={`0 0 ${Wd} ${Ht}`} style={{ width: '100%', display: 'block' }}>
        {[0, 20, 40, 60, 80, 100].map(v => (
          <g key={v}>
            <line x1={L} x2={Wd - R} y1={y(v)} y2={y(v)} stroke="#eef1f6" />
            <text x={L - 10} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{v}</text>
          </g>
        ))}
        {data.map((d, i) => (
          <g key={d.x}>
            <text x={x(i)} y={Ht - B + 20} textAnchor="middle" fontSize="12" fontWeight="700" fill="#475569">{d.x}</text>
            <text x={x(i)} y={Ht - B + 35} textAnchor="middle" fontSize="10" fill="#94a3b8">{fmt.k(d.tokens)} tok</text>
          </g>
        ))}
        <text x={(L + Wd - R) / 2} y={Ht - 6} textAnchor="middle" fontSize="10.5" letterSpacing="0.12em" fill="#94a3b8">CONTEXT SIZE →</text>
        <text x={14} y={T + (Ht - T - B) / 2} textAnchor="middle" fontSize="10.5" fill="#94a3b8" transform={`rotate(-90 14 ${T + (Ht - T - B) / 2})`}>% CORRECT</text>
        {peak && <line x1={x(data.findIndex(d => d.x === `${peak}`))} x2={x(data.findIndex(d => d.x === `${peak}`))} y1={T} y2={Ht - B} stroke="#fda4af" strokeDasharray="4 4" />}
        <path d={smooth('stuffing')} fill="none" stroke={RED} strokeWidth="3.5" strokeLinecap="round" />
        <path d={smooth('meko')} fill="none" stroke={CY} strokeWidth="3.5" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={`p${d.x}`}>
            <circle cx={x(i)} cy={y(d.stuffing)} r="6" fill={RED} stroke="#fff" strokeWidth="2" />
            <circle cx={x(i)} cy={y(d.meko)} r="6" fill={CY} stroke="#fff" strokeWidth="2" />
            <rect x={x(i) - 24} y={T} width={48} height={Ht - T - B} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="cq-tip" style={{ left: `${(x(hover) / Wd) * 100}%` }}>
          <b>Level {data[hover].x} · {data[hover].label}</b>
          <span>{fmt.n(data[hover].tokens)} tokens stuffed</span>
          <span style={{ color: RED }}>Stuffing: {data[hover].stuffing}% correct</span>
          <span style={{ color: CY }}>Meko: {data[hover].meko}% correct</span>
        </div>
      )}
    </div>
  );
}

// Cost per answer by context level, as simple labelled bars.
function CostBars({ data }) {
  const max = Math.max(...data.map(d => d.cost), 1e-9);
  return (
    <div className="col" style={{ gap: 7 }}>
      {data.map(d => (
        <div key={d.name} className="row" style={{ gap: 10, fontSize: 12 }}>
          <span className="mono" style={{ width: 44, color: d.name === 'Meko' ? CY : '#475569', fontWeight: 700 }}>{d.name}</span>
          <div style={{ flex: 1, height: 14, borderRadius: 7, background: '#f1f4f9', overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(1.5, (d.cost / max) * 100)}%`, height: '100%', borderRadius: 7, background: d.name === 'Meko' ? CY : '#94a3b8' }} />
          </div>
          <span className="mono" style={{ width: 160, textAlign: 'right' }}>${d.cost.toFixed(4)} · {fmt.k(d.tokens)} tok · {fmt.ms(d.ms)}</span>
        </div>
      ))}
    </div>
  );
}
