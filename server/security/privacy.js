// Privacy shield — no PII or private data leaves this process.
// Every outbound payload to Claude, Meko and GitHub passes through here
// (see live/claude.js, live/meko.js, live/github.js). Prose is redacted in
// place; code that contains PII is blocked by the `pii-scan` guardrail
// instead of being silently rewritten. Findings are recorded by type and
// destination only — the matched values themselves are never stored or logged.
import { execSync } from 'node:child_process';
import { emit } from '../core.js';

// Luhn check so ordinary long numbers are not treated as card numbers.
function luhn(num) {
  const d = num.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

const PATTERNS = [
  ['EMAIL', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, m => !/@agents\.adlc\.dev$|@users\.noreply\.github\.com$|@anthropic\.com$/i.test(m)],
  ['PHONE', /(?<![\w.])(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?|\d{2,4}[\s-])\d{3,4}[\s-]\d{3,4}(?![\w.])/g],
  ['PHONE', /(?<![\w.])\+\d{1,3}[\s-]?\d(?:[\s-]?\d){7,12}(?![\w.])/g],
  ['PHONE', /(?<![\w.+])[6-9]\d{9}(?![\w.])/g],
  ['PERSON', /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g],
  ['PERSON', /\b(?:employee|operator|technician|engineer|contact|customer|person|user|approver|reporter|assignee)(?:\s+name)?\s*[:=]\s*["']?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g],
  ['CARD', /\b(?:\d[ -]?){13,19}\b/g, luhn],
  ['SSN', /\b\d{3}-\d{2}-\d{4}\b/g],
  ['AADHAAR', /\b[2-9]\d{3}\s\d{4}\s\d{4}\b/g],
  ['PAN', /\b[A-Z]{5}\d{4}[A-Z]\b/g],
  ['IBAN', /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g],
  ['PASSPORT', /\b[Pp]assport(?:\s+(?:[Nn]o\.?|[Nn]umber|#))?[:\s]+(?=[A-Z0-9]*\d)[A-Z0-9]{6,9}\b/g],
  ['DOB', /\b(?:dob|date of birth|born(?: on)?)[:\s]+\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/gi],
  ['IP', /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, m => !/^(127\.0\.0\.1|0\.0\.0\.0)$/.test(m)],
  ['GEO', /\b-?\d{1,2}\.\d{4,},\s*-?\d{1,3}\.\d{4,}\b/g],
  ['ADDRESS', /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Boulevard|Blvd|Drive|Dr|Court|Ct|Nagar|Marg)\b\.?/g],
  ['SALARY', /\b(?:salary|ctc|compensation)[:\s]+[$₹€£]?\s?\d[\d,.]*\s?(?:k|lpa|lakhs?|per annum)?/gi],
  ['HEALTH', /\b(?:diagnosed with|medical condition|sick leave for)\b[^.\n]{0,60}/gi],
];

// Names of real people: the git identity of this machine plus an optional
// comma-separated PII_DENYLIST (names, handles, emails) from .env.
let denylist = null;
function names() {
  if (denylist) return denylist;
  const list = new Set();
  // The repo owner's handle is the public namespace of the repo itself, not personal data.
  const owner = (process.env.GITHUB_REPO ?? '').split('/')[0].toLowerCase();
  const add = v => v && v.trim().length > 2 && v.trim().toLowerCase() !== owner && list.add(v.trim());
  try { add(execSync('git config user.name', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { /* no git identity */ }
  try { add(execSync('git config user.email', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { /* no git identity */ }
  for (const v of (process.env.PII_DENYLIST ?? '').split(',')) add(v);
  denylist = [...list].map(n => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'));
  return denylist;
}

export const stats = { scanned: 0, redactions: 0, blocked: 0, byType: {}, byDest: {}, recent: [] };

// Links to the repo, Meko or the Studio are never personal data; matches
// inside a URL (e.g. digits in a commit sha) are ignored.
const URL_RE = /\bhttps?:\/\/[^\s)"'<>\]]+/g;

export function scan(text) {
  const found = [];
  if (typeof text !== 'string' || !text) return found;
  const urls = [...text.matchAll(URL_RE)].map(m => [m.index, m.index + m[0].length]);
  const inUrl = (i, len) => urls.some(([a, b]) => i >= a && i + len <= b);
  const push = (type, m) => { if (!inUrl(m.index, m[0].length)) found.push({ type, index: m.index, length: m[0].length }); };
  for (const [type, re, ok] of PATTERNS) for (const m of text.matchAll(re)) if (!ok || ok(m[0])) push(type, m);
  for (const re of names()) for (const m of text.matchAll(re)) push('PERSON', m);
  return found;
}

export function redact(text, dest = 'internal') {
  if (typeof text !== 'string' || !text) return text;
  stats.scanned++;
  const found = scan(text);
  if (!found.length) return text;
  // Merge overlapping matches into one span so no fragment of a value survives.
  const spans = [];
  for (const f of [...found].sort((a, b) => a.index - b.index)) {
    const end = f.index + f.length, prev = spans.at(-1);
    if (prev && f.index < prev.end) { prev.end = Math.max(prev.end, end); if (f.length > prev.len) { prev.type = f.type; prev.len = f.length; } }
    else spans.push({ start: f.index, end, type: f.type, len: f.length });
  }
  let out = text;
  for (const sp of spans.reverse()) out = out.slice(0, sp.start) + `[REDACTED:${sp.type}]` + out.slice(sp.end);
  note(dest, found.map(f => f.type));
  return out;
}

// Recursively redact every string in an outbound payload.
export function redactDeep(value, dest) {
  if (typeof value === 'string') return redact(value, dest);
  if (Array.isArray(value)) return value.map(v => redactDeep(v, dest));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, dest)]));
  return value;
}

function note(dest, types) {
  stats.redactions += types.length;
  stats.byDest[dest] = (stats.byDest[dest] ?? 0) + types.length;
  for (const t of types) stats.byType[t] = (stats.byType[t] ?? 0) + 1;
  const e = { at: new Date().toISOString(), dest, types: [...new Set(types)], count: types.length };
  stats.recent.unshift(e);
  stats.recent.length = Math.min(stats.recent.length, 50);
  emit('privacy', { event: e, stats: summary() });
}

export function blocked(dest, types) {
  stats.blocked++;
  note(dest, types);
}

export const summary = () => ({ scanned: stats.scanned, redactions: stats.redactions, blocked: stats.blocked, byType: stats.byType, byDest: stats.byDest, recent: stats.recent.slice(0, 20) });
