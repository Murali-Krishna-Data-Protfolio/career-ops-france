// Local job store for the daily run + Job Inbox UI (local customization).
//   data/matches.json      every scored posting (scan, manual paste, watched page)
//   data/watch-pages.json  careers pages with no scanner provider, watched by link diff
//   data/pipeline.md       the career-ops inbox (manual jobs appended here too)
//   portals.yml            careers sites added from the UI (priority: true)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { buildTitleFilter } from '../title-keywords.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
// One JSON record per line (+ updatedAt). Git merges it with `merge=union`
// (.gitattributes), so cloud and local edits never conflict; on read, the
// newest record per URL wins.
const MATCHES = path.join(DATA, 'matches.jsonl');
const LEGACY_MATCHES = path.join(DATA, 'matches.json');
const WATCH = path.join(DATA, 'watch-pages.json');
const PIPELINE = path.join(DATA, 'pipeline.md');
const PORTALS = path.join(ROOT, 'portals.yml');

function readJson(file, fallback) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return fallback; }
  // Strip a UTF-8 BOM; an existing-but-unreadable file is an error, never "empty"
  // (treating it as empty would let the next save wipe it).
  return JSON.parse(raw.replace(/^﻿/, ''));
}
function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ── matches ─────────────────────────────────────────────────────────
export function loadMatches() {
  let lines = [];
  try { lines = fs.readFileSync(MATCHES, 'utf8').replace(/^﻿/, '').split(/\r?\n/); } catch {
    const legacy = readJson(LEGACY_MATCHES, null); // one-time migration
    if (Array.isArray(legacy)) { saveMatches(legacy); fs.rmSync(LEGACY_MATCHES, { force: true }); return legacy; }
    return [];
  }
  const byUrl = new Map();
  for (const l of lines) {
    if (!l.trim() || l.startsWith('<<<<<<<') || l.startsWith('=======') || l.startsWith('>>>>>>>')) continue;
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    if (!r?.url) continue;
    const prev = byUrl.get(r.url);
    if (!prev || String(r.updatedAt || r.addedAt || '') >= String(prev.updatedAt || prev.addedAt || '')) byUrl.set(r.url, r);
  }
  return [...byUrl.values()];
}
export function saveMatches(list) {
  const sorted = [...list].sort((a, b) => String(a.addedAt || '').localeCompare(String(b.addedAt || '')) || a.url.localeCompare(b.url));
  const tmp = `${MATCHES}.tmp`;
  fs.writeFileSync(tmp, sorted.map((r) => JSON.stringify(r)).join('\n') + (sorted.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, MATCHES);
}
export function upsertMatch(rec) {
  const list = loadMatches();
  const now = new Date().toISOString();
  const i = list.findIndex((m) => m.url === rec.url);
  if (i >= 0) list[i] = { ...list[i], ...rec, status: list[i].status || rec.status, addedAt: list[i].addedAt || rec.addedAt, updatedAt: now };
  else list.push({ status: 'new', ...rec, updatedAt: now });
  saveMatches(list);
  return i >= 0 ? list[i] : list[list.length - 1];
}
export function setStatus(url, status) {
  const list = loadMatches();
  const m = list.find((x) => x.url === url);
  if (m) { m.status = status; m.updatedAt = new Date().toISOString(); saveMatches(list); }
  return Boolean(m);
}
export function markNotified(urls, channel = 'cloud') {
  const list = loadMatches();
  const now = new Date().toISOString();
  for (const m of list) if (urls.includes(m.url)) { m.notified = { ...(m.notified || {}), [channel]: now }; m.updatedAt = now; }
  saveMatches(list);
}

// ── pipeline.md ─────────────────────────────────────────────────────
/** Parsed `- [ ] url | company | title | location | …` lines. */
export function pipelineEntries() {
  let text = '';
  try { text = fs.readFileSync(PIPELINE, 'utf8'); } catch { return []; }
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^- \[([ xX])\] (https?:\/\/\S+)(.*)$/);
    if (!m) continue;
    const parts = m[3].split('|').map((s) => s.trim()).filter(Boolean);
    out.push({ done: m[1] !== ' ', url: m[2], company: parts[0] || '', title: parts[1] || '', location: parts[2] || '', extra: parts.slice(3) });
  }
  return out;
}
export function appendPipeline({ url, company, title, location, note }) {
  if (pipelineEntries().some((e) => e.url === url)) return false;
  let text = fs.existsSync(PIPELINE) ? fs.readFileSync(PIPELINE, 'utf8') : '# Pipeline — Pending URLs\n\n## Pending\n\n## Processed\n';
  const clean = (s) => String(s || '').replace(/[|\r\n]+/g, ' ').trim();
  const line = `- [ ] ${url} | ${clean(company) || 'Unknown'} | ${clean(title) || 'Untitled'} | ${clean(location) || 'France'} | ${clean(note)}`;
  const idx = text.indexOf('## Processed');
  text = idx >= 0 ? `${text.slice(0, idx).replace(/\s*$/, '\n')}${line}\n\n${text.slice(idx)}` : `${text.replace(/\s*$/, '\n')}${line}\n`;
  fs.writeFileSync(PIPELINE, text, 'utf8');
  return true;
}

// ── portals.yml ─────────────────────────────────────────────────────
export const loadPortals = () => yaml.load(fs.readFileSync(PORTALS, 'utf8')) || {};
export function priorityCompanies() {
  return (loadPortals().tracked_companies || []).filter((c) => c.priority === true && c.enabled !== false);
}
export function titleFilter() {
  return buildTitleFilter(loadPortals().title_filter);
}
/** Is a company (by display name) a priority source? */
export function isPriority(company) {
  const c = String(company || '').toLowerCase();
  if (!c) return false;
  const names = priorityCompanies().map((p) => p.name.toLowerCase());
  const watch = loadWatchPages().map((w) => w.name.toLowerCase());
  return [...names, ...watch].some((n) => c.includes(n.split(/\s+/)[0]) || n.includes(c));
}
// Shared ATS hosts: the company is the first path segment, not the host.
const SHARED_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|recruitee\.com|teamtailor\.com|personio\.(de|com)|myworkdayjobs\.com|welcometothejungle\.com)$/i;
/** Comparable key for a careers site: branded host, or ATS host + company slug. */
export function siteKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const seg = u.pathname.split('/').filter(Boolean)[0] || '';
    return SHARED_HOSTS.test(host) ? `${host}/${seg.toLowerCase()}` : host;
  } catch { return String(url); }
}
export function hasCompany(name, careersUrl) {
  const all = loadPortals().tracked_companies || [];
  const key = careersUrl ? siteKey(careersUrl) : null;
  return all.some((c) => c.name.toLowerCase() === name.toLowerCase() || (key && siteKey(c.careers_url) === key));
}
/** Append a tracked company under the "Priority" block (keeps comments intact). */
export function addTrackedCompany(entry) {
  let text = fs.readFileSync(PORTALS, 'utf8');
  const marker = '  # -- Priority sources (added from Job Inbox / scanned first) --';
  const q = (s) => JSON.stringify(String(s));
  const lines = [
    `  - name: ${q(entry.name)}`,
    `    careers_url: ${entry.careers_url}`,
    ...(entry.provider ? [`    provider: ${entry.provider}`] : []),
    ...(entry.phenom ? ['    phenom:', `      urlPrefix: ${entry.phenom.urlPrefix}`, `      selectedFields: { country: ["France"] }`] : []),
    `    notes: ${q(entry.notes || `Added from Job Inbox ${new Date().toISOString().slice(0, 10)}`)}`,
    '    priority: true',
    '    enabled: true',
  ].join('\n');
  if (!text.includes(marker)) {
    text = text.replace(/^tracked_companies:\s*$/m, `tracked_companies:\n\n${marker}\n`);
  }
  text = text.replace(marker, `${marker}\n${lines}\n`);
  yaml.load(text); // throws on a broken edit — nothing written then
  fs.writeFileSync(PORTALS, text, 'utf8');
}

// ── watched pages (sites no scanner provider understands) ───────────
export const loadWatchPages = () => readJson(WATCH, []);
export const saveWatchPages = (list) => writeJson(WATCH, list);
