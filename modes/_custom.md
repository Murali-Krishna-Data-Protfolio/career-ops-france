# Custom Instructions -- career-ops

<!-- ============================================================
     THIS FILE IS YOURS. It will NEVER be auto-updated.

     Put your own house rules, custom workflows, and automations
     here -- anything you want the agent to ALWAYS do (or never do).

     This is for PROCEDURAL rules ("HOW I want things done").
     For WHO you are (archetypes, narrative, comp, negotiation),
     use modes/_profile.md instead. Keeping the two separate keeps
     each one readable.

     The agent reads this file alongside the system instructions;
     your rules here take precedence over the defaults, as long as
     they don't break the Data Contract (your files are never
     touched, and we never auto-submit an application for you).

     Because this is a user-layer file, anything you write here
     survives `node update-system.mjs`. Put customizations HERE,
     not in CLAUDE.md / modes/_shared.md / other system files --
     those get overwritten on update.
     ============================================================ -->

## House Rules

<!-- Rules the agent should always follow. Examples:
     - Always write evaluation summaries in British English.
     - Never include a photo in my CV (US / ATS-first market).
     - Cap each batch run at 20 listings unless I say otherwise.
     - If a report scores below 4.0/5, skip the cover letter. -->

- **STRICT ENGLISH-ONLY.** Before evaluating any posting (scan, pipeline, batch, pasted URL/JD), read the JD and check its language:
  - JD written in French (even partly, e.g. a French-only requirements section) → do NOT evaluate. Mark it `SKIP` with reason "French-language JD" and move on.
  - JD in English but requiring French (fluent, native, professional, business, C1/B2, bilingual) → do NOT evaluate. `SKIP` with reason "French required".
  - "French is a plus / nice to have / an advantage" → OK, evaluate normally (−0.5 at most).
  - Language cannot be determined (JD unreadable) → ask me before evaluating.
- **France only.** Any role located outside France → `SKIP` ("outside France"). Never suggest US / UK / other-country roles or companies.
- All generated material (reports, CVs, cover letters, emails, interview prep) is written in **English**. Never produce a French version unless I explicitly ask.

## Custom Workflows

<!-- Multi-step routines you run often, given a short name. Examples:
     - "weekly review": scan my saved portals, evaluate the new roles,
       then give me a one-paragraph summary of the top 3.
     - "prep <company>": pull the JD, generate STAR stories from
       article-digest.md, and draft 5 likely interview questions. -->

(none yet -- add yours above)

## Output Preferences

<!-- How you like results formatted. Examples:
     - Reports: lead with the score and the one-line verdict.
     - Show the per-step token breakdown after a batch run.
     - Save PDFs date-first: YYYY-MM-DD-company.pdf -->

(none yet -- add yours above)

## Off-Limits

<!-- Things the agent must never do for you. Examples:
     - Never auto-fill or submit an application without showing me first.
     - Never edit a system file to customize my setup -- put it here. -->

(none yet -- add yours above)
