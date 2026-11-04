# Murali Krishna Gongali Kuruva — Triage Brief

## Identity
Analytics Engineer — 3+ yrs (Microsoft Fabric, Databricks, SQL, dbt, Power BI/DAX, Azure). Saint-Germain-en-Laye, France (CET). Authorized to work in France; needs sponsorship anywhere else. English fluent, French A1. Searching France only, English-language roles only.

## Target Archetypes
| # | Archetype | What they buy (your proof) |
|---|-----------|----------------------------|
| 1 | **Analytics Engineer** | SQL/dbt models with lineage, CI/CD-ready; DAX semantic models; one definition per KPI (Sodexo) |
| 2 | **Data Engineer (Azure / Fabric / Databricks)** | ERP + Salesforce + SuccessFactors into Microsoft Fabric; ADF over Azure Data Lake; Databricks (Sodexo, InsightMetrics); DP-700 + Databricks certs |
| 3 | **BI Engineer / Power BI Developer** | Ops + FP&A Power BI dashboards; Power Automate/Apps automation; PL-300 |
| 4 | **Data Analyst (BI / FP&A / ops)** | KPI reporting, reconciliation, multi-entity consolidation |

Analog titles that count as hits: Analytics Developer, BI Consultant, Data Consultant, Reporting Engineer, Data Platform Engineer (non-SRE), DataOps Engineer.

## Proof Points (use exact metrics in matching)
- Sodexo: Power BI dashboards for operations + FP&A supporting decisions tied to a 12% operating-cost reduction and an est. 4–5% delivery-revenue improvement
- Sodexo: integrated SuccessFactors, ERP and Salesforce into Microsoft Fabric (Central Data Hub) as one governed source of truth
- InsightMetrics: SQL/Python ETL/ELT + Azure Data Factory pipelines over Azure Data Lake; Databricks/SQL datasets; validation & reconciliation for finance/ops
- Certifications: DP-700 (Fabric Data Engineer), PL-300 (Power BI Data Analyst), Databricks Data Engineer Associate

## Comp Strategy
| Target | Requirement |
|--------|-------------|
| €45–55k gross | CDI, Paris / Île-de-France, hybrid or on-site |
| €55k+ | Larger scope or freelance-equivalent |

**Soft floor: €45k (−0.5 below). Flag if clearly under €40k.**

## Location Scoring
- Paris / Île-de-France (on-site or hybrid) → **5.0**
- Remote within France → **5.0**
- Other French city, hybrid → **4.0**
- Other French city, full on-site relocation → **3.0**
- Outside France → **FAIL**

## Hard DQ Criteria — instant FAIL (< 3.0)
- JD written in French, or requires fluent / native / professional French
- Role based outside France, or requires sponsorship to a non-French location
- Requires French/EU nationality or a security clearance (e.g. defence, public-sector "fonctionnaire" posts)
- Primary skill outside the data discipline (pure SWE, SRE/infra, ML research, PhD-level data science)
- Explicitly requires 6+ years or a people-management (lead/head/manager) remit

## Quick Scoring Guide

Bands are relative to `triage_threshold` (`config/profile.yml → pipeline.triage_threshold`,
default **3.5**), matching the verdict table in `modes/triage.md`.

| Score | Verdict | What it means |
|-------|---------|---------------|
| ≥ threshold (default 3.5) | **PASS** | Clears the bar — strong archetype + comp + location, gaps bridgeable |
| 3.0 – (threshold − 0.1) | **MARGINAL** | Borderline — shown to user as one line |
| < 3.0 | **FAIL** | Does not clear the bar — filtered |

## Soft Red Flags (−0.5 each, additive)
- Stack centred on GCP/BigQuery or AWS-only with no Azure/Databricks/dbt overlap
- "Senior" title asking for 5 years (3+ yrs on CV) — bridgeable, flag it
- "French is a plus" wording
- Heavy on-call / platform-SRE duties

## Priority Override List — always return PASS regardless of score
- (none yet — add companies you have a warm intro to)
