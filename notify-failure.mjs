#!/usr/bin/env node
// Tells you when a cloud run fails, so a broken scan never hides jobs silently.
// Called by the workflows with `if: failure()`. Usage: node notify-failure.mjs "<what failed>" "<run url>"
// Sends on every configured channel (Gmail and/or WhatsApp).
import { sendGmail, sendWhatsApp, channelStatus } from './lib/notify.mjs';

const [what = 'Job Radar run', runUrl = ''] = process.argv.slice(2);
const subject = `⚠️ Job Radar: ${what} FAILED — check it today`;
const text = `${what} failed, so today's jobs may not have been checked.\n\nDetails: ${runUrl}\n\nRe-run it from the Actions tab (Run workflow).`;

const ch = channelStatus();
const results = {};
if (ch.gmail) results.gmail = await sendGmail({ subject, text });
if (ch.whatsapp) results.whatsapp = await sendWhatsApp(`⚠️ ${what} FAILED — jobs may not be checked today.\n${runUrl}`);
if (!Object.keys(results).length) console.log('no alert channel configured — failure not notified');
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v.ok ? 'sent' : `not sent — ${v.error}`}`);
