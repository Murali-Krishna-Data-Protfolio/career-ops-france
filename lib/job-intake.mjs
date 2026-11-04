// Shared intake logic for daily-run.mjs and job-inbox.mjs (local customization).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { getJobDetails, fetchPage, assertPublicUrl } from './jd-text.mjs';
import { frenchShare, frenchRequirement } from './english-gate.mjs';
import { scoreJob } from './cv-match.mjs';
import {
  ROOT, upsertMatch, appendPipeline, isPriority, titleFilter, hasCompany, addTrackedCompany, siteKey,
  loadWatchPages, saveWatchPages, loadPortals,
} from './job-store.mjs';
import { loadProviders, resolveProvider } from '../providers/_registry.mjs';

// Alert thresholds on the 0-100 CV score. Priority sources (Allianz France…)
// alert earlier so nothing relevant there is missed.
export const THRESHOLD = { normal: 55, priority: 40 };

/** English-only verdict on JD text: null = OK, else the reason it fails. */
export function englishProblem(text, providerLang = '') {
  const lang = String(providerLang || '').toLowerCase();
  if (lang && !lang.startsWith('en')) return `posting language "${lang}"`;
  if (!text || !text.trim()) return 'no job description could be read';
  const s = frenchShare(text);
  if (s.total >= 8 && s.share > 0.3) return `job description is in French (${Math.round(s.share * 100)}% French)`;
  const req = frenchRequirement(text);
  if (req) return `requires French: "…${req}…"`;
  return null;
}

/**
 * Read, check and score one posting; store it in data/matches.json.
 * @returns {Promise<object>} the stored record (with .isMatch)
 */
export async function evaluatePosting({ url, company = '', title = '', location = '', source = 'scan', language = '', priority }) {
  let d = { text: '', title: '', company: '', location: '', datePosted: '' };
  let readError = '';
  try { d = await getJobDetails(url); } catch (err) { readError = err.message; }
  const rec = {
    url,
    company: company || d.company || new URL(url).hostname.replace(/^www\.|^careers?\.|^jobs?\./g, ''),
    title: title || d.title || 'Untitled posting',
    location: location || d.location || '',
    posted: d.datePosted || '',
    source,
    addedAt: new Date().toISOString(),
  };
  rec.priority = priority ?? isPriority(rec.company);
  const lang = language || (d.source === 'wttj-api' ? d.language : '');
  rec.englishIssue = (readError && !d.text) ? `could not read posting (${readError})`
    : d.source === 'blocked' ? 'site blocked automatic reading (bot check) — open it and judge by hand'
    : englishProblem(d.text, lang);
  const s = scoreJob({ title: rec.title, text: d.text, location: rec.location });
  Object.assign(rec, { score: s.score, verdict: s.verdict, hits: s.hits, gaps: s.gaps, statedYears: s.parts.statedYears });
  const min = rec.priority ? THRESHOLD.priority : THRESHOLD.normal;
  rec.isMatch = !rec.englishIssue && rec.score >= min;
  if (rec.englishIssue) rec.status = 'rejected';
  return upsertMatch(rec);
}

// ── URL classification ──────────────────────────────────────────────
const JOB_PATTERNS = [
  /greenhouse\.io\/.+\/jobs\/\d+/i, /jobs\.(eu\.)?lever\.co\/[^/]+\/[0-9a-f-]{20,}/i,
  /jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{20,}/i, /myworkdayjobs\.com\/.+\/job\//i,
  /smartrecruiters\.com\/[^/]+\/\d{6,}/i, /welcometothejungle\.com\/.+\/jobs\/[^/?#]+/i,
  /linkedin\.com\/jobs\/view\//i, /indeed\.[a-z.]+\/(viewjob|rc\/clk|m\/basecamp\/viewjob)/i,
  /\/job\/\d+/i, /\/jobs?\/[^/?#]*\d{4,}/i, /apply\.workable\.com\/[^/]+\/j\//i,
  /jobs\.personio\.[a-z]+\/job\/\d+/i, /teamtailor\.com\/jobs\/\d+/i, /recruitee\.com\/o\//i,
];
/** 'job' for a single posting, 'site' for a careers page / board. */
export async function classifyUrl(url) {
  assertPublicUrl(url);
  if (JOB_PATTERNS.some((re) => re.test(url))) return 'job';
  try {
    const { html } = await fetchPage(url);
    const n = (html.match(/"@type"\s*:\s*"JobPosting"/g) || []).length;
    if (n === 1) return 'job';
  } catch { /* fall through */ }
  return 'site';
}

// ── Careers sites ───────────────────────────────────────────────────
function nameFromHost(url) {
  const host = new URL(url).hostname.replace(/^(www|careers?|jobs?|join|apply|emplois?|recrutement)\./i, '');
  const base = host.split('.')[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Run scan.mjs for one company (dry run) and report how many postings it saw. */
export function testScanCompany(name) {
  const r = spawnSync(process.execPath, ['scan.mjs', '--company', name, '--dry-run', '--quiet'], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const total = Number(out.match(/Total jobs found:\s+(\d+)/)?.[1] ?? NaN);
  const added = Number(out.match(/New offers added:\s+(\d+)/)?.[1] ?? NaN);
  const errors = out.match(/✗[^\n]*/g) || [];
  return { total, added, errors, ok: Number.isFinite(total) && errors.length === 0 };
}

/**
 * Add a careers site to the daily watch (as a priority source).
 * Supported boards go into portals.yml; anything else becomes a watched page.
 */
export async function addCareersSite(url, name = '') {
  const u = assertPublicUrl(url);
  const displayName = (name || nameFromHost(url)).trim();
  if (hasCompany(displayName, url) || loadWatchPages().some((w) => siteKey(w.url) === siteKey(url))) {
    return { ok: true, already: true, name: displayName, message: `${displayName} is already being watched.` };
  }
  const providers = await loadProviders(path.join(ROOT, 'providers'));
  const entry = { name: displayName, careers_url: url };
  let resolved = resolveProvider(entry, providers);
  let html = '';
  if (!resolved?.provider) {
    try { html = (await fetchPage(url)).html; } catch { /* handled below */ }
    if (/phenom/i.test(html) && /\/widgets|phenompeople|"ddoKey"/i.test(html + url)) {
      const seg = u.pathname.split('/').filter(Boolean);
      entry.careers_url = u.origin;
      entry.provider = 'phenom';
      entry.phenom = { urlPrefix: seg.length >= 2 ? `${seg[0]}/${seg[1]}` : 'global/en' };
      resolved = { provider: providers.get('phenom') };
    }
  }
  if (resolved?.provider) {
    addTrackedCompany({ ...entry, notes: `Priority source added from Job Inbox (${resolved.provider.id})` });
    const test = testScanCompany(displayName);
    return {
      ok: true, kind: 'tracked', provider: resolved.provider.id, name: displayName, test,
      message: Number.isFinite(test.total)
        ? `Added ${displayName} (${resolved.provider.id}). Test scan read ${test.total} postings; ${test.added} match your France/English/data filters now.`
        : `Added ${displayName} (${resolved.provider.id}), but the test scan did not complete: ${test.errors.join('; ') || 'see daily log'}.`,
    };
  }
  // No provider: watch the page itself (link diff).
  if (!html) {
    try { html = (await fetchPage(url)).html; } catch (err) { return { ok: false, message: `Could not open that page: ${err.message}` }; }
  }
  const links = jobLinksFromPage(html, url);
  const list = loadWatchPages();
  list.push({ name: displayName, url, addedAt: new Date().toISOString(), seen: links.map((l) => l.url) });
  saveWatchPages(list);
  return {
    ok: true, kind: 'watched-page', name: displayName, links: links.length,
    message: links.length
      ? `Watching ${displayName}: ${links.length} job links on the page now; new matching ones will alert you.`
      : `Watching ${displayName}, but the page shows no job links without a browser (it is probably built with JavaScript). Paste individual job links from it instead, or send me the site so I can add a proper scanner.`,
  };
}

/** Links on a careers page whose text passes the portals.yml title filter. */
export function jobLinksFromPage(html, baseUrl) {
  const pass = titleFilter();
  const out = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 160 || !pass(text)) continue;
    let abs;
    try { abs = new URL(m[1], baseUrl).href; } catch { continue; }
    if (!/^https?:/.test(abs)) continue;
    out.set(abs, { url: abs, title: text });
  }
  return [...out.values()];
}

/** Daily: diff every watched page; evaluate new job links. */
export async function scanWatchPages(log = console.log) {
  const list = loadWatchPages();
  const found = [];
  for (const w of list) {
    try {
      const { html } = await fetchPage(w.url);
      const links = jobLinksFromPage(html, w.url);
      const fresh = links.filter((l) => !w.seen.includes(l.url));
      log(`  watched page ${w.name}: ${links.length} job links, ${fresh.length} new`);
      for (const l of fresh) {
        const rec = await evaluatePosting({ url: l.url, title: l.title, company: w.name, source: 'watched-page', priority: true });
        if (!rec.englishIssue) appendPipeline({ ...rec, note: `watched page ${new Date().toISOString().slice(0, 10)} · match ${rec.score}` });
        found.push(rec);
      }
      w.seen = [...new Set([...w.seen, ...links.map((l) => l.url)])].slice(-2000);
      w.lastChecked = new Date().toISOString();
    } catch (err) {
      log(`  watched page ${w.name}: ERROR ${err.message}`);
    }
  }
  saveWatchPages(list);
  return found;
}

export { loadPortals };
