import React, { useRef, useState, useEffect } from 'react';
import { Send, Sparkles, Brain, BookOpen, Lock, Gauge, Loader2 } from 'lucide-react';
import { Card, Badge, BarCompare, Markdown, Avatar } from '../components/ui.jsx';
import { post, fmt } from '../api.js';
import { agentOf } from '../lib.js';

const SUGGESTIONS = [
  'How is motor MTR-101 performing?',
  'Which centrifugal pumps have cavitation risk?',
  'Show shaft performance for the last 10 minutes',
  'Is the centrifugal compressor close to surge?',
  'Which asset has the worst vibration?',
  'List open work orders for motors',
  'What spare parts are low on stock?',
  'Any corrective action reports on PMP-202?',
];

export default function Ask({ s }) {
  const [q, setQ] = useState('');
  const [thread, setThread] = useState([]);
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [thread]);
  const sage = agentOf(s, 'sage');

  const ask = async question => {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setQ(''); setBusy(true);
    setThread(t => [...t, { me: text }]);
    try { const r = await post('/ask', { question: text }); setThread(t => [...t, { ai: r }]); }
    catch (e) { setThread(t => [...t, { error: e.message }]); }
    finally { setBusy(false); }
  };

  const last = [...thread].reverse().find(x => x.ai)?.ai;
  return (
    <div className="grid g-3-2" style={{ alignItems: 'start' }}>
      <Card glow title="Ask the fleet" hint={`Sage · ${s.claude?.model} · grounded in live edge data + Meko knowledge`} icon={<Avatar agent={sage} size="sm" />}>
        <div className="chat" style={{ minHeight: 380, maxHeight: 'calc(100vh - 330px)', overflowY: 'auto', padding: '4px 2px 12px' }}>
          {!thread.length && (
            <div className="empty" style={{ padding: '40px 10px' }}>
              <Sparkles size={28} color="#7c3aed" />
              <div style={{ fontSize: 15, color: 'var(--text)', fontWeight: 650 }}>Ask about any asset's condition in plain language</div>
              <div className="row wrap" style={{ justifyContent: 'center', gap: 8, maxWidth: 640 }}>{SUGGESTIONS.map(x => <span key={x} className="chip" onClick={() => ask(x)}>{x}</span>)}</div>
            </div>
          )}
          {thread.map((m, i) => m.me ? <div key={i} className="bubble me">{m.me}</div>
            : m.error ? <div key={i} className="bubble ai" style={{ borderColor: 'rgba(244,63,94,0.5)' }}>{m.error}</div>
            : (
              <div key={i} className="bubble ai">
                {m.ai.privacy?.redacted?.length > 0 && <div className="badge b-pink" style={{ marginBottom: 8 }}><Lock size={11} />Removed {m.ai.privacy.redacted.join(', ')} before sending to Meko or Claude</div>}
                <Markdown text={m.ai.answer} />
                <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                  <Badge tone="violet">intent · {m.ai.plan.intent}</Badge>
                  {m.ai.plan.resolvedAssets.length <= 4 && m.ai.plan.resolvedAssets.map(a => <Badge key={a} tone="cyan">{a}</Badge>)}
                  {m.ai.plan.metrics.map(x => <Badge key={x} tone="gray">{x}</Badge>)}
                  <Badge tone="green">−{Math.round((1 - m.ai.tokens.meko / Math.max(1, m.ai.tokens.baseline)) * 100)}% tokens</Badge>
                  {m.ai.ms > 0 && <span className="dim" style={{ fontSize: 11 }}>{fmt.ms(m.ai.ms)}</span>}
                </div>
              </div>
            ))}
          {busy && <div className="bubble ai row"><Loader2 size={15} className="spin" />Sage is recalling from Meko and reading live telemetry…</div>}
          <div ref={end} />
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <input className="input" placeholder="e.g. How is the main drive shaft doing?" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()} />
          <button className="btn primary" onClick={() => ask()} disabled={busy || !q.trim()}><Send size={15} />Ask</button>
        </div>
        <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}><Lock size={11} /> Read-only: chat can never close work orders, change stock or command equipment. Personal data is redacted before it leaves the Studio.</div>
      </Card>

      <div className="col" style={{ gap: 18 }}>
        <Card title="Token cost of the last answer" icon={<Gauge size={16} color="#16a34a" />}>
          {last ? <>
            <BarCompare baseline={last.tokens.baseline} meko={last.tokens.meko} labelBase="Without Meko (whole fleet dump + every knowledge doc)" labelMeko="With Meko (query-planned slice + recalled knowledge)" />
            <div className="row between" style={{ marginTop: 12, fontSize: 12.5 }}><span className="muted">Cost</span><span className="mono">{fmt.usd(last.tokens.costMeko)} <span className="dim">vs {fmt.usd(last.tokens.costBaseline)}</span></span></div>
          </> : <div className="dim">Ask a question to see the comparison.</div>}
        </Card>
        <Card title="Grounding" hint="what Sage was given" icon={<Brain size={16} color="#7c3aed" />}>
          {last ? (
            <div className="col">
              <div className="dim" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>LIVE FACTS</div>
              <pre className="code" style={{ maxHeight: 180 }}>{JSON.stringify(last.facts.assets?.slice(0, 3), null, 1)}</pre>
              <div className="dim" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>MEMORIES ({last.memories.length})</div>
              {last.memories.slice(0, 4).map((m, i) => <div key={i} className="mem"><div className="who">{m.agent}</div><div>{m.text}</div></div>)}
              <div className="dim" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>KNOWLEDGE ({last.knowledge.length})</div>
              {last.knowledge.map((k, i) => <div key={i} className="mem"><div className="who"><BookOpen size={11} />{k.doc}</div><div className="muted" style={{ fontSize: 12 }}>{k.text}…</div></div>)}
            </div>
          ) : <div className="dim">—</div>}
        </Card>
      </div>
    </div>
  );
}
