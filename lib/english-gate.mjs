// English-only gate (local customization, France/English search profile).
//
// Runs on NEW offers after the scan's other filters. For each offer it decides
// whether the posting is an English-language role that does not require French:
//   1. Provider-reported language (e.g. WTTJ `language`): non-English -> drop.
//   2. Full JD text (ATS public API via jd-years.fetchJdText, else the
//      provider's listing description): French-dominant text -> drop.
//   3. English text that REQUIRES French (fluent / native / professional /
//      C1 / bilingual) -> drop. "French is a plus / nice to have" is kept.
//   4. No language and no readable text -> `unknown` policy (default drop).
//
// Configure in portals.yml:
//   english_only:
//     enabled: true
//     unknown: drop        # or keep
//     max_french_share: 0.3  # French share of stopwords above which text is French

import { getJobDetails } from './jd-text.mjs';

const FR_WORDS = new Set([
  'le', 'la', 'les', 'des', 'du', 'et', 'est', 'une', 'pour', 'dans', 'nous', 'vous',
  'avec', 'sur', 'qui', 'que', 'aux', 'au', 'cette', 'ces', 'sont', 'votre', 'vos',
  'notre', 'nos', 'être', 'pas', 'où', 'leur', 'leurs', 'chez', 'afin', 'ainsi',
  'également', 'sein', 'équipe', 'poste', 'missions', 'profil', 'expérience',
  'connaissances', 'compétences', 'nouveaux', 'mise', 'données', 'avez', 'êtes',
]);
const EN_WORDS = new Set([
  'the', 'and', 'of', 'to', 'with', 'for', 'you', 'we', 'our', 'your', 'is', 'are',
  'will', 'this', 'that', 'be', 'an', 'have', 'from', 'by', 'who', 'what', 'their',
  'team', 'experience', 'skills', 'role', 'about', 'work', 'or', 'at', 'it', 'data',
  'help', 'build', 'join', 'looking', 'strong',
]);

// English phrasings that make French a requirement.
const FRENCH_REQUIRED = [
  'fluent in french', 'fluency in french', 'french fluency', 'fluent french',
  'native french', 'french native', 'native-level french', 'native level french',
  'french is mandatory', 'french is required', 'french is a must', 'french is essential',
  'french (fluent', 'french (native', 'french (c1', 'french c1', 'french (b2', 'french b2',
  'proficient in french', 'proficiency in french', 'professional proficiency in french',
  'professional level of french', 'professional french', 'business french',
  'business-level french', 'excellent french', 'strong french', 'good command of french',
  'bilingual french', 'bilingual in french', 'bilingual english/french',
  'bilingual english-french', 'bilingual french/english', 'bilingual french-english',
  'bilingual (french', 'french and english are required', 'english and french are required',
  'fluent in both french and english', 'fluent in english and french',
  'fluent in french and english', 'fluent english and french', 'fluent french and english',
  'speak french', 'written and spoken french', 'french speaker', 'french-speaking',
];
// Wording right after a match that turns it into a nice-to-have.
const OPTIONAL_NEAR = /\b(plus|bonus|nice[ -]to[ -]have|advantage|asset|preferred|appreciated|desirable|not required|optional|is welcome)\b/;

/** @param {string} text */
export function frenchShare(text) {
  let fr = 0;
  let en = 0;
  for (const w of String(text).toLowerCase().match(/[\p{L}']+/gu) || []) {
    if (FR_WORDS.has(w)) fr++;
    else if (EN_WORDS.has(w)) en++;
  }
  const total = fr + en;
  return { fr, en, total, share: total ? fr / total : 0 };
}

/** @param {string} text @returns {string|null} quoted requirement, or null */
export function frenchRequirement(text) {
  const lower = String(text).toLowerCase().replace(/\s+/g, ' ');
  for (const p of FRENCH_REQUIRED) {
    let i = lower.indexOf(p);
    while (i !== -1) {
      const after = lower.slice(i + p.length, i + p.length + 80);
      const before = lower.slice(Math.max(0, i - 40), i);
      if (!OPTIONAL_NEAR.test(after) && !/\b(plus|bonus|nice to have)\b[^.]*$/.test(before)) {
        return lower.slice(Math.max(0, i - 30), i + p.length + 40).trim();
      }
      i = lower.indexOf(p, i + p.length);
    }
  }
  return null;
}

/**
 * @template {{url: string, language?: string, description?: string}} T
 * @param {T[]} offers
 * @param {{enabled?: boolean, unknown?: 'drop'|'keep', max_french_share?: number}} cfg
 * @param {{fetchJd?: (url: string) => Promise<string|null>, concurrency?: number}} [deps]
 * @returns {Promise<{kept: T[], dropped: Array<T & {englishGate: {reason: string}}>}>}
 */
export async function applyEnglishGate(offers, cfg = {}, deps = {}) {
  const unknownPolicy = cfg.unknown === 'keep' ? 'keep' : 'drop';
  const maxShare = typeof cfg.max_french_share === 'number' ? cfg.max_french_share : 0.3;
  // Full JD from the ATS API or the posting page (JSON-LD / Phenom / page text).
  const fetchJd = deps.fetchJd || (async (url) => (await getJobDetails(url)).text || null);
  const results = new Array(offers.length);
  let cursor = 0;

  async function judge(offer) {
    const lang = typeof offer.language === 'string' ? offer.language.trim().toLowerCase() : '';
    if (lang && !lang.startsWith('en')) return `posting language "${lang}"`;
    let text = null;
    try { text = await fetchJd(offer.url); } catch { /* fall back to listing text */ }
    if (!text && typeof offer.description === 'string' && offer.description.trim()) text = offer.description;
    if (text) {
      const s = frenchShare(text);
      if (s.total >= 8 && s.share > maxShare) {
        return `JD is in French (${Math.round(s.share * 100)}% French stopwords)`;
      }
      const req = frenchRequirement(text);
      if (req) return `requires French: "…${req}…"`;
      if (s.total >= 8 || lang) return null;
    } else if (lang) {
      return null; // provider says English, nothing to contradict it
    }
    return unknownPolicy === 'drop' ? 'language could not be verified (no JD text)' : null;
  }

  async function worker() {
    while (cursor < offers.length) {
      const i = cursor++;
      results[i] = await judge(offers[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(deps.concurrency || 4, offers.length) }, worker));

  const kept = [];
  const dropped = [];
  offers.forEach((o, i) => (results[i] ? dropped.push({ ...o, englishGate: { reason: results[i] } }) : kept.push(o)));
  return { kept, dropped };
}
