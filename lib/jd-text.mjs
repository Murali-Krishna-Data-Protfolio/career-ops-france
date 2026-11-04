// Read a job posting's details from ANY posting URL (local customization).
//
// Order of attempts:
//   1. Known ATS public APIs (Greenhouse, Lever, Ashby, Workday, SmartRecruiters…)
//      via jd-years.fetchJdText.
//   2. The page itself:
//      a. schema.org JobPosting JSON-LD (most career sites, incl. WTTJ),
//      b. Phenom CareerConnect pages (e.g. careers.allianz.com) — embedded
//         "description" JSON,
//      c. fallback: visible page text.
//
// Returns { text, title, company, location, datePosted, language, source } —
// fields are '' when unknown. Throws only on a blocked URL.

import { fetchJdText } from '../jd-years.mjs';
import { htmlToText } from '../keyword-match.mjs';

const TEXT_CAP = 60_000;
const HTML_CAP = 3_000_000;
const TIMEOUT_MS = 20_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

/** Reject non-web and local/private targets (this runs on the user's PC). */
export function assertPublicUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new Error('Not a valid URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) links are supported');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '::1' || h === '[::1]'
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^0\./.test(h) || !h.includes('.')) {
    throw new Error('Local / private addresses are not allowed');
  }
  return u;
}

export async function fetchPage(url) {
  assertPublicUrl(url);
  const r = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en;q=1, fr;q=0.5' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  assertPublicUrl(r.url || url); // redirect target must be public too
  const html = (await r.text()).slice(0, HTML_CAP);
  return { html, finalUrl: r.url || url };
}

const decodeHtmlEntities = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

function asText(htmlish) {
  return htmlToText(decodeHtmlEntities(htmlish)).slice(0, TEXT_CAP);
}

/** All schema.org JobPosting objects in the page's JSON-LD blocks. */
export function jobPostingsFromJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const m of html.matchAll(re)) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { stack.push(...node); continue; }
      const type = node['@type'];
      if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) out.push(node);
      if (node['@graph']) stack.push(node['@graph']);
    }
  }
  return out;
}

function jsonLdLocation(jp) {
  const locs = Array.isArray(jp.jobLocation) ? jp.jobLocation : jp.jobLocation ? [jp.jobLocation] : [];
  const parts = [];
  for (const l of locs) {
    const a = l?.address || {};
    const country = typeof a.addressCountry === 'string' ? a.addressCountry : a.addressCountry?.name;
    const s = [a.addressLocality, a.addressRegion, country].filter(Boolean).join(', ');
    if (s) parts.push(s);
  }
  if (jp.jobLocationType === 'TELECOMMUTE') parts.push('Remote');
  return [...new Set(parts)].join(' · ');
}

function metaContent(html, prop) {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
  return m ? decodeHtmlEntities(m[1]).trim() : '';
}

/** Phenom CareerConnect embedded job JSON → description/title. */
function phenomFromHtml(html) {
  if (!/phenom/i.test(html)) return null;
  const d = html.match(/"description":"((?:[^"\\]|\\.){200,})"/);
  if (!d) return null;
  let raw;
  try { raw = JSON.parse(`"${d[1]}"`); } catch { return null; }
  const pick = (k) => {
    const m = html.match(new RegExp(`"${k}":"((?:[^"\\\\]|\\\\.){1,300})"`));
    if (!m) return '';
    try { return JSON.parse(`"${m[1]}"`); } catch { return ''; }
  };
  return {
    text: asText(raw),
    title: pick('title'),
    location: pick('cityStateCountry') || pick('location'),
    datePosted: pick('postedDate').slice(0, 10),
    company: pick('employingEntity') || pick('companyName'),
  };
}

/** Welcome to the Jungle: the page is bot-gated, its public JSON API is not. */
async function wttjDetails(url) {
  const m = new URL(url).pathname.match(/^\/[a-z]{2}\/companies\/([a-z0-9_-]+)\/jobs\/([a-z0-9_-]+)/i);
  if (!/(^|\.)welcometothejungle\.com$/i.test(new URL(url).hostname) || !m) return null;
  const api = `https://api.welcometothejungle.com/api/v1/organizations/${m[1]}/jobs/${m[2]}`;
  const r = await fetch(api, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`WTTJ API HTTP ${r.status}`);
  const job = (await r.json())?.job;
  if (!job) return null;
  const office = job.office || (job.offices || [])[0] || {};
  return {
    text: asText([job.description, job.profile, job.recruitment_process].filter(Boolean).join('\n')),
    title: String(job.name || ''),
    company: String(job.organization?.name || ''),
    location: [office.city, office.country].filter(Boolean).join(', '),
    datePosted: String(job.published_at || '').slice(0, 10),
    language: String(job.language || '').toLowerCase(),
    source: 'wttj-api',
  };
}

/**
 * @param {string} url
 * @param {{ html?: string }} [opts]
 */
export async function getJobDetails(url, opts = {}) {
  assertPublicUrl(url);
  const result = { text: '', title: '', company: '', location: '', datePosted: '', language: '', source: '' };

  // 0. Sites with a dedicated JSON API.
  try {
    const w = await wttjDetails(url);
    if (w?.text) return w;
  } catch { /* fall through */ }

  // 1. ATS public API (fast, exact JD text).
  try {
    const t = await fetchJdText(url);
    if (t) { result.text = t.slice(0, TEXT_CAP); result.source = 'ats-api'; }
  } catch { /* fall through to the page */ }

  // 2. The page (also gives title/company/location for the ATS case).
  let html = opts.html || '';
  if (!html) {
    try { html = (await fetchPage(url)).html; } catch (err) {
      if (!result.text) throw err;
    }
  }
  if (html) {
    const jp = jobPostingsFromJsonLd(html)[0];
    if (jp) {
      result.title ||= String(jp.title || '').trim();
      result.company ||= String(jp.hiringOrganization?.name || '').trim();
      result.location ||= jsonLdLocation(jp);
      result.datePosted ||= String(jp.datePosted || '').slice(0, 10);
      result.language ||= String(jp.inLanguage || '').toLowerCase();
      if (!result.text && jp.description) { result.text = asText(jp.description); result.source = 'json-ld'; }
    }
    const ph = phenomFromHtml(html);
    if (ph) {
      result.title ||= ph.title; result.company ||= ph.company;
      result.location ||= ph.location; result.datePosted ||= ph.datePosted;
      if (!result.text) { result.text = ph.text; result.source = 'phenom'; }
    }
    result.title ||= metaContent(html, 'og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim();
    result.company ||= metaContent(html, 'og:site_name');
    if (!result.text) {
      const t = asText(html);
      // A bot wall / JS-only shell is not a job description.
      if (t.length < 1500 && /not a robot|enable javascript|javascript is disabled|just a moment|captcha|access denied|attention required/i.test(t)) {
        result.source = 'blocked';
      } else {
        result.text = t; result.source = 'page-text';
      }
    }
    const htmlLang = html.match(/<html[^>]*\blang=["']([a-zA-Z-]+)["']/i)?.[1];
    result.language ||= (htmlLang || '').toLowerCase();
  }
  result.title = decodeHtmlEntities(result.title).replace(/\s+/g, ' ').trim();
  return result;
}
