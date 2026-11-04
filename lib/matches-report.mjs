// MATCHES.md — phone-friendly view of current matches, rendered by GitHub
// (private repo: only you can open it). Rebuilt after every run.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadMatches, priorityCompanies } from './job-store.mjs';
import { THRESHOLD } from './job-intake.mjs';

const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim();

export function writeMatchesReport() {
  const all = loadMatches();
  const rank = (a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || (b.score ?? 0) - (a.score ?? 0);
  const open = all.filter((m) => m.isMatch && m.status === 'new').sort(rank);
  const applied = all.filter((m) => m.status === 'applied').sort(rank);
  const other = all.filter((m) => !m.isMatch && !m.englishIssue && m.status === 'new').sort(rank);
  const rejected = all.filter((m) => m.englishIssue).length;
  const row = (m) => `| ${m.priority ? '⭐ ' : ''}**${m.score}** | ${cell(m.company)} | [${cell(m.title)}](${m.url}) | ${cell(m.location || 'France')} | ${cell(m.posted || String(m.addedAt || '').slice(0, 10))} | ${cell((m.hits || []).slice(0, 6).join(', '))} |`;
  const table = (list) => list.length
    ? ['| Score | Company | Role | Location | Date | CV skills found |', '|---:|---|---|---|---|---|', ...list.map(row)].join('\n')
    : '_None._';
  const md = [
    '# Job matches — Murali Krishna',
    '',
    `France · English-only · data roles · updated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`,
    '',
    `Priority sources (scanned first): ${priorityCompanies().map((c) => c.name).join(', ') || '—'}. Alert threshold: ${THRESHOLD.normal}/100 (${THRESHOLD.priority} for priority sources).`,
    '',
    `## ✅ Open matches (${open.length})`, '', table(open), '',
    `## 📨 Applied (${applied.length})`, '', table(applied), '',
    `<details><summary>Below threshold (${other.length}) · rejected as French / French required: ${rejected}</summary>`, '', table(other), '', '</details>', '',
    'Mark Applied / Dismiss in the local Job Inbox (http://localhost:4317) — it syncs back here.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, 'MATCHES.md'), md, 'utf8');
  return { open: open.length };
}
