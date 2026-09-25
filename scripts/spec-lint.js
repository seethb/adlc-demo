// Spec lint (CI): every feature spec has the required frontmatter, at least one
// AC, a matching acceptance suite that cites every AC, and an owner in the roster.
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const roster = JSON.parse(readFileSync('specs/agents/roster.json', 'utf8'));
let errors = 0;
const fail = m => { console.error(`✖ ${m}`); errors++; };

for (const file of readdirSync('specs/features').filter(f => f.endsWith('.spec.md'))) {
  const md = readFileSync(`specs/features/${file}`, 'utf8');
  const fm = Object.fromEntries((md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '').split('\n').map(l => [l.split(':')[0].trim(), l.slice(l.indexOf(':') + 1).trim()]));
  for (const k of ['id', 'slug', 'title', 'owner', 'module', 'reference', 'exports']) if (!fm[k]) fail(`${file}: missing frontmatter "${k}"`);
  if (!roster.agents.some(a => a.id === fm.owner)) fail(`${file}: owner "${fm.owner}" is not in the roster`);
  const acs = [...md.matchAll(/\*\*(AC-F\d\d-\d+)\*\*/g)].map(m => m[1]);
  if (!acs.length) fail(`${file}: no acceptance criteria`);
  const test = `specs/features/${fm.slug}.acceptance.test.js`;
  if (!existsSync(test)) { fail(`${file}: missing ${test}`); continue; }
  const t = readFileSync(test, 'utf8');
  for (const ac of acs) if (!t.includes(ac)) fail(`${file}: ${ac} has no acceptance test`);
  console.log(`✔ ${fm.id} ${fm.title} — ${acs.length} ACs traced to ${test}`);
}
process.exit(errors ? 1 : 0);
