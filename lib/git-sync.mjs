// Git sync between this PC and the GitHub repo (local customization).
// Shared data files use `merge=union` (.gitattributes), so pull --rebase
// rarely conflicts; on a conflict the rebase is aborted and nothing is lost
// (local commits stay, retried on the next sync).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ROOT } from './job-store.mjs';

const GIT_CANDIDATES = ['git', 'C:\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe'];
let GIT = null;
function gitBin() {
  if (GIT) return GIT;
  for (const g of GIT_CANDIDATES) {
    const r = spawnSync(g, ['--version'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) return (GIT = g);
  }
  return null;
}
export function git(...args) {
  const bin = gitBin();
  if (!bin) return { ok: false, out: 'git not installed' };
  const r = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}
export const isRepo = () => fs.existsSync(`${ROOT}/.git`) && git('rev-parse', '--is-inside-work-tree').ok;

// Files both sides write. Everything else is code/config, committed by hand.
export const DATA_FILES = [
  'data/pipeline.md', 'data/matches.jsonl', 'data/scan-history.tsv', 'data/applications.md',
  'data/watch-pages.json', 'data/scan-runs.tsv', 'data/portal-health.tsv', 'portals.yml',
];

/** Pull remote changes (rebase, autostash). */
export function pull() {
  if (!isRepo()) return { ok: false, out: 'not a git repo' };
  const r = git('pull', '--rebase', '--autostash', '--quiet');
  if (!r.ok && /conflict|could not apply/i.test(r.out)) git('rebase', '--abort');
  return r;
}

/** Commit changed data files and push (pull first). */
export function syncUp(message = 'Job Inbox: local updates') {
  if (!isRepo()) return { ok: false, out: 'not a git repo' };
  git('add', '--', ...DATA_FILES.filter((f) => fs.existsSync(`${ROOT}/${f}`)));
  const staged = git('diff', '--cached', '--quiet');
  if (!staged.ok) git('commit', '-m', message, '--quiet');
  const p = pull();
  if (!p.ok) return { ok: false, out: `pull failed: ${p.out}` };
  const push = git('push', '--quiet');
  return push.ok ? { ok: true, out: 'synced' } : { ok: false, out: `push failed: ${push.out}` };
}
