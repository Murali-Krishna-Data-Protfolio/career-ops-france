#!/usr/bin/env node
// Daily job run (local customization) — called by Task Scheduler at 08:00.
//
//   1. PRIORITY sources first (portals.yml `priority: true`, e.g. Allianz France)
//   2. Full scan (all companies + Welcome to the Jungle)
//   3. Watched careers pages (sites added in Job Inbox without a scanner)
//   4. Score every NEW posting against cv.md (lib/cv-match.mjs)
//   5. Alert on matches: Windows popup + Gmail + WhatsApp (lib/notify.mjs)
//
// Usage:
//   node daily-run.mjs               # the full daily run
//   node daily-run.mjs --no-notify   # run + score, no alerts
//   node daily-run.mjs --backfill    # score postings already in pipeline.md (no alerts)
//   node daily-run.mjs --test-alert  # send a test alert on every configured channel

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, pipelineEntries, priorityCompanies, loadMatches, markNotified } from './lib/job-store.mjs';
import { writeMatchesReport } from './lib/matches-report.mjs';
import { evaluatePosting, scanWatchPages, THRESHOLD } from './lib/job-intake.mjs';
import { notifyMatches, channelStatus } from './lib/notify.mjs';

const args = new Set(process.argv.slice(2));
// --log: append to data/daily-scan.log (used by the 08:00 scheduled task).
const LOG_FILE = args.has('--log') ? path.join(ROOT, 'data', 'daily-scan.log') : null;
if (LOG_FILE) fs.appendFileSync(LOG_FILE, `===== ${new Date().toLocaleString()} (scheduled) =====\n`);
const log = (...a) => {
  const line = [`[${new Date().toTimeString().slice(0, 8)}]`, ...a].join(' ');
  if (LOG_FILE) fs.appendFileSync(LOG_FILE, `${line}\n`); else console.log(line);
};

function runScan(company) {
  const argv = ['scan.mjs', '--quiet', ...(company ? ['--company', company] : [])];
  const r = spawnSync(process.execPath, argv, { cwd: ROOT, encoding: 'utf8', timeout: 20 * 60_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const added = out.match(/New offers added:\s+(\d+)/)?.[1] ?? '?';
  const total = out.match(/Total jobs found:\s+(\d+)/)?.[1] ?? '?';
  const errs = (out.match(/✗[^\n]*/g) || []).map((s) => s.trim());
  log(`  ${company ? `priority "${company}"` : 'full scan'}: ${total} postings read, ${added} new${errs.length ? ` — errors: ${errs.join('; ')}` : ''}`);
  return out;
}

async function scoreNew(entries, source) {
  const known = new Set(loadMatches().map((m) => m.url));
  const out = [];
  for (const e of entries) {
    if (known.has(e.url)) continue;
    const rec = await evaluatePosting({ url: e.url, company: e.company, title: e.title, location: e.location, source });
    log(`    ${rec.isHigh ? '🔥 HIGH ' : rec.isMatch ? '✅ MATCH' : rec.englishIssue ? '⛔ skip ' : '·  low  '} ${String(rec.score).padStart(3)} ${rec.priority ? '⭐' : '  '} ${rec.company} — ${rec.title}${rec.englishIssue ? ` (${rec.englishIssue})` : ''}`);
    out.push(rec);
  }
  return out;
}

async function main() {
  const ch = channelStatus();
  log(`career-ops daily run — alerts: desktop=${ch.desktop} gmail=${ch.gmail} whatsapp=${ch.whatsapp} · thresholds: ${THRESHOLD.normal} (priority ${THRESHOLD.priority})`);

  if (args.has('--test-alert')) {
    const r = await notifyMatches([{
      company: 'Allianz France', title: 'TEST — Analytics Engineer (alert check)', location: 'Paris La Défense, France',
      url: 'https://careers.allianz.com/global/en/search-results', score: 88, hits: ['Power BI', 'SQL', 'dbt', 'Microsoft Fabric'], priority: true,
    }], { reason: 'test alert' });
    log('test alert results:', JSON.stringify(r));
    return;
  }

  if (args.has('--backfill')) {
    const recs = await scoreNew(pipelineEntries().filter((e) => !e.done), 'scan');
    log(`backfill: scored ${recs.length} postings (no alerts sent)`);
    return;
  }

  const before = new Set(pipelineEntries().map((e) => e.url));

  log('1) Priority sources');
  const prio = priorityCompanies();
  if (!prio.length) log('  (none configured)');
  for (const c of prio) runScan(c.name);

  log('2) Full scan');
  runScan(null);

  log('3) Watched careers pages');
  const watched = await scanWatchPages((m) => log(m));

  log('4) Scoring new postings against your CV');
  const fresh = pipelineEntries().filter((e) => !before.has(e.url));
  const scored = await scoreNew(fresh, 'scan');
  const all = [...watched, ...scored];
  const matches = all.filter((r) => r.isHigh); // only 🔥 HIGH PRIORITY jobs are alerted
  log(`   ${all.length} new postings, ${all.filter((r) => r.isMatch).length} match your CV, ${matches.length} high priority`);

  log('5) Alerts (high priority only)');
  if (!matches.length) log('  no high-priority jobs today — no alert sent');
  else if (args.has('--no-notify')) log('  --no-notify: alerts skipped');
  else {
    const r = await notifyMatches(matches, { reason: `daily scan ${new Date().toISOString().slice(0, 10)}`, high: true });
    log('  sent:', JSON.stringify(r));
    for (const [channel, res] of Object.entries(r)) if (res?.ok) markNotified(matches.map((m) => m.url), channel);
  }
  if (process.env.GITHUB_ACTIONS) { // only the cloud writes MATCHES.md (avoids merge conflicts)
    const rep = writeMatchesReport();
    log(`6) MATCHES.md updated (${rep.open} open matches)`);
  }
}

main().catch((err) => { log('FATAL', err.stack || err.message); process.exitCode = 1; });
