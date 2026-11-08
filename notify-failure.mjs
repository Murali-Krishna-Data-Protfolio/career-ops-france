#!/usr/bin/env node
// Emails you when a cloud run fails, so a broken scan never hides jobs silently.
// Called by the workflows with `if: failure()`. Usage: node notify-failure.mjs "<what failed>" "<run url>"
import { sendGmail } from './lib/notify.mjs';

const [what = 'Job Radar run', runUrl = ''] = process.argv.slice(2);
const r = await sendGmail({
  subject: `⚠️ Job Radar: ${what} FAILED — check it today`,
  text: `${what} failed, so today's jobs may not have been checked.\n\nDetails: ${runUrl}\n\nRe-run it from the Actions tab (Run workflow) or the "Run scan now" button on Job Radar.`,
});
console.log(r.ok ? 'failure email sent' : `failure email not sent: ${r.error}`);
