// GitHub REST client for the live repo. Agents commit through the Git Data API
// (so each commit carries the agent as author), open one PR per feature,
// post gate reports as commit statuses and comments, and Helm merges and
// records a deployment. Every action is streamed to the UI.
import { execSync } from 'node:child_process';
import { env, emit } from '../core.js';
import { redactDeep } from '../security/privacy.js';

let token = null;
const getToken = () => {
  if (token) return token;
  token = process.env.GITHUB_TOKEN || execSync('gh auth token', { encoding: 'utf8' }).trim();
  return token;
};
export const repo = () => env('GITHUB_REPO', 'seethb/adlc-demo');
export const repoUrl = () => `https://github.com/${repo()}`;
export const activity = [];
export const rate = { remaining: null, limit: null };

export async function api(method, path, body) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path.replace('{repo}', repo())}`;
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${getToken()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'adlc-studio' },
    // Privacy shield: PR text, comments, commit messages and file contents.
    body: body ? JSON.stringify(redactDeep(body, 'github')) : undefined,
  });
  rate.remaining = Number(r.headers.get('x-ratelimit-remaining')); rate.limit = Number(r.headers.get('x-ratelimit-limit'));
  if (r.status === 204) return null;
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`GitHub ${method} ${path} → ${r.status}: ${data?.message ?? ''} ${JSON.stringify(data?.errors ?? '').slice(0, 200)}`);
  return data;
}

function log(agent, kind, title, url, extra = {}) {
  const e = { at: new Date().toISOString(), agent, kind, title, url, ...extra };
  activity.unshift(e);
  activity.length = Math.min(activity.length, 200);
  emit('github', e);
  return e;
}

export const agentAuthor = a => ({ name: `${a.name} (${a.role})`, email: `${a.id}@agents.adlc.dev` });

export async function headSha(branch) {
  return (await api('GET', `/repos/{repo}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
}

export async function createBranch(branch, from = 'main', agent) {
  const sha = await headSha(from);
  try { await api('POST', '/repos/{repo}/git/refs', { ref: `refs/heads/${branch}`, sha }); }
  catch (e) { if (!/Reference already exists/.test(e.message)) throw e; }
  log(agent?.id, 'branch', `created branch ${branch}`, `${repoUrl()}/tree/${branch}`);
  return sha;
}

export async function commitFiles(branch, files, message, agent) {
  const parent = await headSha(branch);
  const base = await api('GET', `/repos/{repo}/git/commits/${parent}`);
  const tree = await api('POST', '/repos/{repo}/git/trees', {
    base_tree: base.tree.sha,
    tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
  });
  const author = { ...agentAuthor(agent), date: new Date().toISOString() };
  const commit = await api('POST', '/repos/{repo}/git/commits', { message, tree: tree.sha, parents: [parent], author });
  await api('PATCH', `/repos/{repo}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha });
  log(agent.id, 'commit', message.split('\n')[0], commit.html_url ?? `${repoUrl()}/commit/${commit.sha}`, { sha: commit.sha, files: files.map(f => f.path) });
  return commit.sha;
}

export async function openPR({ head, title, body, draft = false }, agent) {
  const pr = await api('POST', '/repos/{repo}/pulls', { head, base: 'main', title, body, draft });
  log(agent.id, 'pr', `opened PR #${pr.number} ${title}`, pr.html_url, { number: pr.number });
  return pr;
}

export async function updatePR(number, patch) { return api('PATCH', `/repos/{repo}/pulls/${number}`, patch); }

export async function comment(number, body, agent) {
  const c = await api('POST', `/repos/{repo}/issues/${number}/comments`, { body });
  log(agent.id, 'comment', `commented on PR #${number}`, c.html_url, { number });
  return c;
}

export async function review(number, body, agent) {
  // The token owner opened the PR, so GitHub allows COMMENT reviews only.
  const r = await api('POST', `/repos/{repo}/pulls/${number}/reviews`, { body, event: 'COMMENT' });
  log(agent.id, 'review', `reviewed PR #${number}`, r.html_url, { number });
  return r;
}

export async function labels(number, names) {
  return api('POST', `/repos/{repo}/issues/${number}/labels`, { labels: names }).catch(() => null);
}
export async function removeLabel(number, name) {
  return api('DELETE', `/repos/{repo}/issues/${number}/labels/${encodeURIComponent(name)}`).catch(() => null);
}

export async function status(sha, context, stateName, description, agent, targetUrl) {
  await api('POST', `/repos/{repo}/statuses/${sha}`, { state: stateName, context, description: description.slice(0, 139), target_url: targetUrl });
  log(agent.id, 'status', `${context} → ${stateName}`, `${repoUrl()}/commit/${sha}`, { sha, context, state: stateName });
}

export async function merge(number, title, agent) {
  const m = await api('PUT', `/repos/{repo}/pulls/${number}/merge`, { merge_method: 'squash', commit_title: title });
  log(agent.id, 'merge', `merged PR #${number}`, `${repoUrl()}/pull/${number}`, { sha: m.sha, number });
  return m;
}

export async function deploy(ref, environment, description, agent) {
  const d = await api('POST', '/repos/{repo}/deployments', { ref, environment, description, auto_merge: false, required_contexts: [], transient_environment: false, production_environment: false });
  await api('POST', `/repos/{repo}/deployments/${d.id}/statuses`, { state: 'in_progress', description: 'Rolling out to edge gateways' });
  await api('POST', `/repos/{repo}/deployments/${d.id}/statuses`, { state: 'success', description: description.slice(0, 139), environment_url: `${repoUrl()}/deployments` });
  log(agent.id, 'deploy', `deployed ${ref.slice(0, 7)} to ${environment}`, `${repoUrl()}/deployments`, { id: d.id });
  return d;
}

export async function deleteBranch(branch) {
  return api('DELETE', `/repos/{repo}/git/refs/heads/${encodeURIComponent(branch)}`).catch(() => null);
}

// Snapshot for the GitHub page, polled by the server and pushed to the UI.
export async function snapshot() {
  const [info, pulls, commits, runs, deployments, branches] = await Promise.all([
    api('GET', '/repos/{repo}'),
    api('GET', '/repos/{repo}/pulls?state=all&per_page=30&sort=updated&direction=desc'),
    api('GET', '/repos/{repo}/commits?per_page=25').catch(() => []),
    api('GET', '/repos/{repo}/actions/runs?per_page=15').catch(() => ({ workflow_runs: [] })),
    api('GET', '/repos/{repo}/deployments?per_page=15').catch(() => []),
    api('GET', '/repos/{repo}/branches?per_page=100').catch(() => []),
  ]);
  return {
    repo: repo(), url: repoUrl(), defaultBranch: info.default_branch, visibility: info.visibility, stars: info.stargazers_count,
    pulls: pulls.map(p => ({ number: p.number, title: p.title, state: p.merged_at ? 'merged' : p.state, draft: p.draft, head: p.head.ref, sha: p.head.sha, url: p.html_url, user: p.user.login, updated: p.updated_at, labels: p.labels.map(l => l.name) })),
    commits: commits.map(c => ({ sha: c.sha, message: c.commit.message.split('\n')[0], author: c.commit.author.name, date: c.commit.author.date, url: c.html_url })),
    runs: (runs.workflow_runs ?? []).map(r => ({ id: r.id, name: r.name, branch: r.head_branch, status: r.status, conclusion: r.conclusion, url: r.html_url, event: r.event, created: r.created_at, sha: r.head_sha })),
    deployments: deployments.map(d => ({ id: d.id, ref: d.ref, sha: d.sha, environment: d.environment, description: d.description, created: d.created_at, creator: d.creator?.login })),
    branches: branches.map(b => b.name),
    rate: { ...rate },
  };
}

export async function combinedStatus(sha) {
  const s = await api('GET', `/repos/{repo}/commits/${sha}/status`);
  return s.statuses.map(x => ({ context: x.context, state: x.state, description: x.description }));
}
