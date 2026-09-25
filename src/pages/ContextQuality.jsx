import React, { useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, BarChart, Bar } from 'recharts';
import { AlertTriangle, Zap, Play, Loader2, CheckCircle2, XCircle, HelpCircle, FlaskConical, Info } from 'lucide-react';
import { Card, Badge, Tabs, Empty } from '../components/ui.jsx';
import { api, post, fmt } from '../api.js';

const RED = '#e5484d', CY = '#06b6d4';
const tip = { contentStyle: { background: '#fff', border: '1px solid rgba(15,23,42,0.12)', borderRadius: 12, fontSize: 12, boxShadow: '0 8px 24px rgba(15,23,42,0.1)' } };

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
            <ResponsiveContainer width="100%" height={330}>
              <LineChart data={chart} margin={{ top: 10, right: 20, bottom: 18, left: 0 }}>
                <CartesianGrid stroke="rgba(15,23,42,0.06)" vertical={false} />
                <XAxis dataKey="x" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} label={{ value: 'CONTEXT SIZE →', position: 'insideBottom', offset: -10, fontSize: 11, fill: '#94a3b8' }} />
                <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} unit="%" />
                <Tooltip {...tip} formatter={(v, k) => [`${v}%`, k === 'stuffing' ? 'Context stuffing' : 'Meko-engineered']} labelFormatter={(x, p) => { const d = p?.[0]?.payload; return d ? `Level ${x}: ${d.label} · ${fmt.k(d.tokens)} tokens` : x; }} />
                <Legend formatter={v => (v === 'stuffing' ? 'Context stuffing (status quo)' : 'Meko-engineered context')} wrapperStyle={{ fontSize: 12 }} />
                <Line isAnimationActive={false} type="monotone" dataKey="stuffing" stroke={RED} strokeWidth={3} dot={{ r: 5, fill: RED }} />
                <Line isAnimationActive={false} type="monotone" dataKey="meko" stroke={CY} strokeWidth={3} dot={{ r: 5, fill: CY }} />
                {peak && <ReferenceLine x={`${peak.n}`} stroke="#fda4af" strokeDasharray="4 4" label={{ value: 'stuffing peaks', fontSize: 10, fill: '#e11d48', position: 'top' }} />}
              </LineChart>
            </ResponsiveContainer>
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
          {res ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={costChart}>
                <CartesianGrid stroke="rgba(15,23,42,0.06)" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `$${v.toFixed(3)}`} />
                <Tooltip {...tip} formatter={(v, k, p) => (k === 'cost' ? [`$${Number(v).toFixed(4)} · ${fmt.k(p.payload.tokens)} tokens · ${fmt.ms(p.payload.ms)}`, 'per answer'] : v)} />
                <Bar isAnimationActive={false} dataKey="cost" radius={[6, 6, 0, 0]} fill="#94a3b8" />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty>—</Empty>}
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
