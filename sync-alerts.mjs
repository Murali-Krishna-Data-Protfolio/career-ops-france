#!/usr/bin/env node
// Local PC sync (local customization) — runs after the cloud's 08:00 scan.
//   1. Pull the cloud results from GitHub
//   2. Windows popup for any match not yet shown on this PC
//   3. Push local changes (Job Inbox pastes, Applied / Dismiss)
// Usage: node sync-alerts.mjs [--log] [--no-popup]

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadMatches, markNotified } from './lib/job-store.mjs';
import { pull, syncUp } from './lib/git-sync.mjs';
import { notifyMatches, desktopToast } from './lib/notify.mjs';

const args = new Set(process.argv.slice(2));
const LOG_FILE = args.has('--log') ? path.join(ROOT, 'data', 'daily-scan.log') : null;
const log = (...a) => {
  const line = [`[${new Date().toTimeString().slice(0, 8)}] sync:`, ...a].join(' ');
  if (LOG_FILE) fs.appendFileSync(LOG_FILE, `${line}\n`); else console.log(line);
};

const p = pull();
log(p.ok ? 'pulled cloud results' : `pull failed — ${p.out}`);

const unseen = loadMatches().filter((m) => m.isHigh && m.status === 'new' && !m.notified?.desktop);
if (unseen.length && !args.has('--no-popup')) {
  // Desktop only here: Gmail/WhatsApp were already sent by the cloud run.
  const prev = process.env.ALERT_GMAIL_USER, prevW = process.env.ALERT_WHATSAPP_PHONE;
  delete process.env.ALERT_GMAIL_USER; delete process.env.ALERT_WHATSAPP_PHONE;
  const r = await notifyMatches(unseen, { reason: 'cloud scan', high: true });
  process.env.ALERT_GMAIL_USER = prev ?? ''; process.env.ALERT_WHATSAPP_PHONE = prevW ?? '';
  if (r.desktop?.ok) markNotified(unseen.map((m) => m.url), 'desktop');
  log(`popup for ${unseen.length} new match(es): ${r.desktop?.ok ? 'shown' : r.desktop?.error || 'desktop alerts off'}`);
} else {
  log('no new matches to show');
}
if (!p.ok) await desktopToast({ title: 'career-ops: GitHub sync failed', lines: [String(p.out).slice(0, 120), 'Open Job Inbox → Sync now, or check data\\daily-scan.log'] });

const s = syncUp('PC sync: local updates');
log(s.ok ? 'pushed local changes' : s.out);
