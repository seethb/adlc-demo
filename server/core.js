// Shared plumbing: env, paths, persisted state, and the event bus the UI
// subscribes to over SSE.
import 'dotenv/config';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATE_DIR = path.join(ROOT, '.adlc');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

export const env = (k, fallback) => {
  const v = process.env[k];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`${k} is not set in .env`);
  }
  return v;
};

export const bus = new EventEmitter();
bus.setMaxListeners(100);
export const emit = (type, data) => bus.emit('event', { type, data, at: Date.now() });

mkdirSync(STATE_DIR, { recursive: true });
function load() {
  try { return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
export const state = load();
let saveTimer = null;
// Atomic write (temp file + rename) so a concurrent reader never sees a half-written file.
const flush = () => {
  clearTimeout(saveTimer); saveTimer = null;
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_FILE);
};
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 200);
}
// Scripts often process.exit() right after a write; never lose the last save.
process.on('exit', () => { if (saveTimer) flush(); });
export function setState(patch) { Object.assign(state, patch); save(); }

export const readJson = rel => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
export const readText = rel => readFileSync(path.join(ROOT, rel), 'utf8');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
