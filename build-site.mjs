#!/usr/bin/env node
// Builds the Job Radar website into _site/ (deployed to GitHub Pages):
//   _site/index.html  ← site/index.html
//   _site/jobs.json   ← data/matches.jsonl (job postings + scores + your status)
// Personal data (CV, phone, email, salary) is never part of it.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadMatches, priorityCompanies, loadWatchPages } from './lib/job-store.mjs';
import { THRESHOLD } from './lib/job-intake.mjs';

const OUT = path.join(ROOT, '_site');
fs.mkdirSync(OUT, { recursive: true });

export function tierOf(m) {
  if (m.englishIssue) return 'rejected';
  const s = Number(m.score) || 0;
  if (s >= (m.priority ? THRESHOLD.highPriority : THRESHOLD.high)) return 'high';
  if (s >= (m.priority ? THRESHOLD.priority : THRESHOLD.normal)) return 'match';
  return 'other';
}

const KEEP = ['url', 'company', 'title', 'location', 'posted', 'addedAt', 'updatedAt', 'source', 'priority', 'score',
  'hits', 'gaps', 'statedYears', 'status', 'referral', 'note', 'englishIssue'];
const jobs = loadMatches()
  .map((m) => ({ ...Object.fromEntries(KEEP.filter((k) => m[k] !== undefined).map((k) => [k, m[k]])), tier: tierOf(m) }))
  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

const repo = process.env.GITHUB_REPOSITORY || 'Murali-Krishna-Data-Protfolio/job-radar';
const data = {
  generatedAt: new Date().toISOString(),
  repo,
  thresholds: THRESHOLD,
  prioritySources: [
    ...priorityCompanies().map((c) => ({ name: c.name, url: c.careers_url, kind: 'scanner' })),
    ...loadWatchPages().map((w) => ({ name: w.name, url: w.url, kind: 'watched page' })),
  ],
  counts: jobs.reduce((acc, j) => ({ ...acc, [j.tier]: (acc[j.tier] || 0) + 1 }), {}),
  jobs,
};
fs.writeFileSync(path.join(OUT, 'jobs.json'), JSON.stringify(data));
fs.copyFileSync(path.join(ROOT, 'site', 'index.html'), path.join(OUT, 'index.html'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`_site built: ${jobs.length} jobs`, data.counts);
