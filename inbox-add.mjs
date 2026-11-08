#!/usr/bin/env node
// Online Job Inbox backend (runs in GitHub Actions: .github/workflows/inbox-add.yml).
// Same logic as pasting into the local Job Inbox:
//   job link     → read JD, English-only check, CV score, add to pipeline, alert on match
//   careers site → add as a PRIORITY source (portals.yml or watched page)
// Usage: node inbox-add.mjs --url <link> [--kind auto|job|site] [--name "Company"]

import { evaluatePosting, classifyUrl, addCareersSite } from './lib/job-intake.mjs';
import { appendPipeline } from './lib/job-store.mjs';
import { notifyMatches } from './lib/notify.mjs';
import { writeMatchesReport } from './lib/matches-report.mjs';

const argv = process.argv.slice(2);
const opt = (k, d = '') => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const url = opt('url').trim();
const name = opt('name').trim();
let kind = opt('kind', 'auto');

if (!url) { console.error('missing --url'); process.exit(1); }
if (kind !== 'job' && kind !== 'site') kind = await classifyUrl(url);
console.log(`Link: ${url}\nKind: ${kind}`);

if (kind === 'site') {
  const r = await addCareersSite(url, name);
  console.log(`RESULT: ${r.message}`);
  if (!r.ok) process.exitCode = 1;
} else {
  const rec = await evaluatePosting({ url, company: name, source: 'online' });
  if (rec.englishIssue) {
    console.log(`RESULT: Saved as rejected — ${rec.englishIssue} (English-only rule).`);
  } else {
    appendPipeline({ ...rec, note: `online ${new Date().toISOString().slice(0, 10)} · match ${rec.score}` });
    const alert = ' Added to the next daily digest.';
    console.log(`RESULT: ${rec.isHigh ? '🔥 High priority' : rec.isMatch ? '✅ Match' : 'Saved'} —${rec.company}: ${rec.title} · score ${rec.score}/100.${alert}`);
  }
}
writeMatchesReport();
