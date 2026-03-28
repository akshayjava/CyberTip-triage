# Test Coverage Analysis

This document identifies the current state of test coverage in the CyberTip-triage codebase and proposes areas for improvement, ordered by risk and impact.

## Current Coverage Summary

The project uses **Vitest** with 16 test files (15 in `src/__tests__/` and 1 in `src/agents/__tests__/`). The test suite is well-structured and covers the most legally critical paths (Wilson compliance, agent behaviour, orchestrator wiring). However, several important modules have no tests at all.

---

## Areas to Improve

### 1. Authentication & Authorization (`src/auth/`)

**Priority: Critical** — security-sensitive, zero test coverage.

`src/auth/jwt.ts` exports `verifyToken`, `login`, `refreshSession`, `revokeToken`, `hashPassword`, `verifyPassword`, `hasRole`, `canAccessUnit`, `redactForAnalyst`, and `extractBearer`. None of these functions have tests.

Recommended tests:

```
src/__tests__/auth.test.ts
```

- `hashPassword` + `verifyPassword` round-trip
- `verifyPassword` returns false for wrong password, truncated hash, or malformed stored string
- `verifyToken` returns null for expired token, tampered signature, wrong number of segments, and revoked JTI
- `hasRole` enforces the analyst < investigator < supervisor < commander < admin hierarchy correctly
- `canAccessUnit` allows admin/commander cross-unit access and rejects other roles
- `redactForAnalyst` redacts name, email, and IP fields while leaving other fields intact
- `extractBearer` returns null for missing header, wrong prefix, and empty token
- `login` throws `AuthError` for unknown badge, inactive account, and wrong password
- `refreshSession` throws for expired inactivity window (mock `Date.now` to advance 31 minutes)

The PBKDF2 password hashing uses 100,000 iterations (correct for CJIS), but timing-safe comparison and the iteration-count parsing (`parseInt` with NaN guard) are currently exercised by no test.

---

### 2. Bundle Deduplication Engine (`src/ingestion/bundle_dedup.ts`)

**Priority: High** — complex stateful algorithm, zero test coverage, directly affects queue cost and investigator workload.

Recommended tests:

```
src/__tests__/bundle_dedup.test.ts
```

- `bundleFingerprint` produces the same output for two signatures that differ only in URL scheme (`http://` vs `https://`) or trailing query string
- `bundleFingerprint` produces different output when ESP name, hash, or week differ
- `toWeekStart` (via `extractSignature`) maps dates in the same Monday–Sunday window to the same week, and dates in adjacent weeks to different ones
- `extractSignature` falls back correctly when `esp_name` comes from `reporter.esp_name` instead of `classification.esp_name`
- `checkBundleDuplicate` returns `is_duplicate: false` for a non-bundled tip regardless of fingerprint
- `checkBundleDuplicate` returns `is_duplicate: false` for the first tip with a given fingerprint (it becomes the canonical)
- `checkBundleDuplicate` returns `is_duplicate: true` on the second tip with the same fingerprint, pointing at the first
- `foldDuplicateIntoCanonical` updates `bundled_incident_count` on the canonical tip and sets `status: "duplicate"` on the duplicate; both audit entries are written
- `shouldProcessTip` returns `true` for non-bundled tips and for the first instance of a bundle; returns `false` and calls fold for subsequent duplicates
- `getBundleStats` counts only non-duplicate bundled tips and tracks the largest bundle correctly

---

### 3. Three Agents with No Direct Unit Tests

**Priority: High** — only ever mocked in orchestrator tests; their internal LLM prompt construction, output parsing, and error handling are untested.

#### 3a. Extraction Agent (`src/agents/extraction.ts`)

```
src/__tests__/agents_extraction.test.ts  (or extend agents.test.ts)
```

- Successful extraction: mock `AnthropicProvider.runAgent` to return valid `ExtractedEntities` JSON; assert each entity list is populated
- Accessible-file rule: confirm the prompt sent to the LLM lists only files where `file_access_blocked === false`
- Malformed JSON from LLM: mock returns non-JSON text; assert agent throws or returns a safe empty entity set rather than crashing the pipeline
- Prompt injection in tip body: confirm the tip body is wrapped in `<tip_content>` delimiters before being sent
- Audit entry written on success and on failure

#### 3b. Hash/OSINT Agent (`src/agents/hash_osint.ts`)

```
src/__tests__/agents_hash_osint.test.ts
```

- AIG detection: mock returns `aig_csam_detected: true`; assert `any_match` is `true` and `match_sources` includes the expected source
- No hash matches: mock returns all-false; assert `any_match: false` and `per_file_results` is populated
- LLM failure: mock throws; assert agent fails safely (empty/neutral result, not an unhandled exception)
- Audit entry written

#### 3c. Linker Agent (`src/agents/linker.ts`)

```
src/__tests__/agents_linker.test.ts
```

- Deconfliction match returned by LLM: assert `deconfliction_matches` array is non-empty and `active_investigation` flag is preserved
- Duplicate tip detected: assert `is_duplicate: true` and `related_tip_ids` is populated
- Clean tip: assert `is_duplicate: false` and empty collections
- Cluster flag propagated from LLM output
- Malformed LLM JSON handled gracefully

---

### 4. LLM Provider Abstraction (`src/llm/providers/`)

**Priority: Medium** — the agentic tool-use loop and timeout logic are exercised only through agent tests that mock the SDK at the module level. The provider itself has no isolation tests.

Recommended tests:

```
src/__tests__/llm_provider.test.ts
```

- `AnthropicProvider.runAgent` with a single-shot response (no tool calls): mock `client.messages.create` once; assert returned text matches
- `AnthropicProvider.runAgent` with one round of tool use: mock first response as `stop_reason: "tool_use"`, second as `stop_reason: "end_turn"`; assert `executeToolCall` was called with the correct tool name and input
- Timeout: mock `messages.create` to never resolve within `timeoutMs`; assert the method rejects with a timeout message
- `maxIterations` cap: mock to always return `stop_reason: "tool_use"`; assert the loop stops after `maxIterations` and does not hang
- `getModelName` returns the env-var override when `LLM_MODEL_HIGH` etc. are set

---

### 5. Preservation Request Generation (`src/tools/preservation/`)

**Priority: Medium** — generates legal letters; incorrect jurisdiction detection or deadline calculation could produce invalid law enforcement documents.

Recommended tests:

```
src/__tests__/preservation.test.ts
```

- `generatePreservationRequest` with a US two-letter state code (e.g. `"CA"`) uses `18 U.S.C. § 2703(f)` as the legal basis
- `generatePreservationRequest` with `"UK"` or `"DE"` uses Budapest Convention Article 16
- `letter_text` contains the request ID, the ESP name, and all account identifiers
- `letter_text` explicitly states this is a preservation request (not disclosure) and requires a separate legal process for disclosure
- The computed deadline matches `getRetentionDeadline(espName, receivedAt)` when no `retentionDeadline` override is given
- A custom `retentionDeadline` override is respected verbatim

---

### 6. Warrant Tools (`src/tools/legal/warrant_tools.ts`)

**Priority: Medium** — the `get_warrant_status` and `update_warrant_status` tool functions are used by the Legal Gate agent but only through their helper exports (`seedWarrantStatus`, `clearWarrantStore`).

Recommended tests:

```
src/__tests__/warrant_tools.test.ts
```

- `getWarrantStatus` stub returns `"granted"` for `tip_id` prefixed with `"test_granted"` and `"pending_application"` for others
- `updateWarrantStatus` stub records the new status and is reflected by a subsequent `getWarrantStatus` call
- `seedWarrantStatus` correctly pre-loads a status that `getWarrantStatus` then returns
- Both functions run through `runTool` and therefore return `{ success: true, data: ... }` shape on the happy path and `{ success: false, error: ... }` when they throw

---

### 7. Missing Edge Cases in the Orchestrator

**Priority: Medium** — the current orchestrator tests cover the happy path and hard-gate failure, but not partial failures in the parallel stage.

Recommended additions to `src/__tests__/orchestrator.test.ts`:

- **Parallel stage partial failure**: mock `runExtractionAgent` to throw while `runHashOsintAgent` succeeds. Confirm the pipeline continues to classifier/linker/priority rather than stopping, and that the audit trail records the extraction failure.
- **Priority agent failure**: mock `runPriorityAgent` to throw. Confirm the returned tip has a safe fallback priority (e.g. IMMEDIATE tier, score 100) rather than crashing the caller.
- **STANDARD tier**: mock priority agent to return score 40, tier `"STANDARD"`. Confirm no supervisor alert and that `applyCriticalOverrides` does not elevate the score.
- **Europol/Interpol referral override**: mock classification with `interpol_referral_indicated: true`. Confirm the orchestrator sets the appropriate routing note.

---

### 8. Database Layer — Officers and Precedents

**Priority: Low-Medium** — used by auth and the legal gate but untested.

Recommended tests:

```
src/__tests__/db_officers.test.ts
```

- `upsertOfficer` persists a new officer and `getOfficerByBadge` retrieves it
- Duplicate badge number on upsert updates the record rather than duplicating it
- `isJTIRevoked` returns `false` before revocation and `true` after `revokeJTI` is called
- `recordLogin` does not throw and updates `last_login_at`

---

### 9. Fixture Category Coverage Gaps

**Priority: Low** — `src/__tests__/integration.test.ts` uses fixture categories 1–4, 11, and 14. The remaining fixture categories defined in `fixtures.ts` have no integration tests exercising their specific invariants.

Check whether `fixtures.ts` defines categories 5–10, 12–13, or beyond, and add integration tests for:

- Category 5 (E2EE data gap): confirm `e2ee_data_gap: true` in classification and an explanatory note in legal_status
- Category 6 (international jurisdiction): confirm `interpol_referral_indicated` is set when IP country is non-US
- Category 7 (deconfliction match): confirm `tier === "PAUSED"` and supervisor alert
- Category 8+ (whichever exist): assert their specific invariants

---

### 10. API — Tier 2 / Tier 3 Routes

**Priority: Low** — `src/auth/tier2_routes.ts` and `src/api/tier3_routes.ts` have no tests.

Recommended additions:

- Tier 2 `POST /auth/login` returns 401 for invalid credentials and a token + session for valid ones (use in-memory officer seeded via `upsertOfficer`)
- Tier 2 `POST /auth/refresh` returns 401 when the inactivity window has elapsed
- Tier 2 `POST /auth/logout` revokes the token so subsequent `verifyToken` calls return null
- Tier 3 routes return 401 without a valid token and 200/correct shape with one

---

## Quick-Win Test Additions

The following are small, self-contained tests that can be added to existing files with minimal effort and cover currently unchecked invariants:

| File to extend | Test to add |
|---|---|
| `agents.test.ts` | Intake agent handles `content_type: "xml"` source without calling the LLM |
| `agents.test.ts` | Priority agent returns `tier: "STANDARD"` when score < 60 |
| `agents.test.ts` | Legal Gate agent handles exigent-circumstances claim in LLM output (still conservative) |
| `wilson.test.ts` | `computeWarrantRequired` with `esp_viewed: true, publicly_available: true, esp_viewed_missing: false` → `false` (only missing flag triggers override) |
| `tools.test.ts` | `wrapTipMetadata` on nested object with arrays serialises correctly |
| `parsers.test.ts` | `parseNcmecPdfText` on a tip with **no files** returns empty `files` array (not a crash) |
| `parsers.test.ts` | `parseNcmecXml` on a multi-file tip (two `<FileDetails>` elements) returns both files |
| `db_repository.test.ts` | `listTips({ status: "BLOCKED" })` filter returns only BLOCKED tips |
| `api.test.ts` | `GET /api/tips` with `crisis_only=true` query param returns 200 |
