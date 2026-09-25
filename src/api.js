// API helpers and the live store: one bootstrap fetch, then every change
// arrives over Server-Sent Events and is folded into state.
import { useEffect, useReducer, useRef } from 'react';

export async function api(path, opts = {}) {
  const r = await fetch(`/api${path}`, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}
export const post = (path, body) => api(path, { method: 'POST', body });

const initial = { ready: false, connected: false, runs: [], edge: null, llm: {}, toasts: [], sprint: null };

function reducer(s, a) {
  switch (a.type) {
    case 'bootstrap': return { ...s, ...a.data, runs: a.data.runs, ready: true };
    case 'connected': return { ...s, connected: a.value };
    case 'run': {
      const runs = s.runs.some(r => r.id === a.data.id) ? s.runs.map(r => (r.id === a.data.id ? a.data : r)) : [a.data, ...s.runs];
      return { ...s, runs };
    }
    case 'meko': return { ...s, meko: { ...s.meko, wire: [a.data, ...(s.meko?.wire ?? [])].slice(0, 150), stats: { ...(s.meko?.stats ?? {}), calls: (s.meko?.stats?.calls ?? 0) + 1 } } };
    case 'memory': return { ...s, meko: { ...s.meko, memories: [a.data, ...(s.meko?.memories ?? [])].slice(0, 500) } };
    case 'github': return { ...s, github: { ...s.github, activity: [a.data, ...(s.github?.activity ?? [])].slice(0, 200) } };
    case 'github-snapshot': return { ...s, github: { ...s.github, snapshot: a.data } };
    case 'economics': return { ...s, economics: a.data };
    case 'edge': return { ...s, edge: { ...(s.edge ?? {}), ...a.data } };
    case 'edge-full': return { ...s, edge: a.data };
    case 'llm': return { ...s, llm: { ...s.llm, [a.data.agent]: a.data } };
    case 'deployments': return { ...s, deployments: a.data };
    case 'settings': return { ...s, settings: a.data };
    case 'sprint': return { ...s, sprint: a.data };
    case 'privacy': return { ...s, privacy: a.data.stats };
    case 'toast': return { ...s, toasts: [...s.toasts, { id: Math.random(), ...a.data }].slice(-5) };
    case 'untoast': return { ...s, toasts: s.toasts.filter(t => t.id !== a.id) };
    default: return s;
  }
}

export function useLive() {
  const [state, dispatch] = useReducer(reducer, initial);
  const econTimer = useRef(null);

  useEffect(() => {
    let es, closed = false;
    const boot = () => api('/bootstrap').then(d => dispatch({ type: 'bootstrap', data: d })).catch(() => setTimeout(boot, 2000));
    boot();
    api('/edge').then(d => dispatch({ type: 'edge-full', data: d })).catch(() => {});
    const refreshEcon = () => { clearTimeout(econTimer.current); econTimer.current = setTimeout(() => api('/economics').then(d => dispatch({ type: 'economics', data: d })), 400); };
    const toast = data => { dispatch({ type: 'toast', data }); };

    const connect = () => {
      es = new EventSource('/api/stream');
      es.onopen = () => dispatch({ type: 'connected', value: true });
      es.onerror = () => dispatch({ type: 'connected', value: false });
      const on = (type, fn) => es.addEventListener(type, e => fn(JSON.parse(e.data)));
      on('run', d => dispatch({ type: 'run', data: d }));
      on('meko', d => dispatch({ type: 'meko', data: d }));
      on('memory', d => { dispatch({ type: 'memory', data: d }); });
      on('github', d => { dispatch({ type: 'github', data: d }); if (['pr', 'merge', 'deploy'].includes(d.kind)) toast({ kind: 'github', title: d.title, url: d.url }); });
      on('github-snapshot', d => dispatch({ type: 'github-snapshot', data: d }));
      on('ledger', () => refreshEcon());
      on('edge', d => dispatch({ type: 'edge', data: d }));
      on('edge-event', d => { if (['car', 'security'].includes(d.kind)) toast({ kind: d.kind, title: d.text }); });
      on('llm', d => dispatch({ type: 'llm', data: d }));
      on('deployments', d => dispatch({ type: 'deployments', data: d }));
      on('settings', d => dispatch({ type: 'settings', data: d }));
      on('sprint', d => dispatch({ type: 'sprint', data: d }));
      on('privacy', d => dispatch({ type: 'privacy', data: d }));
    };
    connect();
    return () => { closed = true; es?.close(); };
  }, []);

  return [state, dispatch];
}

export const fmt = {
  n: v => (v ?? 0).toLocaleString(),
  k: v => (Math.abs(v ?? 0) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v ?? 0) >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : `${Math.round(v ?? 0)}`),
  usd: v => `$${(v ?? 0) < 1 ? (v ?? 0).toFixed(4) : (v ?? 0).toFixed(2)}`,
  pct: v => `${Math.round((v ?? 0) * 100)}%`,
  ago: t => { const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000); return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; },
  ms: v => (v >= 60000 ? `${(v / 60000).toFixed(1)}m` : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`),
};
