# CyberTip Triage — Agent Context

This file is the primary context document for any AI agent (Claude or otherwise) contributing to this codebase. Read this before writing any code.

## What this system is

Law enforcement ICAC (Internet Crimes Against Children) tip triage system. Processes NCMEC CyberTips through an 8-agent AI pipeline to classify, score, and route child exploitation reports to the correct investigative unit.

**⚠ This system directly affects real investigations of crimes against children. Legal compliance is not optional. Performance matters because investigators' response time matters.**

---

## Required reading before any change

| Document | When to read |
|----------|-------------|
| **[USER_JOURNEYS.md](./USER_JOURNEYS.md)** | Before any change to pipeline, API routes, dashboard, or legal logic. This is the ground truth for what investigators actually need. |
| **[AUDIT_REPORT.md](./AUDIT_REPORT.md)** | Before adding tests — gap analysis already done, don't duplicate work. |
| **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** | Before changing environment config or ingestion sources. |

---

## Architecture at a glance

```
Ingestion Sources          Queue (BullMQ/in-memory)      8-Agent Pipeline
─────────────────          ────────────────────────      ────────────────
NCMEC IDS Portal      ──▶  enqueueTip()            ──▶  1. Intake Agent (haiku)
NCMEC XML API              bundle_dedup.ts               2. Legal Gate (opus)  ← Wilson/4th Amendment
ESP Direct                 (viral dedup before enqueue)   3. Extraction + Hash/OSINT (haiku, parallel)
Email Inbox                                               4. Classifier + Linker (opus+sonnet, parallel)
VPN Portal                                                5. Priority Agent (opus)  → score/tier/alert
Inter-Agency                                                    │
                                                          PostgreSQL / in-memory
                                                                │
                                                          Dashboard (React SSE)
```

---

## Non-negotiable legal invariants

These are enforced deterministically. LLM output CANNOT override them. Touch with extreme care.

### 1. Wilson v. US (9th Cir. 2021) — Fourth Amendment file access

**Rule:** If `esp_viewed = false` (or missing), the file is blocked until a warrant is granted.

```typescript
// src/compliance/wilson.ts — THE authority
computeWarrantRequired(file)      // deterministic: true/false based on esp_viewed, esp_viewed_missing, publicly_available
computeFileAccessBlocked(file)    // deterministic: blocked unless warrant_status === 'granted'
assertFileAccessible(file)        // throws WilsonBlockedError if blocked — use before any file read
```

**In legal_gate.ts:** Step 7 merges LLM output but ALWAYS uses deterministic values for `file_access_blocked` and `warrant_required`. The LLM enriches; it does not decide.

**9th Circuit applies to:** AK, AZ, CA, HI, ID, MT, NV, OR, WA  
**Other circuits:** Conservative Wilson applied until binding precedent recorded (see `circuit_guide.ts`)

### 2. Sextortion + victim crisis → P1_CRITICAL always

```typescript
// src/orchestrator.ts - applyCriticalOverrides()
// CSAM + confirmed minor victim → P1_CRITICAL even if LLM scored lower
// sextortion_victim_in_crisis = true → score floor 90, tier = IMMEDIATE
```

### 3. AIG-CSAM — never reduces severity

AI-generated CSAM is charged under **18 U.S.C. § 1466A** (no real victim needed). Severity is never reduced. Flag it with `aig_csam_flag = true`.

### 4. Audit trail is append-only

Every agent action AND every human action (warrant update, assign, preservation issue) MUST call:
```typescript
appendAuditEntry({ tip_id, agent, timestamp, status, summary, ... })
```

Never delete or modify audit entries. Chain of custody for criminal prosecution depends on this.

### 5. REPORT Act 2024 — "apparent" CSAM

Count and process "reasonably apparent" CSAM (AI/ML detected), not just hash-confirmed CSAM. See `compliance/statutes.ts` REPORT_ACT_2024.

---

## Key files — what does what

```
src/
├── orchestrator.ts              ← Main pipeline controller. 5-stage, read this first.
├── agents/
│   ├── intake.ts                ← Stage 1: normalize raw tip via LLM
│   ├── legal_gate.ts            ← Stage 2: Wilson compliance + circuit analysis (CRITICAL)
│   ├── extraction.ts            ← Stage 3a: extract entities from tip body
│   ├── hash_osint.ts            ← Stage 3b: check hash watchlists, OSINT
│   ├── classifier.ts            ← Stage 4a: offense category, severity, statutes
│   ├── linker.ts                ← Stage 4b: deconfliction, related tips, cluster links
│   └── priority.ts              ← Stage 5: score 0–100, tier, routing, alerts
├── compliance/
│   ├── wilson.ts                ← Fourth Amendment enforcement (deterministic)
│   ├── circuit_guide.ts         ← Per-circuit legal guidance + precedent registry
│   ├── statutes.ts              ← All applicable statutes + CIRCUIT_PRECEDENT_MAP
│   ├── audit.ts                 ← Append-only audit log
│   └── prompt-guards.ts         ← Prompt injection detection
├── db/
│   ├── tips.ts                  ← PostgreSQL + in-memory CRUD. All data access here.
│   ├── precedents.ts            ← Legal precedent + circuit rule override persistence (migration 003)
│   └── migrations/
│       ├── 001_initial.sql      ← Core schema (tips, files, preservation, audit_log)
│       ├── 002_officers.sql     ← Officers, warrant_applications, revoked_tokens
│       └── 003_legal_precedents.sql ← legal_precedents + circuit_rule_overrides (P0 fix)
├── ingestion/
│   ├── ids_portal.ts            ← NCMEC IDS Portal poller (TOTP auth, ZIP extraction)
│   ├── bundle_dedup.ts          ← Viral incident deduplication (run before enqueue)
│   └── queue.ts                 ← BullMQ (prod) + in-memory (dev/test) queue
├── jobs/
│   └── cluster_scan.ts          ← Nightly temporal clustering (5 pattern types, 90-day window)
├── tools/
│   ├── legal/
│   │   ├── mlat_generator.ts    ← MLAT + CLOUD Act request generation (14 countries)
│   │   ├── warrant_affidavit.ts ← Warrant application affidavit generator
│   │   └── warrant_workflow.ts  ← Warrant lifecycle management
│   ├── preservation/
│   │   └── letter_pdf.ts        ← § 2703(f) preservation letter PDF generation
│   ├── reporting/
│   │   └── ojjdp_export.ts      ← Quarterly OJJDP statistical report
│   ├── alerts/
│   │   └── alert_tools.ts       ← Email (nodemailer) + SMS (Twilio) alerts
│   └── hash/
│       └── check_watchlists.ts  ← PhotoDNA, Project VIC, IWF, Interpol ICSE
├── api/
│   ├── routes.ts                ← Main REST API (queue, tips, MLAT, clusters, circuit)
│   ├── tier3_routes.ts          ← Hash integration management endpoints
│   └── setup_routes.ts          ← Configuration wizard endpoints
└── auth/
    └── tier2_routes.ts          ← Warrant workflow, OJJDP reports, preservation PDF download
```

---

## Known remaining gaps (lower priority)

See `USER_JOURNEYS.md` P1/P2 tables for full context. Remaining items:

- No shift-change overnight digest email for supervisors
- Mobile: no "Assign to me" button  
- Cluster list view missing from tier4 admin (no grouped cluster display)
- PDF parser doesn't validate field presence after NCMEC format parsing

**All P0 issues are resolved.** All P1 issues from the 2026-02-19 investigation are resolved.

---

## Development rules

1. **Wilson enforcement is deterministic** — don't make it LLM-driven.
2. **Every human action needs an audit entry** — `appendAuditEntry()`.
3. **Tests live in `src/__tests__/`** — use vitest + supertest. Mock Anthropic with `vi.mock('@anthropic-ai/sdk')`.
4. **In-memory fallback must stay working** — dev/test mode requires no external services.
5. **New legal features must be documented in USER_JOURNEYS.md** — if it's not in a journey, investigators won't find it.
6. **Bundle dedup before enqueue** — check `checkBundleDuplicate()` before adding to queue, not after.
7. **MLAT: always generate preservation draft first** — Budapest Article 16 before disclosure request.
8. **Cluster escalation must write audit entry** — supervisors need chain of custody on tier changes.

---

## Tier implementation status

| Tier | Feature | Status |
|------|---------|--------|
| Tier 1 | PostgreSQL, IDS Portal auth, alert channels | ✅ Complete |
| Tier 2 | Preservation letter PDF, warrant affidavit, OJJDP reporting, JWT auth | ✅ Complete |
| Tier 3 | Hash integrations (PhotoDNA, Project VIC, IWF, Interpol), bundle dedup, mobile dashboard | ✅ Complete |
| Tier 4 | Multi-circuit legal guidance, temporal clustering, MLAT workflow | ✅ Complete |

---

## Testing

```bash
npm run typecheck    # tsc --noEmit — must be clean before any PR
npm test             # vitest run — all tests must pass
npm run test:coverage # coverage report
```

Tests require no external services in default mode (`DB_MODE` defaults to in-memory, Anthropic mocked).

Test files: `src/__tests__/*.test.ts` and `src/agents/__tests__/*.test.ts`
Fixtures: `src/__tests__/fixtures.ts` — 225 synthetic tips across 15 categories.

---

*Last updated: 2026-02-19*
