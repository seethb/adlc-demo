// Shared helpers for pages (kept out of component files so Fast Refresh works).
export const STAGES = ['plan', 'design', 'develop', 'test', 'review', 'deploy'];
export const agentOf = (s, id) => s.roster?.agents.find(a => a.id === id);
export const latestRun = (s, fid) => s.runs.find(r => r.feature === fid && r.status !== 'superseded');
