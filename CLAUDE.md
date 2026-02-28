# CLAUDE.md — CyberTip Triage System

AI assistant context for the CyberTip Triage codebase. Read this before writing any code.

---

## What this system is

A law enforcement ICAC (Internet Crimes Against Children) tip triage system that processes NCMEC CyberTips through an 8-agent AI pipeline. It classifies, scores, and routes child exploitation reports to the correct investigative unit.

> **Law Enforcement Use Only.** This system handles CSAM reports and is designed for authorized ICAC task forces. Legal compliance is not optional.

Also see: [`AGENTS.md`](./AGENTS.md) — additional agent context, [`USER_JOURNEYS.md`](./USER_JOURNEYS.md) — ground truth for investigator workflows.

---

## Required reading before making changes

| Document | When to read |
|----------|-------------|
| **[USER_JOURNEYS.md](./USER_JOURNEYS.md)** | Before any change to pipeline, API routes, dashboard, or legal logic |
| **[AUDIT_REPORT.md](./AUDIT_REPORT.md)** | Before adding tests — gap analysis already done |
| **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** | Before changing environment config or ingestion sources |
| **[BACKLOG.md](./BACKLOG.md)** | Current task priorities and known gaps |

---

## Development commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (in-memory DB/queue, no external services needed)
npm run typecheck    # tsc --noEmit — must be clean before any PR
npm test             # vitest run — all tests must pass
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report
npm run build        # tsc compile to dist/
npm run db:migrate   # Run PostgreSQL migrations
```

**The two gates before any commit: `npm run typecheck` and `npm test` must both be clean.**

---

## Architecture

```
Ingestion Sources                 Queue                   8-Agent Pipeline
────────────────                  ──────                  ────────────────
NCMEC IDS Portal ──▶  bundle_dedup ──▶  enqueueTip ──▶  1. Intake Agent (haiku)
NCMEC XML API                                            2. Legal Gate (opus)  ← Wilson/4th Amendment
ESP Direct                                               3. Extraction  ┐ parallel (haiku)
Email Inbox                                                 Hash/OSINT   ┘
VPN Portal                                               4. Classifier  ┐ parallel
Inter-Agency                                                Linker       ┘ (opus + sonnet)
                                                         5. Priority Agent (opus) → score/tier/alert
                                                                │
                                                         PostgreSQL / in-memory
                                                                │
                                                         Dashboard (React SSE, port 3000)
```

The orchestrator (`src/orchestrator.ts`) is the **single entry point** for tip processing. No other code calls agents directly.

---

## Source structure

```
src/
├── index.ts                     # Server entry point (Express + ingestion startup)
├── orchestrator.ts              # 5-stage pipeline controller — read this first
│
├── agents/                      # 8 pipeline agents
│   ├── intake.ts                # Stage 1: normalize raw tip via LLM
│   ├── legal_gate.ts            # Stage 2: Wilson compliance + circuit analysis (CRITICAL)
│   ├── extraction.ts            # Stage 3a: extract entities from tip body
│   ├── hash_osint.ts            # Stage 3b: check hash watchlists, OSINT
│   ├── classifier.ts            # Stage 4a: offense category, severity, statutes
│   ├── linker.ts                # Stage 4b: deconfliction, related tips, cluster links
│   └── priority.ts              # Stage 5: score 0–100, tier, routing, alerts
│
├── compliance/                  # Legal enforcement — touch with extreme care
│   ├── wilson.ts                # Fourth Amendment enforcement (deterministic)
│   ├── circuit_guide.ts         # Per-circuit legal guidance + precedent registry
│   ├── statutes.ts              # All applicable statutes + CIRCUIT_PRECEDENT_MAP
│   ├── audit.ts                 # Append-only audit log
│   └── prompt-guards.ts         # Prompt injection detection
│
├── models/                      # TypeScript interfaces + Zod schemas
│   ├── index.ts                 # Re-exports all models
│   ├── tip.ts                   # CyberTip, TipFile, LegalStatus (core schema)
│   ├── classification.ts        # Offense categories, severity levels
│   ├── entities.ts              # ExtractedEntities schema
│   ├── priority.ts              # PriorityScore, tiers (IMMEDIATE/URGENT/STANDARD/MONITOR/PAUSED)
│   ├── audit.ts                 # AuditEntry schema
│   └── ...                      # agency, forensics, hash, links, officer, preservation, reporter
│
├── db/                          # Data access layer
│   ├── tips.ts                  # PostgreSQL + in-memory CRUD — all tip data access here
│   ├── pool.ts                  # PostgreSQL connection pool
│   ├── migrate.ts               # Migration runner
│   ├── officers.ts              # Officer accounts + warrant applications
│   ├── agencies.ts              # Agency registry
│   ├── precedents.ts            # Legal precedent + circuit rule override persistence
│   ├── forensics.ts             # Forensics handoff records
│   └── migrations/
│       ├── 001_initial.sql      # Core schema (tips, files, preservation, audit_log)
│       ├── 002_officers.sql     # Officers, warrant_applications, revoked_tokens
│       ├── 003_legal_precedents.sql # legal_precedents + circuit_rule_overrides
│       ├── 004_mlat_requests.sql
│       ├── 005_agencies.sql
│       └── 006_forensics_handoffs.sql
│
├── ingestion/                   # Tip intake channels
│   ├── ids_portal.ts            # NCMEC IDS Portal poller (TOTP auth, ZIP extraction)
│   ├── ncmec_api.ts             # NCMEC XML API listener
│   ├── email.ts                 # IMAP email ingestion
│   ├── bundle_dedup.ts          # Viral incident deduplication (run BEFORE enqueue)
│   ├── queue.ts                 # BullMQ (prod) / in-memory (dev/test) queue
│   ├── config.ts                # Ingestion config loader
│   └── routes.ts                # Ingestion HTTP endpoints
│
├── api/                         # REST API routes
│   ├── routes.ts                # Main REST API (queue, tips, MLAT, clusters, circuit)
│   ├── tier3_routes.ts          # Hash integration management endpoints
│   └── setup_routes.ts          # Configuration wizard endpoints
│
├── auth/                        # Authentication
│   ├── jwt.ts                   # JWT token generation/verification
│   ├── middleware.ts            # Auth middleware (pass-through unless AUTH_ENABLED=true)
│   └── tier2_routes.ts          # Warrant workflow, OJJDP reports, preservation PDF
│
├── llm/                         # LLM provider abstraction
│   ├── index.ts                 # Public API — agents import from here only
│   ├── config.ts                # Provider selection (anthropic/openai/gemini/local)
│   ├── types.ts                 # LLMProvider, AgentCallOptions, ModelRole interfaces
│   └── providers/
│       ├── anthropic_provider.ts
│       ├── openai_compat_provider.ts  # OpenAI + OpenAI-compatible (Ollama, etc.)
│       └── gemma_provider.ts
│
├── tools/                       # Investigative tool implementations
│   ├── alerts/alert_tools.ts    # Email (nodemailer) + SMS (Twilio) alerts
│   ├── preservation/            # 18 U.S.C. § 2703(f) letter generation
│   ├── legal/                   # Warrant workflow, MLAT generator, affidavit
│   ├── hash/                    # PhotoDNA, Project VIC, IWF, Interpol ICSE checks
│   ├── forensics/               # Cellebrite, EnCase, FTK, Axiom, Griffeye exports
│   ├── deconfliction/           # RISSafe/HighWay deconfliction check
│   ├── database/                # Case database search
│   ├── reporting/               # OJJDP grant metrics export
│   ├── routing/                 # Interpol referral
│   ├── index.ts                 # Tool registry for agents
│   └── types.ts                 # Tool definition types
│
├── parsers/                     # Input format parsers
│   ├── ncmec_xml.ts             # NCMEC XML tip format
│   ├── ncmec_pdf.ts             # NCMEC PDF report parser
│   └── email_mime.ts            # MIME email parser
│
├── middleware/
│   └── rate-limit.ts            # express-rate-limit configuration
│
├── jobs/                        # Background jobs
│   ├── cluster_scan.ts          # Nightly temporal clustering (5 pattern types, 90-day window)
│   └── nightly_digest.ts        # Shift-change digest email for supervisors
│
├── offline/
│   └── offline_config.ts        # Air-gap / offline mode configuration
│
└── utils/
    ├── logger.ts                # Structured logging utility
    └── network_guard.ts         # Blocks external fetch() in offline mode

dashboard/                       # Self-contained HTML dashboards (no build step)
├── index.html                   # Main investigator dashboard (React via CDN)
├── mobile.html                  # On-call mobile view (IMMEDIATE/URGENT only)
├── status.html                  # System health monitoring
├── setup.html                   # 6-step setup wizard
├── demo.html                    # 6 synthetic tip demonstrations
├── tier4.html                   # Admin view: clustering, MLAT, circuit overrides
├── quickstart.html              # Printable A4 reference card
└── forensics.html               # Forensics handoff management

data/
└── offline-hash-db/             # CSV files for air-gap hash matching

test-data/
└── ids-stubs/                   # Sample .txt files for IDS Portal dev testing
```

---

## Non-negotiable legal invariants

These are enforced deterministically. LLM output **cannot** override them.

### 1. Wilson v. US (9th Cir. 2021) — Fourth Amendment file access

**Rule:** If `esp_viewed = false` (or missing), the file is blocked until a warrant is granted.

```typescript
// src/compliance/wilson.ts — THE authority
computeWarrantRequired(file)      // deterministic: true/false
computeFileAccessBlocked(file)    // deterministic: blocked unless warrant_status === 'granted'
assertFileAccessible(file)        // throws WilsonBlockedError if blocked
```

- `legal_gate.ts` Step 7: LLM output is merged but **always** overwritten with deterministic values for `file_access_blocked` and `warrant_required`
- 9th Circuit binding: AK, AZ, CA, HI, ID, MT, NV, OR, WA
- Other circuits: conservative Wilson applied until binding precedent recorded

### 2. Sextortion + victim crisis → P1_CRITICAL always

```typescript
// src/orchestrator.ts — applyCriticalOverrides()
// CSAM + confirmed minor victim → P1_CRITICAL even if LLM scored lower
// sextortion_victim_in_crisis = true → score floor 90, tier = IMMEDIATE
```

### 3. AIG-CSAM — severity never reduces

AI-generated CSAM is charged under **18 U.S.C. § 1466A** (no real victim needed). Set `aig_csam_flag = true`. Never reduce severity.

### 4. Audit trail is append-only — chain of custody

Every agent action AND every human action (warrant update, assign, preservation issue) **must** call:

```typescript
import { appendAuditEntry } from "../compliance/audit.js";

await appendAuditEntry({
  tip_id,
  agent: "AgentName",
  timestamp: new Date().toISOString(),
  status: "success" | "error" | "blocked" | ...,
  summary: "Human-readable description",
});
```

Never delete or modify audit entries. A PostgreSQL trigger (`prevent_audit_modification`) and rule (`audit_log_no_update`) enforce this at the DB layer.

### 5. REPORT Act 2024 — "apparent" CSAM counts

Count and process "reasonably apparent" CSAM (AI/ML detected), not just hash-confirmed. `REPORT_ACT_MIN_DAYS = 365` (not 90). See `compliance/statutes.ts`.

### 6. Bundle dedup before enqueue

Always call `checkBundleDuplicate()` **before** adding to queue. Never after.

### 7. MLAT: preservation draft before disclosure request

Budapest Article 16 preservation request must be generated before any disclosure request.

---

## Development conventions

### TypeScript

- Target: ES2022, module: NodeNext
- Strict mode + `noUncheckedIndexedAccess` + `noImplicitReturns`
- All imports use `.js` extension (NodeNext ESM resolution)
- Zod schemas defined in `src/models/` for all data shapes
- Example: `import type { CyberTip } from "../models/index.js";`

### LLM calls — always use the abstraction layer

```typescript
import { getLLMProvider } from "../llm/index.js";

const text = await getLLMProvider().runAgent({
  role: "high",          // "high" | "medium" | "fast" — maps to model tier
  system: SYSTEM_PROMPT,
  userMessage: buildContext(tip),
  tools: [TOOL_DEF],
  executeToolCall: handleToolCall,
});
```

Never import `@anthropic-ai/sdk` or `openai` directly in agents. The abstraction allows switching providers via `LLM_PROVIDER` env var.

**Model role mapping (default: Anthropic)**
| Role | Model |
|------|-------|
| `fast` | claude-haiku-4-5-20251001 |
| `medium` | claude-sonnet-4-6 |
| `high` | claude-opus-4-6 |

### Prompt injection protection

All tip body text must be wrapped in `<tip_content>` XML delimiters before any LLM call. The Legal Gate hard-blocks any tip whose body attempts to override agent instructions. See `src/compliance/prompt-guards.ts`.

### In-memory fallback

The system runs entirely without external services in dev/test mode:
- `DB_MODE=memory` (default) — in-memory tip store, no PostgreSQL needed
- `QUEUE_MODE=memory` (default) — in-memory queue, no Redis needed
- Anthropic mocked in tests via `vi.mock('@anthropic-ai/sdk')`

**Never break the in-memory fallback** — it's required for tests and local dev.

### Dashboard pages

Dashboard is static HTML served from `dashboard/`. No build step. React loaded via CDN. Edit HTML/JS directly.

---

## Testing

```
src/__tests__/           # Main test suite
src/agents/__tests__/    # Agent-specific tests
```

**Test setup:**
- Framework: Vitest (`npm test`) with supertest for HTTP route tests
- `src/__tests__/setup.ts` — sets `JWT_SECRET` for test environment
- `src/__tests__/fixtures.ts` — 225 synthetic tips across 15 categories
- Mock Anthropic: `vi.mock('@anthropic-ai/sdk')` in test files
- No external services needed (in-memory DB/queue by default)

**Adding tests:**
1. Check `AUDIT_REPORT.md` first to avoid duplicating existing coverage analysis
2. Place in `src/__tests__/` (or `src/agents/__tests__/` for agent-specific)
3. Use `fixtures.ts` for synthetic tip data
4. Mock all LLM calls

---

## Environment variables

Key variables (see `.env.example` for full list):

```bash
# LLM (required — at least one provider key)
LLM_PROVIDER=anthropic          # anthropic | openai | gemini | local
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GEMINI_API_KEY=AIza...

# Database (defaults to in-memory for dev/test)
DB_MODE=memory                  # memory | postgres
DATABASE_URL=postgresql://user:pass@localhost:5432/cybertip

# Queue (defaults to in-memory for dev/test)
QUEUE_MODE=memory               # memory | bullmq
REDIS_HOST=localhost
REDIS_PORT=6379

# Server
PORT=3000
NODE_ENV=development
JWT_SECRET=change-this-secret-in-production-32chars!

# Feature flags
TOOL_MODE=stub                  # stub | real (controls real vs stub hash/deconfliction APIs)
AUTH_ENABLED=false              # true enables JWT auth on /api routes
DEMO_MODE=false                 # true enables instant demo bypass in orchestrator

# Offline / air-gap mode
OFFLINE_MODE=false              # true blocks all external network calls
```

---

## Database

**Migrations run in order: 001 → 006**

```bash
npm run db:migrate              # Run all pending migrations
psql $DATABASE_URL < src/db/migrations/001_initial.sql  # Manual
```

**Docker Compose auto-applies migrations** via `docker-entrypoint-initdb.d`.

Key tables:
- `cyber_tips` — main tip records (JSONB columns for agent outputs)
- `tip_files` — normalized file records with Wilson compliance fields
- `audit_log` — append-only (trigger enforced); never modify
- `preservation_requests` — 18 U.S.C. § 2703(f) requests
- `warrant_applications` — warrant lifecycle tracking
- `officers` / `agencies` — investigator accounts

---

## Docker

```bash
# Development (in-memory, no external services)
npm run dev

# Production stack (PostgreSQL + Redis + Nginx)
cp .env.example .env  # Edit with real credentials
docker compose --profile production up

# Offline / air-gap mode (Ollama local LLM)
docker compose --profile offline up
# Requires pre-pulled Ollama models: ollama pull gemma3:27b && gemma3:12b && gemma3:4b
```

---

## Agent models (default: Anthropic)

| Agent | Role | Rationale |
|-------|------|-----------|
| Intake | `fast` (haiku) | High volume, format detection |
| Extraction | `fast` (haiku) | High volume, structured output |
| Hash & OSINT | `fast` (haiku) | Tool dispatch, minimal reasoning |
| Legal Gate | `high` (opus) | High-stakes compliance, agentic tool loop |
| Classifier | `high` (opus) | Nuanced child safety categorization |
| Linker | `medium` (sonnet) | Entity graph reasoning, DB-intensive |
| Priority | `high` (opus) | Multi-factor scoring with tool calls |

---

## Priority tiers

| Tier | Score | Meaning |
|------|-------|---------|
| `IMMEDIATE` | 85–100 | Active abuse, infant/toddler, live streaming — supervisor alerted |
| `URGENT` | 65–84 | Sextortion, grooming, escalating series |
| `STANDARD` | 35–64 | Historical CSAM, no imminent victim risk |
| `MONITOR` | 10–34 | Vague/suspicious, low evidence |
| `PAUSED` | 0–9 | De-confliction conflict — another agency has active case |

---

## Ingestion sources

| Source | Implementation | Auth |
|--------|---------------|------|
| NCMEC IDS Portal | `src/ingestion/ids_portal.ts` | TOTP (otplib) + ZIP extraction |
| NCMEC XML API | `src/ingestion/ncmec_api.ts` | API key |
| ESP Direct | `src/ingestion/routes.ts` | Agency key + HMAC signature |
| Email IMAP | `src/ingestion/email.ts` | IMAP credentials |
| VPN Portal | `src/ingestion/routes.ts` | Shared secret |
| Inter-Agency | `src/ingestion/routes.ts` | API key list |

---

## Security requirements

- **Never commit** `.env`, `*.pdf`, `*.zip`, `credentials/`, `secrets/`, or actual tip data
- Wilson compliance enforcement must remain **deterministic** — never LLM-driven
- All tip content wrapped in `<tip_content>` delimiters before LLM calls
- JWT secrets must be ≥ 32 chars in production
- Rate limiting active on all `/api` routes (`src/middleware/rate-limit.ts`)
- TLS 1.3 required for all production endpoints
- DB port never exposed externally (Docker Compose `expose` not `ports`)
- Audit log is forensic evidence — no deletes, no updates, ever

---

## What AI assistants should be careful about

1. **Wilson enforcement is deterministic** — do not make it LLM-driven or add LLM override paths
2. **Every human action needs an audit entry** — warrant updates, assignments, preservation issuance
3. **Legal Gate failures = hard block** — never continue pipeline when Legal Gate throws
4. **`applyCriticalOverrides()` runs after classification** — P1_CRITICAL overrides are deterministic
5. **Don't bypass rate limiting** or auth middleware without AUTH_ENABLED=false check
6. **New legal features need USER_JOURNEYS.md documentation** — investigators won't find undocumented features
7. **Bundle dedup before enqueue** — `checkBundleDuplicate()` runs before `enqueueTip()`
8. **Import `.js` extensions** in all ESM imports (NodeNext module resolution requirement)
9. **No inline warrant logic** — all warrant decisions go through `src/compliance/wilson.ts`
10. **Do not add `console.log` to production paths** — use `src/utils/logger.ts`

---

*Last updated: 2026-02-28*
