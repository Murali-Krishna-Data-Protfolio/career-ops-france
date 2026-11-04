// Deterministic CV-match score (0-100) for Murali's profile (local customization).
// Zero tokens: runs on every new posting so notifications only fire for real
// matches. The full A-H evaluation (/career-ops pipeline) stays the judge.
//
//   title fit      0-30  (target archetype in the title)
//   skill overlap  0-60  (CV skills found in the JD, weighted)
//   location       0-10  (Paris / Île-de-France / remote France)
//   seniority      -0..-15 (JD asks clearly more years than the CV has)

// [label, regex, weight] — every skill below is on cv.md.
const SKILLS = [
  ['Power BI', /\bpower\s?bi\b/i, 3],
  ['DAX', /\bdax\b/i, 3],
  ['SQL', /\bsql\b/i, 3],
  ['dbt', /\bdbt\b/i, 3],
  ['Microsoft Fabric', /\b(microsoft\s+)?fabric\b|\bonelake\b/i, 3],
  ['Databricks', /\bdatabricks\b/i, 3],
  ['Azure', /\bazure\b/i, 3],
  ['Azure Data Factory', /\b(azure\s+)?data\s+factory\b|\badf\b/i, 2],
  ['Python', /\bpython\b/i, 3],
  ['Snowflake', /\bsnowflake\b/i, 2],
  ['Spark', /\b(py)?spark\b/i, 2],
  ['ETL/ELT', /\be(tl|lt)\b/i, 2],
  ['Data modeling', /\bdata\s+model(l)?ing\b|\bdimensional\b|\bstar\s+schema\b/i, 2],
  ['Semantic models', /\bsemantic\s+(model|layer)/i, 2],
  ['Power Query', /\bpower\s+query\b|\bm\s+language\b/i, 1],
  ['Airflow', /\bairflow\b/i, 1],
  ['Fivetran', /\bfivetran\b/i, 1],
  ['CI/CD', /\bci\s*\/\s*cd\b|\bdevops\b/i, 1],
  ['Data quality', /\bdata\s+quality\b|\bdata\s+validation\b|\breconciliation\b/i, 2],
  ['Lineage/governance', /\blineage\b|\bdata\s+governance\b/i, 1],
  ['Lakehouse/warehouse', /\blakehouse\b|\bdata\s+(warehouse|lake)\b/i, 2],
  ['KPI dashboards', /\bkpis?\b|\bdashboards?\b/i, 2],
  ['FP&A / finance', /\bfp&a\b|\bfinancial\s+planning\b|\bconsolidation\b|\bfinance\b/i, 1],
  ['Excel', /\bexcel\b/i, 1],
  ['Power Platform', /\bpower\s+(automate|apps|platform)\b/i, 1],
  ['Salesforce', /\bsalesforce\b/i, 1],
  ['SuccessFactors/ERP', /\bsuccessfactors\b|\berp\b|\bsap\b/i, 1],
];
const SKILL_FULL = 24; // weighted points that count as full coverage

const TITLE_PRIMARY = /analytics\s+engineer|data\s+engineer|\bbi\s+(engineer|developer|analyst|consultant)|power\s?bi|business\s+intelligence|data\s+analyst|analytics\s+developer|data\s+platform|dataops|reporting\s+(analyst|engineer)/i;
const TITLE_ADJACENT = /\bdata\b|\banalyst\b|\banalytics\b|\breporting\b|\bconsultant\b|\bbi\b/i;
// Titles outside the target archetypes even when they mention data.
const TITLE_OFF = /site\s+reliability|\bsre\b|devops|bioinformatic|machine\s+learning|\bml\s+engineer|\bai\s+engineer|software\s+engineer|back[- ]?end|front[- ]?end|full[- ]?stack|security|scientist|research/i;
const LOCATION_HOME = /paris|[iî]le[- ]de[- ]france|la\s+d[ée]fense|puteaux|courbevoie|nanterre|saint[- ]germain|boulogne|issy|levallois|neuilly|saint[- ]ouen|saint[- ]denis|rueil|versailles|montrouge|hauts[- ]de[- ]seine|yvelines/i;
const CV_YEARS = 3;

/** Lowest "N+ years" the JD states, or null. */
export function statedYears(text) {
  let min = null;
  for (const m of String(text).matchAll(/(\d{1,2})\s*\+?\s*(?:-|to|–)?\s*(?:\d{1,2}\s*)?(?:years?|yrs?|ans)\b/gi)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 20) min = min === null ? n : Math.min(min, n);
  }
  return min;
}

/**
 * @param {{title?: string, text?: string, location?: string}} job
 * @returns {{score: number, verdict: 'strong'|'match'|'low', hits: string[], gaps: string[], parts: object}}
 */
export function scoreJob(job) {
  const title = String(job.title || '');
  const text = `${title}\n${job.text || ''}`;
  const titleFit = TITLE_OFF.test(title) ? -10 : TITLE_PRIMARY.test(title) ? 30 : TITLE_ADJACENT.test(title) ? 15 : 0;

  let pts = 0;
  const hits = [];
  for (const [label, re, w] of SKILLS) {
    if (re.test(text)) { pts += w; hits.push(label); }
  }
  const skill = Math.round(Math.min(1, pts / SKILL_FULL) * 60);

  const loc = String(job.location || '');
  const location = LOCATION_HOME.test(loc) || (/remote/i.test(loc) && /france/i.test(loc)) ? 10 : /france/i.test(loc) ? 5 : 0;

  const yrs = statedYears(job.text || '');
  const seniority = yrs === null ? 0 : yrs >= 7 ? -15 : yrs >= 5 ? -5 : 0;

  const score = Math.max(0, Math.min(100, titleFit + skill + location + seniority));
  const verdict = score >= 70 ? 'strong' : score >= 55 ? 'match' : 'low';
  // Common data-stack skills NOT on the CV that the JD asks for (for the alert).
  const gaps = [
    ['GCP/BigQuery', /\bbigquery\b|\bgcp\b/i], ['AWS', /\baws\b|\bredshift\b/i], ['Tableau', /\btableau\b/i],
    ['Looker', /\blooker\b/i], ['Kafka', /\bkafka\b/i], ['Scala', /\bscala\b/i], ['Java', /\bjava\b/i],
  ].filter(([, re]) => re.test(text)).map(([l]) => l);
  return { score, verdict, hits, gaps, parts: { titleFit, skill, location, seniority, statedYears: yrs, cvYears: CV_YEARS } };
}
