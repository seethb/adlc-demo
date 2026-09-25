// Resolves which implementations an acceptance suite runs against:
// the reference build, plus the agent-built module under edge/features/ once
// an agent has shipped it. ADLC_IMPL=<path> pins a single candidate (used by
// the Test agent to gate a module before it is committed).
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function implementations(featureDir, referenceFile) {
  if (process.env.ADLC_IMPL) {
    return [{ name: `candidate ${path.relative(root, process.env.ADLC_IMPL)}`, mod: await import(pathToFileURL(path.resolve(process.env.ADLC_IMPL)).href) }];
  }
  const out = [{ name: 'reference', mod: await import(pathToFileURL(path.join(root, 'edge/reference', referenceFile)).href) }];
  const agentBuilt = path.join(root, 'edge/features', featureDir, 'index.js');
  if (existsSync(agentBuilt)) out.push({ name: `agent-built ${featureDir}`, mod: await import(pathToFileURL(agentBuilt).href) });
  return out;
}
