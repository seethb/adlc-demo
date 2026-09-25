import React, { useEffect, useState } from 'react';
import { Lock, ShieldCheck, FlaskConical, Eye, Cpu, Brain, Github, Sparkles, KeyRound, Network } from 'lucide-react';
import { Card, Stat, Badge, Markdown, Empty } from '../components/ui.jsx';
import { api, post, fmt } from '../api.js';

const SAMPLE = 'Technician: Jane Doe (jane.doe@example.com, +1 555 010 0199) replaced BRG-6309 on PMP-201 after WO-1004. Gateway 192.0.2.19 reported vibration 7.4 mm/s.';

export default function Trust({ s }) {
  const [text, setText] = useState(SAMPLE);
  const [out, setOut] = useState(null);
  const [security, setSecurity] = useState('');
  useEffect(() => { api('/docs').then(d => setSecurity(d.find(x => x.path.endsWith('security.md'))?.text ?? '')); }, []);
  const p = s.privacy ?? { byDest: {}, byType: {}, recent: [] };

  // How often each guardrail passed or failed across all recorded gates.
  const tally = {};
  for (const r of s.runs) for (const st of Object.values(r.stages)) for (const g of st.gate?.guardrails ?? []) {
    tally[g.id] ??= { pass: 0, fail: 0 };
    tally[g.id][g.pass ? 'pass' : 'fail']++;
  }
  const appliesTo = id => s.roster.agents.filter(a => a.guardrails.includes(id));
  const sections = security.split(/\n(?=## )/);
  const classification = sections.filter(x => /^## (1|2|3|4)\./.test(x)).join('\n');

  return (
    <>
      <div className="grid g4">
        <Stat label="Outbound payloads scanned" icon={<Eye size={14} color="#7c3aed" />} value={fmt.n(p.scanned)} foot="every prompt, MCP call and GitHub body" />
        <Stat label="PII redactions" icon={<Lock size={14} color="#c026d3" />} value={fmt.n(p.redactions)} foot={Object.entries(p.byType).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none needed so far'} />
        <Stat label="By destination" icon={<Network size={14} color="#0891b2" />} value={<span style={{ fontSize: 16 }}><Cpu size={13} /> {p.byDest.claude ?? 0} · <Brain size={13} /> {p.byDest.meko ?? 0} · <Github size={13} /> {p.byDest.github ?? 0}</span>} foot="Claude · Meko · GitHub" />
        <Stat label="Guardrail checks run" icon={<ShieldCheck size={14} color="#16a34a" />} value={fmt.n(Object.values(tally).reduce((n, t) => n + t.pass + t.fail, 0))} foot={`${Object.values(tally).reduce((n, t) => n + t.fail, 0)} blocked or warned`} />
      </div>

      <div className="grid g2">
        <Card title="Try the privacy shield" hint="runs locally — nothing here is sent to Claude, Meko or GitHub" icon={<Sparkles size={16} color="#c026d3" />} glow>
          <textarea className="input" rows={4} value={text} onChange={e => setText(e.target.value)} />
          <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={async () => setOut(await post('/privacy/test', { text }))}><Lock size={14} />Redact</button>{out && <div className="row wrap" style={{ gap: 5 }}>{out.types.map(t => <Badge key={t} tone="pink">{t}</Badge>)}</div>}</div>
          {out && <pre className="code" style={{ marginTop: 12 }}>{out.redacted}</pre>}
          <div className="dim" style={{ fontSize: 11.5, marginTop: 10 }}>Asset ids, work orders, telemetry and timestamps pass through untouched. People, contact details, government and financial ids, addresses, IPs, health and salary data are removed. Values are never logged — only the type.</div>
        </Card>
        <Card title="Recent redactions" hint="type and destination only" icon={<Lock size={16} />}>
          <div className="feed" style={{ maxHeight: 300 }}>
            {p.recent.map((e, i) => <div key={i} className="feed-item"><Badge tone={{ claude: 'amber', meko: 'violet', github: 'gray', preview: 'cyan', internal: 'blue' }[e.dest] ?? 'gray'}>{e.dest}</Badge><div className="main-t">{e.types.join(', ')} × {e.count}</div><span className="t">{fmt.time(e.at)}</span></div>)}
            {!p.recent.length && <Empty icon={<Lock />}>Nothing personal has tried to leave the Studio.</Empty>}
          </div>
        </Card>
      </div>

      <Card title="Guardrails" hint="deterministic checks — block stops the pipeline; warn is reported on the PR" icon={<ShieldCheck size={16} color="#16a34a" />}>
        <table className="t">
          <thead><tr><th>Guardrail</th><th>Policy</th><th>Severity</th><th>Agents</th><th className="num">Pass / fail</th></tr></thead>
          <tbody>
            {Object.entries(s.gates.guardrails).map(([id, g]) => (
              <tr key={id}>
                <td className="mono" style={{ whiteSpace: 'nowrap' }}>{['pii-scan', 'secret-scan'].includes(id) ? <KeyRound size={12} color="#c026d3" /> : null} {id}</td>
                <td className="muted" style={{ fontSize: 12.5 }}>{g.description}</td>
                <td><Badge tone={g.severity === 'block' ? 'red' : 'amber'}>{g.severity}</Badge></td>
                <td style={{ fontSize: 12 }}>{appliesTo(id).map(a => a.name).join(', ') || <span className="dim">gate-level</span>}</td>
                <td className="num mono">{tally[id] ? <><span style={{ color: '#16a34a' }}>{tally[id].pass}</span> / <span style={{ color: tally[id].fail ? '#e11d48' : 'inherit' }}>{tally[id].fail}</span></> : <span className="dim">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid g-1-2">
        <Card title="Evals" icon={<FlaskConical size={16} color="#65a30d" />}>
          <table className="t"><tbody>{Object.entries(s.gates.evals).map(([id, e]) => <tr key={id}><td className="mono">{id}</td><td>≥ {e.threshold}</td><td className="muted" style={{ fontSize: 12.5 }}>{e.description}</td></tr>)}</tbody></table>
        </Card>
        <Card title="Data classification & transport security" hint="specs/02-design/security.md — also in Meko for every agent" icon={<Network size={16} color="#0891b2" />}>
          {classification ? <Markdown text={classification} /> : <Empty>Loading…</Empty>}
        </Card>
      </div>
    </>
  );
}
