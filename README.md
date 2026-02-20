# CyberTip Triage System

[Watch the CyberTip Triage Investigator Demo](https://akshayjava.github.io/CyberTip-triage/assets/walkthrough.mp4)

Automated ICAC CyberTip triage pipeline for law enforcement. Routes tips from NCMEC and ESPs through an 8-agent AI pipeline to score, classify, and route to the appropriate investigative unit.

> **⚠ Law Enforcement Use Only.** This system handles CSAM reports and is designed for authorized ICAC task forces. All access requires appropriate law enforcement credentials.

---

## Architecture

```
NCMEC IDS Portal ──┐  (TOTP + ZIP, real auth ✅)
NCMEC API ──────────┤  (XML poll)
ESP Direct ─────────┼──▶ BullMQ/In-Memory Queue
Email Inbox ────────┤
VPN Portal ─────────┤       │
Inter-Agency ───────┘       ▼

                     Orchestrator (5-stage pipeline)
                         │
                         ├─ Stage 1: Intake Agent         (haiku)
                         ├─ Stage 2: Extraction Agent     (haiku)  ┐ parallel
                         │           Hash & OSINT Agent   (haiku)  ┘
                         ├─ Stage 3: Legal Gate Agent     (opus)   ← Wilson/4th Amendment
                         ├─ Stage 4: Classifier Agent     (opus)   ┐ parallel
                         │           Linker Agent         (sonnet) ┘
                         └─ Stage 5: Priority Agent       (opus)   → score/route/alert
                                         │
                              upsertTip() → PostgreSQL ✅
                                         │
                              SSE → Dashboard (real-time)
```

---

## Quickstart

```bash
# 1. Install dependencies (requires network access)
npm install

# 2. Configure
cp .env.example .env
# Edit .env — at minimum set ANTHROPIC_API_KEY

# 3. Typecheck
npm run typecheck

# 4. Run tests
npm test

# 5. Start (dev mode — in-memory DB/queue, no Postgres/Redis needed)
npm run dev

# Dashboard:  http://localhost:3000/dashboard
# Setup:      http://localhost:3000/dashboard/setup.html
# Status:     http://localhost:3000/dashboard/status.html
# Demo:       http://localhost:3000/dashboard/demo.html
```

**For production** (PostgreSQL + Redis + real credentials):
```bash
DB_MODE=postgres \
REDIS_URL=redis://localhost:6379 \
DATABASE_URL=postgresql://user:pass@localhost:5432/cybertip \
npm start
```

---

## Investigator User Journeys

Before modifying any pipeline stage, API route, or dashboard component, read:

📋 **[USER_JOURNEYS.md](./USER_JOURNEYS.md)** — Ground-truth walkthrough of all 10 critical ICAC investigator workflows, including verified gaps, development rules, and the legal invariants that must never change.

---

## Implementation Status

### ✅ Tier 1 — Production Blockers (Complete)

| Feature | File | Notes |
|---------|------|-------|
| PostgreSQL persistence | `src/db/tips.ts` | upsertTip, getTipById, listTips, warrant/preservation tracking |
| IDS Portal auth | `src/ingestion/ids_portal.ts` | TOTP (otplib), ZIP extraction (adm-zip), exponential backoff |
| Real email alerts | `src/tools/alerts/alert_tools.ts` | nodemailer (SMTP/SendGrid/SES) |
| Real SMS alerts | `src/tools/alerts/alert_tools.ts` | Twilio — victim crisis only |
| 365-day preservation | `src/tools/preservation/esp_retention.ts` | REPORT Act 2024 compliance |
| ONLINE_ENTICEMENT | `src/models/classification.ts` | REPORT Act 2024 mandatory category |

> **One remaining gate:** `npm install` in a network-connected environment installs the 7 new packages (nodemailer, twilio, otplib, adm-zip, node-fetch, p-retry, p-queue). All code is written; type shims cover compilation until then.

### 🔜 Tier 2 — High Operational Value (Next Sprint)

| Feature | File | What it does |
|---------|------|-------------|
| Preservation letter PDF | `src/tools/preservation/letter_generator.ts` | Auto-populates 18 U.S.C. § 2703(f) letters from extracted tip data |
| Warrant workflow | `src/tools/legal/warrant_workflow.ts` | Tracks warrant status; auto-unblocks files when granted |
| OJJDP grant metrics | `src/tools/reporting/ojjdp_export.ts` | Quarterly federal reporting — tips, arrests, forensic exams |
| Investigator accounts | `src/auth/` | JWT auth, role enforcement at API layer, caseload assignment rules |

### 🔜 Tier 3 — Triage Quality (Following Sprint)

| Feature | File | What it does |
|---------|------|-------------|
| Real hash integrations | `src/tools/hash/` | Live Project VIC / IWF / NCMEC / Interpol ICSE queries |
| NCMEC bundle handling | `src/agents/intake.ts` | Dedup thousands of viral-content reports into one canonical tip |
| Mobile dashboard | `dashboard/index.html` | Focused on-call view for IMMEDIATE/URGENT tier only |

### 🔜 Tier 4 — Strategic / Future

| Feature | File | What it does |
|---------|------|-------------|
| Multi-circuit legal guide | `src/compliance/circuit_guide.ts` | Per-circuit Wilson application with case law citations |
| Pattern clustering | `src/jobs/cluster_scan.ts` | Nightly job detects slow-building school/platform clusters |
| MLAT workflow | `src/tools/legal/mlat_generator.ts` | Pre-fills Mutual Legal Assistance Treaty requests for international subjects |

---

## Key Design Decisions

### Wilson Ruling Compliance
Every file in every tip has `file_access_blocked` enforced by the Legal Gate Agent before any downstream processing. If `esp_viewed=false` and no warrant is on file, the file is **hard blocked** — no agent accesses its content under any circumstances. The `esp_viewed_missing=true` flag (when NCMEC Section A omits the field) is treated identically to `esp_viewed=false`. See `src/compliance/wilson.ts`.

### REPORT Act 2024
All ESPs subject to 18 U.S.C. § 2258A must preserve CyberTip report contents for 365 days minimum (up from 90 days, effective May 7 2024). `REPORT_ACT_MIN_DAYS = 365` is the floor in `esp_retention.ts`. Two new mandatory offense categories (`ONLINE_ENTICEMENT`, `CHILD_SEX_TRAFFICKING`) are distinct classifier outputs.

### Prompt Injection Hardening
All tip body text is wrapped in `<tip_content>` XML delimiters before any LLM call. Injection patterns are detected and logged. Tip content cannot override system prompt instructions. The Legal Gate hard-blocks any tip whose body attempts to override agent instructions. See `src/compliance/prompt-guards.ts`.

### Append-Only Audit Log
Every agent action and every human action is written to an append-only audit log. A PostgreSQL trigger (`prevent_audit_modification`) and a database rule (`audit_log_no_update`) independently block any modification. No record can be modified or deleted — this is the chain of custody. See `src/compliance/audit.ts`.

### Human-in-the-Loop
The AI pipeline produces **drafts and recommendations only**. Humans must approve:
- Warrant applications and grants (Tier 2.2)
- Preservation request issuance (existing)
- Tip assignment to investigators (existing)
- De-confliction coordination (existing — PAUSED tier)
- Crisis intervention dispatch (existing — supervisor confirmation)

---

## Agent Models

| Agent | Model | Rationale |
|-------|-------|-----------|
| Intake | `claude-haiku-4-5-20251001` | High volume, format detection, low complexity |
| Extraction | `claude-haiku-4-5-20251001` | High volume, structured output |
| Hash & OSINT | `claude-haiku-4-5-20251001` | Tool dispatch, minimal reasoning |
| Legal Gate | `claude-opus-4-6` | High-stakes compliance, agentic tool loop |
| Classifier | `claude-opus-4-6` | Nuanced child safety categorization |
| Linker | `claude-sonnet-4-6` | Entity graph reasoning, DB-intensive |
| Priority | `claude-opus-4-6` | Multi-factor scoring with tool calls |
| Query Agent *(Tier 2)* | `claude-sonnet-4-6` | NL search, streaming, investigative synthesis |
| Report Agent *(Tier 2)* | `claude-opus-4-6` | Long-form court/OJJDP reports |

---

## External Credentials Required for Production

| Service | How to Obtain | Tier | Used For |
|---------|--------------|------|---------|
| IDS Portal | ICAC task force registration at icacdatasystem.com | T1 ✅ | Tip downloads (TOTP + ZIP) |
| SMTP / SendGrid | Agency IT or sendgrid.com | T1 ✅ | Email alerts |
| Twilio | twilio.com (LE accounts available) | T1 ✅ | SMS victim crisis alerts |
| NCMEC API | NCMEC law enforcement services | Existing | XML tip feed |
| Project VIC | Law enforcement vetting via projectvic.org | T3 | Hash matching |
| IWF Contraband Filter | IWF law enforcement liaison | T3 | Hash matching |
| Interpol ICSE | Via NCB liaison | T3 | International hash matching |
| RISSafe / HighWay | Agency IT | Existing | De-confliction |

---

## Source Structure

```
src/
  models/           — TypeScript interfaces + Zod schemas
  compliance/       — Wilson helpers, audit log, prompt guards, statutes
  tools/
    alerts/         — Email (nodemailer) + SMS (Twilio) alert delivery   ✅ T1
    preservation/   — 2703(f) letter generation, ESP retention windows   ✅ T1
    legal/          — Warrant tools, MLAT generator stub                 T2/T4
    hash/           — Hash check tools (stub → real in T3)
    deconfliction/  — RISSafe/HighWay check stub
    routing/        — Interpol referral stub
    database/       — Case database search stub
  parsers/          — NCMEC PDF, XML, email MIME parsers
  agents/           — 8 agents (intake, extraction, hash, legal_gate, classifier, linker, priority)
  ingestion/        — IDS poller (real auth ✅), NCMEC API, email, VPN portal, queue
  api/              — REST routes, setup routes
  auth/             — JWT auth, middleware (Tier 2.4 stub)
  db/               — PostgreSQL pool, repository, migrations            ✅ T1
  jobs/             — Background jobs: cluster_scan (Tier 4.2 stub)
  cache/            — LRU hash cache
  middleware/       — Rate limiting
  orchestrator.ts   — 5-stage pipeline runner
  index.ts          — Server entry point
dashboard/
  index.html        — Self-contained React investigator dashboard
  status.html       — Health monitoring
  setup.html        — 6-step setup wizard
  demo.html         — 6 synthetic tip demonstrations
  quickstart.html   — Printable A4 reference card
```

---

## Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Database (optional — defaults to in-memory)
DB_MODE=postgres                          # or omit for memory
DATABASE_URL=postgresql://user:pass@host/db

# Queue (optional — defaults to in-memory)
REDIS_URL=redis://localhost:6379

# IDS Portal (Tier 1 — real auth)
IDS_ENABLED=true
IDS_EMAIL=officer@icac.gov
IDS_PASSWORD=...
IDS_MFA_SECRET=BASE32TOTPSECRET
IDS_BASE_URL=https://www.icacdatasystem.com
IDS_STUB_DIR=/path/to/test/pdfs          # dev only

# Email alerts (Tier 1)
ALERT_EMAIL_HOST=smtp.sendgrid.net
ALERT_EMAIL_PORT=587
ALERT_EMAIL_USER=apikey
ALERT_EMAIL_PASS=SG.xxxxx
ALERT_FROM_EMAIL=icac-triage@agency.gov
ALERT_SUPERVISOR_EMAILS=sgt.jones@agency.gov,lt.smith@agency.gov
ALERT_CRISIS_EMAILS=victim-services@agency.gov,duty-supervisor@agency.gov

# SMS victim crisis alerts (Tier 1)
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_FROM_NUMBER=+15005550006
ALERT_CRISIS_PHONES=+1XXXXXXXXXX

# Agents
TOOL_MODE=stub                            # stub | real
```

---

## Production Checklist (Before Live Deployment)

**Legal / Compliance**
- [ ] Agency legal counsel review of Wilson Ruling implementation
- [ ] CJIS Security Policy v5.9 compliance audit with agency CISO
- [ ] Warrant workflow approval from DA's office
- [ ] EU LED compliance memo for international partners
- [ ] NCMEC MOU for API access

**Technical**
- [ ] `npm install` with network access (installs Tier 1 packages)
- [ ] PostgreSQL 15+ provisioned with DB_MODE=postgres
- [ ] Append-only audit log trigger verified at DB layer
- [ ] TLS 1.3 termination on all endpoints
- [ ] Security penetration test
- [ ] IDS Portal credentials provisioned and tested
- [ ] SMTP/Twilio alert channels tested end-to-end

**Operational**
- [ ] Project VIC registration completed (Tier 3)
- [ ] De-confliction system (RISSafe/HighWay) integration tested
- [ ] ICAC investigator acceptance testing (≥ 2 agents, ≥ 2 weeks)
- [ ] On-call supervisor alert roster confirmed
- [ ] Victim services SMS contact list verified
- [ ] Investigator account provisioning workflow defined (Tier 2.4)
