import React, { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { Activity, Wrench, ClipboardCheck, Package, ShieldAlert, Zap, RotateCcw, CheckCircle2, Truck, Rocket, AlertTriangle, Bug } from 'lucide-react';
import { Card, Stat, Badge, Sparkline, Drawer, Empty } from '../components/ui.jsx';
import { post, fmt } from '../api.js';
import { agentOf } from '../lib.js';

const zone = v => (v <= 2.8 ? ['A', 'green'] : v <= 4.5 ? ['B', 'blue'] : v <= 7.1 ? ['C', 'amber'] : ['D', 'red']);
const sevTone = { low: 'blue', medium: 'amber', high: 'red', critical: 'red' };
const prioTone = { P1: 'red', P2: 'amber', P3: 'blue' };
const hColor = h => (h > 80 ? '#22c55e' : h > 50 ? '#f59e0b' : '#f43f5e');
const FEATURE_LABEL = { F01: 'Telemetry', F02: 'Anomaly detection', F03: 'Work orders', F04: 'CARs', F05: 'Inventory', F06: 'NL queries' };

export default function EdgeOps({ s }) {
  const [sel, setSel] = useState(null);
  const ed = s.edge;
  if (!ed?.assets) return <Empty icon={<Activity />}>Starting the edge runtime…</Empty>;
  const openWos = ed.workOrders.filter(w => w.status !== 'closed');
  const low = ed.inventory.filter(i => i.low);
  const deployments = s.deployments ?? {};

  return (
    <>
      <Card title="What the agents have shipped" hint="features deployed to edge-staging through the ADLC pipeline — the rest run the reference build as a preview">
        <div className="grid g3" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 10 }}>
          {s.features.map(f => {
            const d = deployments[f.id];
            const a = agentOf(s, f.owner);
            return (
              <div key={f.id} className="card" style={{ padding: 12, borderColor: d ? 'rgba(232,121,249,0.45)' : 'var(--line)' }}>
                <div className="row between"><span className="mono dim" style={{ fontSize: 11 }}>{f.id}</span>{d ? <Badge tone="pink"><Rocket size={10} />live</Badge> : <Badge tone="gray">preview</Badge>}</div>
                <div style={{ fontWeight: 700, fontSize: 13, margin: '6px 0 4px' }}>{FEATURE_LABEL[f.id]}</div>
                <div className="dim" style={{ fontSize: 11 }}>{d ? <a href={d.prUrl} target="_blank" rel="noreferrer">by {a?.name} · PR #{d.pr} · {d.sha.slice(0, 7)}</a> : `owner ${a?.name}`}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid g5">
        <Stat label="Fleet health" icon={<Activity size={14} color="#16a34a" />} value={`${Math.round(ed.assets.reduce((n, a) => n + a.health, 0) / ed.assets.length)}`} foot={`${ed.assets.filter(a => a.health < 70).length} assets degraded · tick ${ed.tick}`} spark={ed.assets[0]?.history?.map(h => h.vibration)} sparkColor="#22c55e" />
        <Stat label="Anomalies" icon={<Zap size={14} color="#d97706" />} value={ed.anomalies.length} foot={`${ed.anomalies.filter(a => a.severity === 'critical').length} critical in window`} />
        <Stat label="Open work orders" icon={<Wrench size={14} color="#ea580c" />} value={openWos.length} foot={`${openWos.filter(w => w.priority === 'P1').length} P1 · ${openWos.filter(w => w.status === 'waiting_parts').length} waiting parts`} />
        <Stat label="Corrective actions" icon={<ClipboardCheck size={14} color="#c026d3" />} value={ed.cars.length} foot="8D reports opened" />
        <Stat label="Rejected telemetry" icon={<ShieldAlert size={14} color="#e11d48" />} value={ed.security?.rejectedReadings ?? 0} foot="tampered or invalid readings blocked" />
      </div>

      <Card title="Fleet" hint="live at 1 Hz — click an asset to inspect, inject a fault or send a tampered reading" right={<button className="btn sm" onClick={() => post('/edge/reset', {})}><RotateCcw size={13} />Reset plant</button>}>
        <div className="grid g4">
          {ed.assets.map(a => {
            const [z, zt] = zone(a.metrics.vibration ?? 0);
            return (
              <div key={a.id} className={`asset ${a.health < 50 ? 'crit' : a.health < 80 ? 'warn' : ''}`} onClick={() => setSel(a.id)}>
                <div className="row between"><div><div style={{ fontWeight: 750 }}>{a.id}</div><div className="dim" style={{ fontSize: 11.5 }}>{a.name}</div></div><div className="hp" style={{ color: hColor(a.health) }}>{a.health}</div></div>
                <div className="gauge"><span style={{ width: `${a.health}%`, background: hColor(a.health) }} /></div>
                <Sparkline data={a.history?.map(h => h.vibration)} width={260} height={38} color={hColor(a.health)} fill />
                <div className="row wrap" style={{ gap: 5 }}>
                  <Badge tone={zt}>ISO {z} · {a.metrics.vibration} mm/s</Badge>
                  <Badge tone="gray">{a.typeLabel}</Badge>
                  {a.fault && <Badge tone="red"><Bug size={10} />{a.fault.replace(/_/g, ' ')}</Badge>}
                  {a.openAnomaly && <Badge tone={sevTone[a.openAnomaly.severity]}>{a.openAnomaly.severity} · {a.openAnomaly.failureMode.replace(/_/g, ' ')}</Badge>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid g-3-2">
        <Card title="Work orders" hint="raised by F03 from anomalies — de-duplicated, prioritised, parts reserved" icon={<Wrench size={16} color="#ea580c" />}>
          <div style={{ maxHeight: 380, overflow: 'auto' }}>
            <table className="t">
              <thead><tr><th>WO</th><th>Asset · failure mode</th><th>Priority</th><th>Parts</th><th className="num">Seen</th><th>Status</th><th /></tr></thead>
              <tbody>
                {ed.workOrders.map(w => (
                  <tr key={w.id}>
                    <td className="mono">{w.id}</td>
                    <td><b>{w.assetId}</b> <span className="muted">{w.failureMode.replace(/_/g, ' ')}</span></td>
                    <td><Badge tone={prioTone[w.priority]}>{w.priority} · {w.slaHours}h</Badge></td>
                    <td className="mono" style={{ fontSize: 11 }}>{w.parts.map(p => `${p.sku}×${p.qty}${p.shortfall ? ' ⚠' : ''}`).join(', ') || '—'}</td>
                    <td className="num mono">{w.occurrences}</td>
                    <td><Badge tone={w.status === 'closed' ? 'gray' : w.status === 'waiting_parts' ? 'amber' : 'green'}>{w.status.replace('_', ' ')}</Badge></td>
                    <td>{w.status !== 'closed' && <button className="btn sm" onClick={() => post(`/edge/wo/${w.id}/close`, {})}><CheckCircle2 size={12} />Close</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!ed.workOrders.length && <Empty icon={<Wrench />}>No work orders — inject a fault on an asset.</Empty>}
          </div>
        </Card>
        <Card title="Anomaly stream" hint="F02 · baseline z-score + ISO 10816 + OEM limits" icon={<Zap size={16} color="#d97706" />}>
          <div className="feed" style={{ maxHeight: 380 }}>
            {ed.anomalies.slice(0, 40).map(a => (
              <div className="feed-item" key={a.id}>
                <Badge tone={sevTone[a.severity]}>{a.severity}</Badge>
                <div className="main-t"><b>{a.assetId}</b> {a.failureMode.replace(/_/g, ' ')} <span className="dim">· {a.rule} · {a.metrics.map(m => `${m.metric} ${m.value}`).join(', ')}</span></div>
                <span className="t">{a.ts.slice(11, 19)}</span>
              </div>
            ))}
            {!ed.anomalies.length && <Empty>All quiet.</Empty>}
          </div>
        </Card>
      </div>

      <div className="grid g3">
        <Card title="Corrective Action Reports" hint="F04 · 8D" icon={<ClipboardCheck size={16} color="#c026d3" />}>
          <div className="col" style={{ maxHeight: 420, overflow: 'auto' }}>
            {ed.cars.map(c => (
              <div key={c.id} className="mem">
                <div className="row"><b className="mono">{c.id}</b><Badge tone={c.trigger === 'critical-failure' ? 'red' : 'amber'}>{c.trigger}</Badge><span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>{c.workOrders.join(', ')}</span></div>
                <div><b>D2</b> {c.d2_problem}</div>
                <div className="muted"><b>D3</b> {c.d3_containment}</div>
                <div className="muted"><b>D4</b> {c.d4_rootCause}</div>
                <div className="muted"><b>D7</b> {c.d7_preventive}</div>
              </div>
            ))}
            {!ed.cars.length && <Empty>No CARs — a P1 or a recurring failure opens one.</Empty>}
          </div>
        </Card>
        <Card title="Spare parts" hint="F05 · reservations and reorder" icon={<Package size={16} color="#2563eb" />}>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            <table className="t">
              <thead><tr><th>SKU</th><th className="num">On hand</th><th className="num">Reserved</th><th className="num">Avail</th></tr></thead>
              <tbody>{ed.inventory.map(i => <tr key={i.sku}><td><div className="mono" style={{ fontSize: 11.5 }}>{i.sku}</div><div className="dim" style={{ fontSize: 11 }}>{i.name}</div></td><td className="num mono">{i.onHand}</td><td className="num mono">{i.reserved}</td><td className="num"><Badge tone={i.low ? 'red' : 'green'}>{i.available}</Badge></td></tr>)}</tbody>
            </table>
          </div>
        </Card>
        <Card title="Purchase requisitions & security" icon={<Truck size={16} color="#0891b2" />}>
          <div className="col">
            {ed.requisitions.map(r => (
              <div key={r.id} className="row" style={{ fontSize: 12.5 }}><span className="mono">{r.id}</span><span>{r.sku} × {r.qty}</span><span className="dim">ETA {r.etaDays}d</span><span style={{ marginLeft: 'auto' }}>{r.status === 'open' ? <button className="btn sm" onClick={() => post(`/edge/req/${r.id}/receive`, {})}>Receive</button> : <Badge tone="green">received</Badge>}</span></div>
            ))}
            {!ed.requisitions.length && <span className="dim" style={{ fontSize: 12.5 }}>No requisitions — stock above reorder points ({low.length} low).</span>}
            <div className="divider" />
            <div className="row"><ShieldAlert size={15} color="#e11d48" /><b style={{ fontSize: 13 }}>Telemetry security</b></div>
            {(ed.security?.events ?? []).slice(0, 6).map((e, i) => <div key={i} className="dim" style={{ fontSize: 12 }}>{e.at.slice(11, 19)} · {e.text}</div>)}
            {!ed.security?.events?.length && <span className="dim" style={{ fontSize: 12 }}>No tampered readings yet — try “Send tampered reading” on an asset.</span>}
          </div>
        </Card>
      </div>

      {sel && <AssetDrawer s={s} id={sel} onClose={() => setSel(null)} />}
    </>
  );
}

const COLORS = ['#7c3aed', '#22d3ee', '#4ade80', '#fbbf24', '#f472b6', '#60a5fa'];
const LIMITS = { vibration: [4.5, 7.1], bearingTemp: [85, 95], windingTemp: [110, 130], surgeMargin: [10, 5], suctionPressure: [0.9, 0.6], misalignment: [0.1, 0.2], particleCount: [30, 45], oilTemp: [80, 90] };

function AssetDrawer({ s, id, onClose }) {
  const [msg, setMsg] = useState(null);
  const a = s.edge.assets.find(x => x.id === id);
  if (!a) return null;
  const faults = Object.entries(s.edge.catalog?.faults ?? {}).filter(([, f]) => f.appliesTo.includes(a.type));
  const act = async (path, body, text) => { try { await post(path, body); setMsg({ ok: true, text }); } catch (e) { setMsg({ ok: false, text: e.message }); } };
  const metrics = Object.keys(a.metrics);
  return (
    <Drawer open onClose={onClose} title={`${a.id} · ${a.name}`} subtitle={`${a.typeLabel} · ${a.line} · criticality ${a.criticality}`} icon={<div className="hp" style={{ fontSize: 30, fontWeight: 800, color: hColor(a.health) }}>{a.health}</div>}>
      <Card title="Inject a fault" hint="the simulator degrades the signature metrics; watch detection → WO → CAR" icon={<Bug size={16} color="#e11d48" />}>
        <div className="row wrap">
          {faults.map(([k, f]) => <button key={k} className="btn sm" onClick={() => act('/edge/inject', { assetId: a.id, fault: k }, `${f.label} injected on ${a.id}`)}><Zap size={12} />{f.label}</button>)}
          <button className="btn sm" onClick={() => act('/edge/clear', { assetId: a.id }, `Fault cleared on ${a.id}`)}><RotateCcw size={12} />Clear</button>
          <button className="btn sm danger" onClick={() => act('/edge/tamper', { assetId: a.id }, 'Tampered reading sent — it should be rejected, with no anomaly and no WO')}><ShieldAlert size={12} />Send tampered reading</button>
        </div>
        {msg && <div className={`badge ${msg.ok ? 'b-green' : 'b-red'}`} style={{ marginTop: 10, whiteSpace: 'normal', padding: '6px 10px' }}>{msg.text}</div>}
        {a.fault && <div className="row" style={{ marginTop: 10 }}><AlertTriangle size={14} color="#d97706" /><span>Active fault: <b>{a.fault.replace(/_/g, ' ')}</b> for {a.faultTicks} s</span></div>}
      </Card>
      <div className="grid g2">
        {metrics.map((m, i) => (
          <Card key={m} title={s.edge.catalog?.metrics?.[m]?.label ?? m} hint={`${a.metrics[m]} ${s.edge.catalog?.metrics?.[m]?.unit ?? ''}`}>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={a.history}>
                <CartesianGrid stroke="rgba(15,23,42,0.06)" vertical={false} />
                <XAxis dataKey="ts" hide />
                <YAxis domain={['auto', 'auto']} stroke="#94a3b8" fontSize={10} width={44} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid rgba(15,23,42,0.12)', boxShadow: '0 8px 24px rgba(15,23,42,0.1)', borderRadius: 10, fontSize: 12 }} labelFormatter={v => String(v).slice(11, 19)} />
                {LIMITS[m] && <ReferenceLine y={LIMITS[m][0]} stroke="#f59e0b" strokeDasharray="4 4" />}
                {LIMITS[m] && <ReferenceLine y={LIMITS[m][1]} stroke="#f43f5e" strokeDasharray="4 4" />}
                <Line type="monotone" dataKey={m} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        ))}
      </div>
    </Drawer>
  );
}
