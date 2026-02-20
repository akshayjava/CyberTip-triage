# CyberTip Triage — Bug & Feature Backlog

**Audited:** 2026-02-19  
**Method:** Full static analysis of all 80+ source files, tracing every critical code path  
**TypeScript status:** ✅ Zero production errors

---

## P0 — Critical (must fix before production use)

### BUG-001 · Warrant status value mismatch — `pending_application` vs `applied`

**Files:** `src/models/tip.ts`, `src/agents/legal_gate.ts`, `src/api/routes.ts`, `dashboard/index.html`  
**Severity:** Data integrity bug — two incompatible values for the same concept flow through the system simultaneously.

The `WarrantStatus` type in `tip.ts` defines five valid values: `not_needed | pending_application | applied | granted | denied`.

The Legal Gate agent (step 3) assigns `pending_application` to files that need a warrant at triage time. The warrant update API (`POST /api/tips/:id/warrant/:fileId`) only accepts `applied | granted | denied` and rejects `pending_application` with a 400 error. The dashboard `FileRow` renders `pending_application` as a button that tries to set status to `applied` — but also has a separate conditional for `applied` styling, creating two different visual states for what is effectively the same "warrant needed" state.

**Impact:** An investigator clicking "Apply for Warrant" in the dashboard sends `applied`, which is valid — but the display is inconsistent. More critically, any system-to-system integration that sends `pending_application` will be rejected by the API.

**Fix:** Unify. Remove `pending_application` from the WarrantStatus enum. Replace every `pending_application` assignment in `legal_gate.ts` with `applied`. Update `tip.ts` schema. Or keep both and make the API accept `pending_application` as equivalent to `applied`.

---

### BUG-002 · Circuit-specific warrant logic not wired — 7th Circuit over-blocks

**Files:** `src/agents/legal_gate.ts` (line 111), `src/compliance/circuit_guide.ts`  
**Severity:** Legal correctness bug — produces incorrect Fourth Amendment analysis for multiple circuits.

`requiresWarrantByCircuit()` is imported into `legal_gate.ts` and called at step 5 to generate a circuit guidance note for the LLM. But `computeWarrantRequired(file)` at step 1 (the deterministic value that actually controls file blocking) is called without any circuit argument — it always applies the 9th Circuit Wilson standard.

Currently ALL circuits require warrants when `esp_viewed=false`. This is over-restrictive for circuits where the law may differ. As noted in `circuit_guide.ts`, this is a known limitation, but `requiresWarrantByCircuit()` already exists and is ready to use.

**Fix:** Detect circuit before step 1 (circuit detection already happens at step 4), pass the circuit into a new `computeWarrantRequired(file, circuit)` overload that delegates to `requiresWarrantByCircuit()`.

---

### BUG-003 · BullMQ creates a new Queue instance per enqueue — Redis connection exhaustion

**File:** `src/ingestion/queue.ts` (line ~170)  
**Severity:** Production infrastructure bug — causes Redis exhaustion at volume.

`enqueueBullMq()` calls `new Queue(...)` and `queue.close()` for every tip submission. At NCMEC peak volumes (100,000+ tips/day), this opens and closes 100,000+ Redis connections. Redis has a default max of 10,000 connections. The server will exhaust Redis long before reaching scale.

**Fix:** Make the BullMQ Queue instance a module-level singleton. Initialize once on startup, close only on graceful shutdown.

---

### BUG-004 · Public tip submission endpoint has no rate limiting

**File:** `src/ingestion/routes.ts` (line ~201)  
**Severity:** Security vulnerability — DoS attack surface and queue flooding.

The `POST /intake/public` route handler comment says "rate-limited separately" but no rate limiting middleware is present anywhere in the codebase. Any unauthenticated actor can flood the tip queue, exhaust AI API credits, and degrade throughput for real tips.

**Fix:** Add `express-rate-limit` middleware to the public route (e.g., 5 req/min per IP). The other intake routes (`/portal`, `/agency`, `/esp`) are HMAC/API-key protected, so they're not exposed the same way.

---

### BUG-005 · `POST /intake/public` in-memory queue race condition

**File:** `src/ingestion/queue.ts` (line ~39)  
**Severity:** Data correctness bug — concurrent submissions can process two jobs simultaneously.

The in-memory queue uses `let isProcessing = false` as a non-atomic flag. Two concurrent `enqueueTip()` calls in the same Node.js event loop tick can both pass the `if (isProcessing) return` check before either sets `isProcessing = true`, causing concurrent job execution. Node.js is single-threaded so true concurrency is rare, but multiple async operations within a single tick can trigger this.

**Fix:** Replace `isProcessing` boolean with a `Set<string>` of active job IDs, or use a proper concurrency semaphore.

---

### BUG-006 · No per-call timeout on Anthropic API calls — pipeline can hang indefinitely

**Files:** `src/agents/legal_gate.ts`, `src/agents/classifier.ts`, `src/agents/priority.ts`, `src/agents/linker.ts`, `src/agents/intake.ts`  
**Severity:** Reliability bug — a single hung API call starves the entire queue worker.

No `AbortSignal` or `Promise.race()` timeout wraps any Anthropic SDK call. The SDK's retry logic handles transient failures, but a hanging connection (HTTP response started, never completes) will block the worker indefinitely. At default queue concurrency of 1, this stops all tip processing.

**Fix:** Wrap each Anthropic call with a `withTimeout(ms)` helper using `AbortSignal.timeout()`. Suggested limits: Intake 30s, Legal Gate 60s, Classifier/Priority 45s.

---

## P1 — High (fix before sustained operational use)

### BUG-007 · Preservation letter PDF download requires O(n) full table scan

**File:** `src/auth/tier2_routes.ts` (line ~206)  
**Severity:** Performance bug — `GET /api/preservation/:id/download` does `listTips({ limit: 1000 })` then scans all tips to find the one containing the preservation request.

Comment in code: `"in production this would be a direct DB lookup"`. At 10,000+ tips, this PDF download becomes extremely slow.

**Fix:** Add `GET /api/preservation/:id` endpoint that directly queries `preservation_requests` table by `request_id`. The table and index already exist (see migration 001).

---

### BUG-008 · Deconfliction check is completely stubbed — no real integration

**File:** `src/tools/deconfliction/check_deconfliction.ts`  
**Severity:** Critical operational gap — the system's deconfliction feature is entirely simulated. It only detects conflicts if the value literally contains the string `"deconflict_match"`.

The real implementation throws: `"De-confliction real implementation not configured. Register with your regional de-confliction system"`. An investigator relying on the deconfliction check to avoid burning an undercover operation will get no real protection.

**Fix:** Integrate with the agency's actual system: RISSafe (RISS.net), HighWay (HIDTA), or state-level deconfliction. This requires LE registration. Until integrated, the system should display a clear "DECONFLICTION SIMULATED — VERIFY MANUALLY" banner in the dashboard rather than showing a clean green "no conflict" badge.

---

### BUG-009 · Case database search is stubbed — linker agent has no real cross-tip linking

**File:** `src/tools/database/search_case_database.ts`  
**Severity:** Operational gap — the Linker Agent queries a stub that only returns canned matches. Real cross-tip subject linking requires querying the live `cyber_tips` database.

**Fix:** The real implementation comment says "Implement with PostgreSQL + pg-trgm for fuzzy search". The DB pool and trigram index already exist (`idx_extracted_trgm` in migration 001). Wire it up: query `cyber_tips.extracted` JSONB for matching IPs, usernames, hashes using the existing trigram index.

---

### BUG-010 · NCMEC XML API not implemented

**File:** `src/ingestion/ncmec_api.ts`  
**Severity:** Major ingestion gap — NCMEC API is one of the primary tip sources and currently throws immediately. The IDS Portal (manual TOTP download) is the only automated NCMEC ingestion.

**Fix:** Implement the XML polling endpoint. NCMEC provides API documentation to authorized LE agencies. Response format is XML; parser exists at `src/parsers/ncmec_xml.ts`.

---

### BUG-011 · Mobile dashboard has no pagination — loads all 200 tips at once

**File:** `dashboard/mobile.html`  
**Severity:** Performance/UX — mobile fetch loads `GET /api/queue` with no limit/offset. This pulls up to 200 tips over a mobile connection and renders them all into a scrollable list. The desktop dashboard was fixed (25 per page); mobile was not.

**Fix:** Apply the same 25-tip pagination pattern used in the desktop dashboard. Crisis tips should always be shown first regardless of page.

---

### BUG-012 · `/quickstart` and `/demo` routes logged but not registered

**File:** `src/index.ts` (lines 71, 73)  
**Severity:** Broken links — the startup log tells users they can access `http://localhost:3000/quickstart` and `http://localhost:3000/demo`, but these `app.get()` routes are not registered. `/mobile`, `/tier4` are registered; `/quickstart` and `/demo` are not. Users get a 404.

`quickstart.html` and `demo.html` exist in the dashboard directory and would be served by the static middleware under `/dashboard/quickstart.html` — but not at the logged paths.

**Fix:** Add `app.get("/quickstart", ...)` and `app.get("/demo", ...)` redirects to the static files.

---

### BUG-013 · JWT uses a weak default secret with no startup hard-stop in production

**File:** `src/auth/jwt.ts` (line ~53)  
**Severity:** Security — `JWT_SECRET` falls back to `"CHANGE-ME-BEFORE-PRODUCTION-32CHARS!"` which is logged as a warning but never blocked. If someone accidentally deploys without setting `JWT_SECRET`, all tokens are signed with this public string.

**Fix:** Add a startup guard: if `AUTH_ENABLED=true` and `JWT_SECRET` is the default value (or shorter than 32 chars), throw and refuse to start.

---

### FEAT-014 · No shift-change overnight digest email for supervisors

**Severity:** Operational gap — supervisors starting a shift have no automated summary of what arrived overnight. They must open the dashboard and manually review.

**Implementation:** Nightly cron job (e.g., 06:00 daily, before shift start) that calls `getTipStats()` and `listTips({ limit: 20 })` ordered by score, then sends a summary email via `alertSupervisor()` or a new `sendDigestEmail()`. Include: new tip counts by tier, any crisis alerts, cluster escalations since last digest.

---

### FEAT-015 · No MLAT request tracking — generated requests not persisted

**Severity:** Operational gap — `generateMLATRequest()` produces fully formatted MLAT and Budapest Article 16 preservation drafts with tracking IDs (`MLAT-2026-{TIP}-{COUNTRY}`), but these are not saved anywhere. Supervisors cannot see which MLAT requests are outstanding, when they were filed, or their status.

**Implementation:** Add `mlat_requests` table to a new migration. Persist on generation. Add `GET /api/mlat/requests` endpoint. Show outstanding MLATs in the tier4 admin MLAT panel.

---

### FEAT-016 · Cluster list view missing from tier4 admin

**Severity:** UX gap — the tier4 admin Cluster Scan panel shows scan stats but not the actual clusters. A supervisor cannot see all active cluster groups, their member tips, or their pattern type from a single view.

**Implementation:** Add a "Active Clusters" section below the scan stats in tier4.html. Query `GET /api/clusters` and group tips by `cluster_flags[].cluster_id`. Each cluster shows: type, pattern key, tip count, member tip IDs (clickable to open in main dashboard).

---

## P2 — Medium (address in next development cycle)

### BUG-017 · In-memory cluster scan loses 90-day history on server restart

**File:** `src/jobs/cluster_scan.ts`  
**Details:** `scanFromMemory()` only scans the in-memory `memStore` which only contains tips from the current server session. In dev mode, historical patterns are invisible after a restart. In production (PostgreSQL), the 90-day JSONB scan works correctly. The issue only affects `DB_MODE=memory` (dev/test).

**Fix:** In memory mode, load all tips from the in-memory store into a full array for the scan (already done). The actual gap is that the memory store is not seeded from any persistence on startup — so a dev restart loses all history. Consider persisting the in-memory store to a local JSON file for dev continuity.

---

### BUG-018 · PDF parser has no field presence validation

**File:** `src/parsers/ncmec_pdf.ts`, `src/agents/intake.ts`  
**Details:** If NCMEC changes their PDF format, parsed fields silently return empty/null. The Intake Agent will enqueue a tip with empty `ncmec_tip_number`, empty `files`, empty `reporter`, etc. There is no validation step that would catch a format change before it enters the pipeline.

**Fix:** After `parseNcmecPdfText()`, check that at least `ncmec_tip_number`, `reporter.esp_name`, and at least one `files` entry are present. If not, log a parse failure alert to the admin.

---

### BUG-019 · IDS Portal auth failure is silent — no admin alert on repeated failures

**File:** `src/ingestion/ids_portal.ts`  
**Details:** If TOTP drift or a portal outage causes repeated auth failures, the poller silently stops until the next poll interval. There is no alert sent to supervisors. The system appears healthy (queue worker is running) but ingestion has stopped.

**Fix:** After N consecutive auth failures (e.g., 3), call `alertSupervisor()` with an ingestion failure alert. Reset the failure counter on successful auth.

---

### BUG-020 · Username normalization in cluster scan is too shallow

**File:** `src/jobs/cluster_scan.ts`  
**Details:** The `normalizeUsername()` function strips trailing digits and underscores. A predator using `hunter_1`, `HunTer1`, and `h.u.n.t.e.r` across platforms will not be clustered. Case-insensitive comparison and Levenshtein distance-based fuzzy matching would catch these variations.

**Fix:** Lowercase + strip all non-alphanumeric + optionally compute edit distance ≤2 as a cluster match.

---

### FEAT-021 · No automated ESP notification on preservation letter issue

**File:** `src/api/routes.ts` (`handleIssuePreservation`)  
**Details:** When an investigator marks a preservation request as "issued", the letter PDF can be downloaded but there is no automated transmission. Investigators must manually send the PDF to the ESP via fax/email. The 90-day preservation window starts from receipt — delays in manual transmission reduce the window.

**Implementation:** After `issuePreservationRequest()` succeeds, if the ESP has a configured notification email (add to ESP registry), automatically email the PDF as an attachment. A manual "Copy ESP Email" button in the UI would also help.

---

### FEAT-022 · No "unread" tip indicator — no way to see what arrived since last login

**File:** `dashboard/index.html`  
**Details:** Tips that arrived since the investigator last opened the dashboard look identical to tips they've already reviewed. On a busy shift, investigators must scan every TipRow to find new arrivals.

**Implementation:** Store `last_viewed_at` per officer in localStorage (or a session cookie). TipRows where `received_at > last_viewed_at` get a blue "NEW" dot badge.

---

### FEAT-023 · Case database search not wired to PostgreSQL

**File:** `src/tools/database/search_case_database.ts`  
**Details:** The Linker Agent uses `search_case_database` tool to find related tips by IP, username, and subject name. The real implementation is stubbed. The trigram index `idx_extracted_trgm` already exists in the database from migration 001.

**Implementation:** Query `cyber_tips` using `extracted::text @@ to_tsquery(...)` for full-text and `extracted::text % $1` for trigram fuzzy search. Return tip IDs, offense categories, and statuses.

---

### FEAT-024 · Shift-change "Assign to Me" on mobile doesn't record officer identity

**File:** `dashboard/mobile.html`  
**Details:** Mobile `assignSelf()` sends `{ investigator_id: 'on_call', investigator_name: 'On-Call Investigator' }` — a hardcoded placeholder. The audit trail records "on_call" instead of the actual officer's badge number.

**Implementation:** Read the authenticated officer's badge number from JWT session and use it in the assign call. If not authenticated, prompt for badge number.

---

### FEAT-025 · No supervisor dashboard / admin view — all supervisors see the same investigator queue

**Details:** There is no role-differentiated view. Supervisors and investigators see the same dashboard. Supervisors have no overview of: which tips are assigned to which investigators, how many cases each investigator has open, which tips have been idle for 24+ hours.

**Implementation:** Add a supervisor view (accessible when `role = 'supervisor'`) that shows: investigator workload table, unassigned tip count, stale tip alerts (no action in 48h), cluster escalations needing review.

---

### FEAT-026 · No automated 90-day preservation window expiry alert

**Details:** § 2703(f) preservation requests give ESPs 90 days to retain data. If an investigator doesn't follow up (subpoena, warrant) within 90 days, the ESP may delete the data. There is no alert when a preservation request is within 14 days of expiry.

**Implementation:** Add a daily cron that queries `preservation_requests` where `issued_at < NOW() - INTERVAL '76 days' AND status = 'issued'`. Send supervisor alert for each approaching expiry.

---

### FEAT-027 · No pagination on cluster/MLAT search results in tier4 admin

**Details:** `GET /api/clusters` returns all tips with cluster flags (up to 500). `GET /api/tips/:id/mlat` returns all MLAT requests for a tip. Neither the tier4 admin nor any endpoint paginates these.

**Implementation:** Add `limit` and `offset` to `GET /api/clusters`. The tier4 admin panel should show a paginated table.

---

## Summary table

| ID | Priority | Type | One-line description |
|----|----------|------|----------------------|
| BUG-001 | P0 | Data integrity | `pending_application` vs `applied` warrant status mismatch |
| BUG-002 | P0 | Legal correctness | Circuit warrant logic not wired — all circuits use 9th Circuit rules |
| BUG-003 | P0 | Infrastructure | BullMQ creates new Queue per enqueue — Redis exhaustion at volume |
| BUG-004 | P0 | Security | Public intake endpoint has no rate limiting |
| BUG-005 | P0 | Concurrency | In-memory queue race condition with `isProcessing` boolean |
| BUG-006 | P0 | Reliability | No timeout on Anthropic API calls — queue can hang indefinitely |
| BUG-007 | P1 | Performance | Preservation PDF download does O(n) full table scan |
| BUG-008 | P1 | Operational gap | Deconfliction check is fully stubbed — no real LE integration |
| BUG-009 | P1 | Operational gap | Case database search stubbed — no real cross-tip linking |
| BUG-010 | P1 | Ingestion | NCMEC XML API not implemented — throws immediately |
| BUG-011 | P1 | Performance | Mobile dashboard loads all 200 tips, no pagination |
| BUG-012 | P1 | UX | `/quickstart` and `/demo` routes logged but return 404 |
| BUG-013 | P1 | Security | JWT allows weak default secret in production without hard-stop |
| FEAT-014 | P1 | Feature | No overnight digest email for supervisors at shift start |
| FEAT-015 | P1 | Feature | MLAT requests not persisted — no tracking of outstanding requests |
| FEAT-016 | P1 | Feature | No cluster list view in tier4 admin |
| BUG-017 | P2 | Dev experience | In-memory cluster scan loses history on restart |
| BUG-018 | P2 | Reliability | PDF parser has no field validation — format changes fail silently |
| BUG-019 | P2 | Reliability | IDS Portal auth failures are silent — no admin alert |
| BUG-020 | P2 | Feature quality | Username normalization too shallow — misses cross-platform variants |
| FEAT-021 | P2 | Feature | No automated ESP email when preservation letter issued |
| FEAT-022 | P2 | UX | No "unread" tip indicator since last login |
| FEAT-023 | P2 | Feature | Case database search not wired to PostgreSQL |
| FEAT-024 | P2 | UX | Mobile "Assign to Me" records hardcoded identity, not real officer |
| FEAT-025 | P2 | Feature | No supervisor-specific dashboard view |
| FEAT-026 | P2 | Feature | No 90-day preservation window expiry alert |
| FEAT-027 | P2 | Feature | No pagination on cluster/MLAT admin results |

---

## What is solid — do not break

These are working correctly and should be treated as invariants:

- ✅ **Wilson enforcement** — `computeFileAccessBlocked()` is deterministic; LLM cannot override it
- ✅ **CSAM + minor victim → P1_CRITICAL override** — enforced post-LLM in orchestrator
- ✅ **Sextortion crisis floor** — score ≥ 90, tier = IMMEDIATE, regardless of LLM scoring
- ✅ **AIG-CSAM detection** — charged under § 1466A with no severity reduction
- ✅ **Audit trail append-only** — DB-level trigger prevents modification
- ✅ **Precedent persistence** — circuit precedents now survive server restart (fixed 2026-02-19)
- ✅ **Bundle deduplication** — viral incident collapse before queue entry
- ✅ **CLOUD Act prioritization** — CA/GB/AU get 2–6 week timeline instead of 6–18 month MLAT
- ✅ **Dashboard pagination** — 25 tips per page with stable poll interval (fixed 2026-02-19)
- ✅ **Preservation PDF download** — button in dashboard, route in tier2 (fixed 2026-02-19)
