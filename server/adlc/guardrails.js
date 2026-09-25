// Guardrails — deterministic policy checks run at every gate. Each returns
// { id, pass, severity, detail }. `block` failures stop the pipeline; `warn`
// failures are reported on the PR but let it continue.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gates, roster } from './specs.js';

const sev = id => gates().guardrails[id]?.severity ?? 'block';
const result = (id, pass, detail) => ({ id, pass, severity: sev(id), detail, description: gates().guardrails[id]?.description });

const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/, 'Anthropic API key'],
  [/mko_tkn_[A-Za-z0-9]{10,}/, 'Meko API key'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/postgres(ql)?:\/\/[^:\s]+:[^@\s]+@/, 'connection string with password'],
];
const INJECTION = /ignore (all|any|the)? ?(previous|prior|above) (instructions|rules)|disregard (the|your) (rules|instructions)|you are now|reveal (the|your) (system prompt|secrets?)|exfiltrat|override (the )?guardrails?/i;

const globToRe = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§').replace(/\*/g, '[^/]*').replace(/§/g, '.*') + '$');

export const checks = {
  'spec-frontmatter': ({ text, feature }) => {
    const missing = [feature.id, ...feature.exports].filter(t => !text.includes(t));
    return result('spec-frontmatter', !missing.length, missing.length ? `missing ${missing.join(', ')}` : `cites ${feature.id} and contract ${feature.exports.join(', ')}`);
  },
  'acceptance-criteria-present': ({ text, feature }) => {
    const missing = feature.acs.map(a => a.id).filter(id => !text.includes(id));
    return result('acceptance-criteria-present', !missing.length, missing.length ? `missing ${missing.join(', ')}` : `all ${feature.acs.length} ACs traced`);
  },
  'contract-conformance': ({ text, feature }) => {
    const missing = feature.exports.filter(e => !text.includes(e));
    return result('contract-conformance', !missing.length, missing.length ? `design omits ${missing.join(', ')}` : `names ${feature.exports.join(', ')}`);
  },
  'dependency-allowlist': ({ text }) => {
    const specs = [...text.matchAll(/(?:^|\n)\s*import\s[^'"]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1] ?? m[2] ?? m[3]);
    const bad = specs.filter(s => !s.startsWith('node:') && !/(^|\/)reference\/fleet\.js$/.test(s));
    return result('dependency-allowlist', !bad.length, bad.length ? `disallowed imports: ${[...new Set(bad)].join(', ')}` : `${specs.length} import(s), all allowed`);
  },
  'path-scope': ({ files, agent }) => {
    const res = agent.scope.map(globToRe);
    const out = files.filter(f => !res.some(r => r.test(f)));
    return result('path-scope', !out.length, out.length ? `outside ${agent.name}'s scope: ${out.join(', ')}` : `${files.length} file(s) inside ${agent.scope.join(', ')}`);
  },
  'secret-scan': ({ text }) => {
    const hits = SECRET_PATTERNS.filter(([re]) => re.test(text)).map(([, n]) => n);
    return result('secret-scan', !hits.length, hits.length ? `found ${hits.join(', ')}` : 'no secrets found');
  },
  'syntax-check': ({ text }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'adlc-syntax-'));
    const f = path.join(dir, 'module.mjs');
    writeFileSync(f, text);
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); return result('syntax-check', true, 'parses as an ES module'); }
    catch (e) { return result('syntax-check', false, String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 3).join(' · ')); }
  },
  'no-dynamic-exec': ({ text }) => {
    const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = [[/\beval\s*\(/, 'eval'], [/new\s+Function\s*\(/, 'new Function'], [/child_process/, 'child_process'], [/\bfetch\s*\(/, 'fetch'], [/node:(http|https|net|dgram|fs)\b/, 'I/O module'], [/process\.env/, 'process.env']].filter(([re]) => re.test(code)).map(([, n]) => n);
    return result('no-dynamic-exec', !hits.length, hits.length ? `uses ${hits.join(', ')}` : 'pure module — no exec, I/O or env access');
  },
  'plaintext-transport': ({ text }) => {
    const hits = [[/\bmqtt:\/\//i, 'mqtt://'], [/\bws:\/\//i, 'ws://'], [/\bhttp:\/\/(?!localhost|127\.0\.0\.1)[\w.-]+/i, 'plaintext http://'], [/rejectUnauthorized\s*:\s*false/, 'rejectUnauthorized:false'], [/\btls\s*:\s*false/, 'tls:false'], [/\binsecure\s*:\s*true/, 'insecure:true'], [/NODE_TLS_REJECT_UNAUTHORIZED/, 'TLS verification override']].filter(([re]) => re.test(text)).map(([, n]) => n);
    return result('plaintext-transport', !hits.length, hits.length ? `insecure transport: ${hits.join(', ')}` : 'no plaintext or unverified transport');
  },
  'ot-write-prohibited': ({ text }) => {
    const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = [[/write(Single|Multiple)?(Register|Coil)s?\s*\(/i, 'Modbus write'], [/\.write\s*\(\s*\{?\s*nodeId/i, 'OPC-UA write'], [/\bset(point|Point)\s*\(|\bsetpoint\s*=/, 'setpoint change']].filter(([re]) => re.test(code)).map(([, n]) => n);
    return result('ot-write-prohibited', !hits.length, hits.length ? `OT write path: ${hits.join(', ')}` : 'read-only towards OT');
  },
  'tests-immutable': ({ files, agent }) => {
    const touched = files.filter(f => /\.acceptance\.test\.js$/.test(f));
    return result('tests-immutable', agent.id === 'quill' || !touched.length, touched.length ? `${agent.name} touched ${touched.join(', ')}` : 'acceptance tests untouched');
  },
  'prompt-injection': ({ memories }) => {
    const bad = memories.filter(m => INJECTION.test(m.memory ?? m.text ?? ''));
    return result('prompt-injection', !bad.length, bad.length ? `${bad.length} recalled memor${bad.length > 1 ? 'ies' : 'y'} quarantined` : `${memories.length} recalled memories screened clean`);
  },
  'memory-provenance': ({ memories }) => {
    const ok = new Set(['adlc:org', ...roster().agents.map(a => `adlc:${a.id}`)]);
    const bad = memories.filter(m => m.agent_id && !ok.has(m.agent_id));
    return result('memory-provenance', !bad.length, bad.length ? `untrusted writers: ${[...new Set(bad.map(m => m.agent_id))].join(', ')}` : `${memories.length} memories from trusted agents`);
  },
  'token-budget': ({ tokens, agent }) => result('token-budget', tokens <= agent.tokenBudget, `${tokens.toLocaleString()} input tokens vs budget ${agent.tokenBudget.toLocaleString()}`),
  'all-checks-green': ({ statuses }) => {
    const bad = statuses.filter(s => s.context.startsWith('adlc/') && s.context !== 'adlc/release' && s.state !== 'success');
    return result('all-checks-green', !bad.length && statuses.length > 0, bad.length ? `not green: ${bad.map(s => `${s.context}=${s.state}`).join(', ')}` : `${statuses.filter(s => s.context.startsWith('adlc/')).length} adlc statuses green`);
  },
  'human-approval': ({ approval }) => result('human-approval', !!approval, approval ? `approved by ${approval.by}${approval.note ? ` — “${approval.note}”` : ''}` : 'awaiting approval'),
};

export function run(ids, ctx) {
  return ids.filter(id => checks[id]).map(id => {
    try { return checks[id](ctx); } catch (e) { return result(id, false, `check errored: ${e.message}`); }
  });
}

export function screenMemories(memories) {
  const clean = [], quarantined = [];
  for (const m of memories) (INJECTION.test(m.memory ?? '') ? quarantined : clean).push(m);
  return { clean, quarantined };
}

export const blocking = results => results.filter(r => !r.pass && r.severity === 'block');
