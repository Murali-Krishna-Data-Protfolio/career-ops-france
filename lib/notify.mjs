// Personal job alerts (local customization): Windows popup, Gmail, WhatsApp.
//
// Channels are configured in .env (never shared, never committed):
//   ALERT_DESKTOP=1                       Windows popup (default on)
//   ALERT_GMAIL_USER=you@gmail.com        Gmail account that SENDS the alert
//   ALERT_GMAIL_APP_PASSWORD=xxxx xxxx…   16-char Google App Password (not your normal password)
//   ALERT_EMAIL_TO=you@gmail.com          where alerts go (defaults to ALERT_GMAIL_USER)
//   ALERT_WHATSAPP_PHONE=+33…             your WhatsApp number (CallMeBot)
//   ALERT_CALLMEBOT_APIKEY=123456         key CallMeBot sends you on WhatsApp
//
// Each channel fails independently; a failure is reported, never thrown.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

// The online Job Radar page (GitHub Pages) — linked from every alert.
export const INBOX_URL = process.env.JOB_RADAR_URL || 'https://murali-krishna-data-protfolio.github.io/career-ops-france/';
const PS_APP_ID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';

const xmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const psEsc = (s) => String(s ?? '').replace(/'/g, "''");

export function channelStatus() {
  const e = process.env;
  return {
    desktop: e.ALERT_DESKTOP !== '0',
    gmail: Boolean(e.ALERT_GMAIL_USER && e.ALERT_GMAIL_APP_PASSWORD),
    whatsapp: Boolean(e.ALERT_WHATSAPP_PHONE && e.ALERT_CALLMEBOT_APIKEY),
  };
}

/** Windows toast. `urgent` keeps it on screen until dismissed. */
export function desktopToast({ title, lines = [], url = INBOX_URL, urgent = false }) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, error: 'not Windows' });
  const body = lines.slice(0, 2).map((l) => `<text>${xmlEsc(l)}</text>`).join('');
  const xml = `<toast activationType="protocol" launch="${xmlEsc(url)}"${urgent ? ' scenario="reminder"' : ''}>`
    + `<visual><binding template="ToastGeneric"><text>${xmlEsc(title)}</text>${body}</binding></visual>`
    + `<actions><action content="Open job" activationType="protocol" arguments="${xmlEsc(url)}"/>`
    + `<action content="Job Radar" activationType="protocol" arguments="${xmlEsc(INBOX_URL)}"/></actions>`
    + `${urgent ? '<audio src="ms-winsoundevent:Notification.Reminder"/>' : ''}</toast>`;
  const script = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$x.LoadXml('${psEsc(xml)}')`,
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${psEsc(PS_APP_ID)}').Show((New-Object Windows.UI.Notifications.ToastNotification $x))`,
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ ok: false, error: e.message }));
    p.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim() || `exit ${code}` }));
  });
}

export async function sendGmail({ subject, text, html }) {
  const e = process.env;
  if (!e.ALERT_GMAIL_USER || !e.ALERT_GMAIL_APP_PASSWORD) return { ok: false, error: 'Gmail not configured' };
  try {
    const { default: nodemailer } = await import('nodemailer');
    const t = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: e.ALERT_GMAIL_USER, pass: e.ALERT_GMAIL_APP_PASSWORD.replace(/\s+/g, '') },
    });
    await t.sendMail({ from: `career-ops <${e.ALERT_GMAIL_USER}>`, to: e.ALERT_EMAIL_TO || e.ALERT_GMAIL_USER, subject, text, html });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function sendWhatsApp(text) {
  const e = process.env;
  if (!e.ALERT_WHATSAPP_PHONE || !e.ALERT_CALLMEBOT_APIKEY) return { ok: false, error: 'WhatsApp not configured' };
  try {
    const u = new URL('https://api.callmebot.com/whatsapp.php');
    u.searchParams.set('phone', e.ALERT_WHATSAPP_PHONE.replace(/\s+/g, ''));
    u.searchParams.set('text', text.slice(0, 1500));
    u.searchParams.set('apikey', e.ALERT_CALLMEBOT_APIKEY.trim());
    const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
    const body = await r.text();
    return r.ok && !/error|invalid/i.test(body.slice(0, 300)) ? { ok: true } : { ok: false, error: `HTTP ${r.status}: ${body.replace(/<[^>]+>/g, ' ').trim().slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const star = (m) => (m.priority ? '⭐ ' : '');
const line = (m) => `${star(m)}${m.company} — ${m.title} (${m.location || 'France'}) · match ${m.score}/100`;

/**
 * Send one alert for a batch of matched jobs on every configured channel.
 * @param {Array<{company:string,title:string,location?:string,url:string,score:number,hits?:string[],gaps?:string[],priority?:boolean,source?:string}>} matches
 */
export async function notifyMatches(matches, { reason = 'daily scan', high = false } = {}) {
  if (!matches.length) return {};
  const sorted = [...matches].sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || b.score - a.score);
  const top = sorted[0];
  const anyPriority = high || sorted.some((m) => m.priority);
  const head = high
    ? `🔥 HIGH PRIORITY: ${sorted.length} job${sorted.length > 1 ? 's' : ''} closely matching your profile`
    : `${sorted.length} new job match${sorted.length > 1 ? 'es' : ''} for your CV`;
  const results = {};
  const ch = channelStatus();

  if (ch.desktop) {
    results.desktop = await desktopToast({
      title: high ? `🔥 HIGH PRIORITY: ${top.company} — ${top.title}` : anyPriority ? `⭐ PRIORITY: ${top.company} — ${top.title}` : `${head}`,
      lines: [
        sorted.length === 1 ? `${top.location || 'France'} · match ${top.score}/100` : `Top: ${top.company} — ${top.title} (${top.score}/100)`,
        (top.hits || []).slice(0, 6).join(', '),
      ],
      url: sorted.length === 1 ? top.url : INBOX_URL,
      urgent: anyPriority,
    });
  }
  const textBody = [
    `${anyPriority ? '⭐ PRIORITY — ' : ''}${head} (${reason})`, '',
    ...sorted.map((m) => `${line(m)}\n  skills: ${(m.hits || []).slice(0, 8).join(', ') || '—'}${m.gaps?.length ? `\n  gaps: ${m.gaps.join(', ')}` : ''}\n  ${m.url}`),
    '', `All jobs (Job Radar): ${INBOX_URL}`,
  ].join('\n');
  if (ch.gmail) {
    const rows = sorted.map((m) => `<tr><td style="padding:8px;border-bottom:1px solid #ddd">${m.priority ? '⭐ ' : ''}<b>${xmlEsc(m.company)}</b><br>${xmlEsc(m.title)}<br><small>${xmlEsc(m.location || 'France')}</small></td>`
      + `<td style="padding:8px;border-bottom:1px solid #ddd;text-align:center"><b>${m.score}</b>/100</td>`
      + `<td style="padding:8px;border-bottom:1px solid #ddd"><small>${xmlEsc((m.hits || []).slice(0, 8).join(', '))}${m.gaps?.length ? `<br>gaps: ${xmlEsc(m.gaps.join(', '))}` : ''}</small></td>`
      + `<td style="padding:8px;border-bottom:1px solid #ddd"><a href="${xmlEsc(m.url)}">Open</a></td></tr>`).join('');
    results.gmail = await sendGmail({
      subject: high
        ? `🔥 HIGH PRIORITY job: ${top.company} — ${top.title} (${top.score}/100)${sorted.length > 1 ? ` +${sorted.length - 1} more` : ''}`
        : `${anyPriority ? '⭐ PRIORITY ' : ''}Job Radar: ${head} — ${top.company}`,
      text: textBody,
      html: `<div style="font-family:Segoe UI,Arial,sans-serif"><h2>${xmlEsc(head)}</h2><p>${xmlEsc(reason)} · France · English-only</p><table style="border-collapse:collapse">${rows}</table><p><a href="${xmlEsc(INBOX_URL)}">Open Job Radar</a> for all jobs. Score = CV skill overlap + title fit + location (0-100).</p></div>`,
    });
  }
  if (ch.whatsapp) {
    const wa = [head, ...sorted.slice(0, 5).map((m) => `• ${line(m)}\n${m.url}`), sorted.length > 5 ? `+${sorted.length - 5} more` : '', `Job Radar: ${INBOX_URL}`].filter(Boolean).join('\n');
    results.whatsapp = await sendWhatsApp(wa);
  }
  return results;
}

/**
 * One daily digest for WhatsApp + Gmail: what the scan found, high-priority jobs first,
 * the size of the 3-week list, and the page link. Sent once per run, even when nothing is new.
 * @param {{newScored:number, high:Array, windowCount:number, appliedCount:number, when?:string}} d
 */
export async function sendDaily(d) {
  const ch = channelStatus();
  const day = d.when || new Date().toISOString().slice(0, 10);
  const top = d.high.slice(0, 5);
  const headline = d.high.length
    ? `🔥 ${d.high.length} high-priority job${d.high.length > 1 ? 's' : ''} today`
    : 'No high-priority jobs today';
  const lines = [
    `Job Radar · ${day}`,
    headline,
    `${d.newScored} new postings checked this run`,
    ...top.map((m) => `• ${m.score} ${m.company} — ${m.title}\n  ${m.url}`),
    d.high.length > top.length ? `+${d.high.length - top.length} more on the page` : '',
    `On the page: ${d.windowCount} jobs (last 21 days) · ${d.appliedCount} applied`,
    `Page: ${INBOX_URL}`,
  ].filter(Boolean);
  const text = lines.join('\n');
  const results = {};
  if (ch.gmail) {
    const rows = top.map((m) => `<li><b>${m.score}</b> ${xmlEsc(m.company)} — ${xmlEsc(m.title)}<br><a href="${xmlEsc(m.url)}">${xmlEsc(m.url)}</a></li>`).join('');
    results.gmail = await sendGmail({
      subject: `Job Radar ${day}: ${headline}`,
      text,
      html: `<div style="font-family:Segoe UI,Arial,sans-serif"><h2>${xmlEsc(headline)}</h2><p>${xmlEsc(`${d.newScored} new postings checked this run`)}</p><ol>${rows}</ol><p>${d.high.length > top.length ? `+${d.high.length - top.length} more on the page. ` : ''}${d.windowCount} jobs on the page (last 21 days) · ${d.appliedCount} applied.</p><p><a href="${xmlEsc(INBOX_URL)}">Open Job Radar</a></p></div>`,
    });
  }
  if (ch.whatsapp) results.whatsapp = await sendWhatsApp(text);
  if (!Object.keys(results).length) results.none = { ok: false, error: 'no channel configured' };
  return results;
}
