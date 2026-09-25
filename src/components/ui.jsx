import React, { useEffect } from 'react';
import { Compass, DraftingCompass, RadioTower, Activity, Wrench, Package, MessageSquareText, FlaskConical, ShieldCheck, Rocket, X, CheckCircle2, XCircle, Loader2, Clock, PauseCircle, AlertTriangle, CircleDashed, Bot } from 'lucide-react';

const ICONS = { compass: Compass, 'drafting-compass': DraftingCompass, 'radio-tower': RadioTower, activity: Activity, wrench: Wrench, package: Package, 'message-square-text': MessageSquareText, 'flask-conical': FlaskConical, 'shield-check': ShieldCheck, rocket: Rocket };

export function AgentIcon({ agent, size = 16 }) {
  const I = ICONS[agent?.icon] ?? Bot;
  return <I size={size} />;
}

export function Avatar({ agent, size = '', busy = false }) {
  if (!agent) return <div className={`avatar ${size}`} style={{ background: '#334' }}>?</div>;
  const px = size === 'lg' ? 22 : size === 'sm' ? 12 : 16;
  return (
    <div className={`avatar ${size} ${busy ? 'busy' : ''}`} title={`${agent.name} · ${agent.role}`}
      style={{ background: `linear-gradient(135deg, ${agent.color}, ${agent.color}99)`, color: agent.color, boxShadow: `0 6px 20px ${agent.color}40` }}>
      <span style={{ color: 'white', display: 'grid' }}><AgentIcon agent={agent} size={px} /></span>
    </div>
  );
}

export const Badge = ({ tone = 'gray', children, title }) => <span className={`badge b-${tone}`} title={title}>{children}</span>;

const STATUS = {
  pending: ['gray', CircleDashed, 'pending'],
  queued: ['gray', Clock, 'queued'],
  running: ['violet', Loader2, 'running'],
  passed: ['green', CheckCircle2, 'passed'],
  deployed: ['green', Rocket, 'deployed'],
  failed: ['red', XCircle, 'failed'],
  error: ['red', AlertTriangle, 'error'],
  awaiting_approval: ['amber', PauseCircle, 'needs approval'],
  interrupted: ['amber', AlertTriangle, 'interrupted'],
  superseded: ['gray', Clock, 'superseded'],
};
export function StatusBadge({ status }) {
  const [tone, I, label] = STATUS[status] ?? ['gray', CircleDashed, status];
  return <Badge tone={tone}><I size={11} className={status === 'running' ? 'spin' : ''} />{label}</Badge>;
}
export const StatusIcon = ({ status, size = 14 }) => {
  const [tone, I] = STATUS[status] ?? ['gray', CircleDashed];
  const color = { gray: 'var(--dim)', violet: 'var(--violet)', green: 'var(--green)', red: 'var(--red)', amber: 'var(--amber)' }[tone];
  return <I size={size} color={color} className={status === 'running' ? 'spin' : ''} />;
};

export function Card({ title, hint, right, children, className = '', glow, style, icon }) {
  return (
    <div className={`card ${glow ? 'glow' : ''} ${className}`} style={style}>
      {(title || right) && (
        <div className="card-h">
          {icon}
          <h3>{title}</h3>
          {hint && <span className="hint">{hint}</span>}
          {right && <div className="right">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({ label, value, foot, icon, tone, spark, sparkColor = '#8b5cf6' }) {
  return (
    <div className="card stat">
      <div className="label">{icon}{label}</div>
      <div className={`value ${tone ?? ''}`}>{value}</div>
      {foot && <div className="foot">{foot}</div>}
      {spark?.length > 1 && <div className="spark"><Sparkline data={spark} width={140} height={46} color={sparkColor} fill /></div>}
    </div>
  );
}

export function Sparkline({ data, width = 120, height = 32, color = '#8b5cf6', fill = false, min, max }) {
  if (!data?.length) return null;
  const lo = min ?? Math.min(...data), hi = max ?? Math.max(...data);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => [(i / Math.max(1, data.length - 1)) * width, height - 3 - ((v - lo) / span) * (height - 6)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const id = `g${color.replace('#', '')}${width}`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.45" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {fill && <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Toggle({ on, onChange, label }) {
  return <span className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><span className="sw" />{label}</span>;
}

export function Tabs({ value, onChange, options }) {
  return <div className="tabs">{options.map(o => <button key={o.value ?? o} className={(o.value ?? o) === value ? 'on' : ''} onClick={() => onChange(o.value ?? o)}>{o.label ?? o}</button>)}</div>;
}

export function Drawer({ open, onClose, title, subtitle, icon, actions, children }) {
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-h">
          {icon}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 750, fontSize: 16 }}>{title}</div>
            {subtitle && <div className="dim" style={{ fontSize: 12.5 }}>{subtitle}</div>}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{actions}<button className="btn ghost sm" onClick={onClose}><X size={16} /></button></div>
        </div>
        <div className="drawer-b">{children}</div>
      </div>
    </>
  );
}

export function Modal({ open, onClose, children }) {
  if (!open) return null;
  return <><div className="scrim" onClick={onClose} /><div className="modal">{children}</div></>;
}

export function BarCompare({ baseline, meko, labelBase = 'Without Meko', labelMeko = 'With Meko', unit = 'tokens' }) {
  const max = Math.max(baseline, meko, 1);
  return (
    <div className="bar-compare">
      <div className="row between" style={{ fontSize: 12 }}><span className="muted">{labelBase}</span><span className="mono">{Math.round(baseline).toLocaleString()} {unit}</span></div>
      <div className="b base"><span style={{ width: `${(baseline / max) * 100}%` }} /></div>
      <div className="row between" style={{ fontSize: 12, marginTop: 4 }}><span style={{ color: '#c4b5fd' }}>{labelMeko}</span><span className="mono">{Math.round(meko).toLocaleString()} {unit}</span></div>
      <div className="b meko"><span style={{ width: `${(meko / max) * 100}%` }} /></div>
    </div>
  );
}

// Small, safe markdown renderer for plans, designs and answers.
export function Markdown({ text }) {
  if (!text) return null;
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>');
  const lines = text.split('\n');
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(esc(lines[i++])); i++; html.push(`<pre class="code">${buf.join('\n')}</pre>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const body = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      html.push(`<table>${body.map((r, k) => `<tr>${cells(r).map(c => (k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('')}</table>`);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { html.push(`<h${Math.min(3, h[1].length)}>${inline(h[2])}</h${Math.min(3, h[1].length)}>`); i++; continue; }
    if (/^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l)) {
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) items.push(`<li>${inline(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`);
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (l.trim()) html.push(`<p>${inline(l)}</p>`);
    i++;
  }
  return <div className="md" dangerouslySetInnerHTML={{ __html: html.join('') }} />;
}

export const Empty = ({ icon, children }) => <div className="empty">{icon}<div>{children}</div></div>;
