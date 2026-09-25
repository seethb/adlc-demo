// Reads the spec tree — the orchestrator is driven entirely by specs/.
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, readText, readJson } from '../core.js';

export const roster = () => readJson('specs/agents/roster.json');
export const gates = () => readJson('specs/gates/gates.json');
export const agent = id => roster().agents.find(a => a.id === id);

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (v.startsWith('[')) v = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    out[k] = v;
  }
  return out;
}

export function features() {
  const dir = path.join(ROOT, 'specs/features');
  return readdirSync(dir).filter(f => f.endsWith('.spec.md')).sort().map(file => {
    const md = readText(`specs/features/${file}`);
    const fm = frontmatter(md);
    const acs = [...md.matchAll(/\*\*(AC-F\d\d-\d+)\*\*\s*(.+)/g)].map(m => ({ id: m[1], text: m[2].trim() }));
    const testFile = `specs/features/${fm.slug}.acceptance.test.js`;
    return {
      id: fm.id, slug: fm.slug, title: fm.title, owner: fm.owner, priority: fm.priority, depends: fm.depends ?? [],
      module: fm.module, reference: fm.reference, exports: String(fm.exports ?? '').split(',').map(s => s.trim()).filter(Boolean),
      specFile: `specs/features/${file}`, testFile, spec: md, acs,
      specHash: createHash('sha256').update(md).digest('hex').slice(0, 12),
      agentBuilt: existsSync(path.join(ROOT, fm.module ?? '__none__')),
    };
  });
}

export const feature = id => features().find(f => f.id === id);
