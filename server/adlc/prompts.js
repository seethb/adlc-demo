// Stage prompts. Each agent returns its artifact plus the durable decisions it
// wants the rest of the team to recall from Meko.

const OUTPUT_FORMAT = `Respond with exactly two blocks and nothing else:
<artifact>
…the artifact…
</artifact>
<decisions>
["one durable, self-contained decision other agents must follow", "…"]
</decisions>
Decisions are 2–5 short sentences, each understandable without context (name the feature id and the concrete value, shape or rule). Never include secrets.`;

export const SYSTEM = {
  plan: `You are Atlas, the Product & Spec agent on a 10-agent team building an IoT edge analytics product with spec-driven development. You turn a feature spec into an implementable plan. Be concise and concrete; cite acceptance-criteria ids verbatim.\n\n${OUTPUT_FORMAT}`,
  design: `You are Vega, the Solution Architect agent. You design a pure ES module against the feature's contract, reusing decisions the team already recorded in shared memory rather than inventing new shapes. Respect the org standards and the IoT security guidance (data classification, transport, read-only towards OT).\n\n${OUTPUT_FORMAT}`,
  develop: `You are a senior Node.js engineer agent. You write one production-quality ES module (Node 20) that satisfies the contract and every acceptance criterion. Follow the org standards recalled from shared memory exactly: no npm dependencies, no I/O, no network, no process.env, no eval; import only node: built-ins or '../../reference/fleet.js'; cite AC ids in comments. Output only the module source inside <artifact> (no markdown fences).\n\n${OUTPUT_FORMAT}`,
  review: `You are Sentinel, the Security & Guardrail reviewer agent. You review a change against its spec, the org standards and the IoT security checklist (secrets, OT writes, telemetry validation, transport security, dependencies, NLQ read-only, data classification). Be strict but fair: only report real issues.\n\nRespond with JSON only: {"score": 0..1, "summary": "…", "findings": [{"severity": "low|medium|high|critical", "title": "…", "detail": "…"}], "decisions": ["durable lesson for the team", "…"]}`,
};

export function task(stage, feature, extra = {}) {
  const acs = feature.acs.map(a => `- ${a.id}: ${a.text}`).join('\n');
  switch (stage) {
    case 'plan':
      return `Write specs/features/${feature.slug}/plan.md for ${feature.id} "${feature.title}".
It must include, as markdown sections: Summary; User stories (As a … I want … so that …) each tagged with the AC ids it covers; Acceptance criteria traceability table (every AC id: ${feature.acs.map(a => a.id).join(', ')}); Contract (exports: ${feature.exports.join(', ')}); Dependencies (${feature.depends.join(', ') || 'none'}); Non-goals; Risks; Telemetry & evals; Definition of done.
Keep it under 450 words.

Acceptance criteria:
${acs}`;
    case 'design':
      return `Write specs/features/${feature.slug}/design.md for ${feature.id} "${feature.title}" — the design of ${feature.module}.
Include: Module structure (functions, internal state); Contract signatures for ${feature.exports.join(', ')} with exact data shapes; AC → design mapping table covering every AC id (${feature.acs.map(a => a.id).join(', ')}); Security & data classification (what class of data the module handles, where it may live, read-only towards OT, input validation); Reused team decisions (which recalled memories you relied on). Keep it under 550 words.`;
    case 'develop':
      return `Implement ${feature.module} for ${feature.id} "${feature.title}".
Required exports: ${feature.exports.join(', ')}. The module must pass the acceptance tests for these criteria:
${acs}
If you need the plant fleet definitions, import { FLEET, ASSET_TYPES, FAULTS } from '../../reference/fleet.js' (FLEET: [{id,name,type,line,criticality}], ASSET_TYPES: {type:{label, nominal:{metric:[mean, sigma]}}}, FAULTS: {fault:{label, appliesTo:[types], effects:{metric: perTickFraction}, jitter?:{metric: sigmaMultiplier}}}).${extra.failures ? `\n\nYour previous attempt failed these tests — fix them:\n${extra.failures}` : ''}`;
    case 'review':
      return `Review the change for ${feature.id} "${feature.title}" (${feature.module}). Acceptance criteria:\n${acs}\n\nTest report: ${extra.testSummary ?? 'n/a'}`;
    default:
      return '';
  }
}

export function parseOutput(text) {
  const art = text.match(/<artifact>\s*([\s\S]*?)\s*<\/artifact>/);
  let artifact = art ? art[1] : text;
  artifact = artifact.replace(/^```[a-z]*\n/, '').replace(/\n```\s*$/, '');
  let decisions = [];
  const dec = text.match(/<decisions>\s*([\s\S]*?)\s*<\/decisions>/);
  if (dec) { try { decisions = JSON.parse(dec[1]); } catch { decisions = dec[1].split('\n').map(s => s.replace(/^[-*\s"]+|[",\s]+$/g, '')).filter(Boolean); } }
  return { artifact: artifact.trim() + '\n', decisions: decisions.filter(d => typeof d === 'string' && d.length > 10).slice(0, 5) };
}

export function parseReview(text) {
  const m = text.match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(m[0]);
    return { score: Number(j.score) || 0, summary: j.summary ?? '', findings: Array.isArray(j.findings) ? j.findings : [], decisions: (j.decisions ?? []).filter(d => typeof d === 'string').slice(0, 4) };
  } catch { return { score: 0, summary: 'Reviewer output was not valid JSON', findings: [{ severity: 'medium', title: 'Unparseable review', detail: text.slice(0, 300) }], decisions: [] }; }
}
