# SKILLS.md — CyberTip Triage Developer Workflows

Reusable task patterns and step-by-step guides for common development work on this codebase.
Reference `CLAUDE.md` for architecture context and `BACKLOG.md` for open issues.

---

## Table of Contents

1. [Before any change](#1-before-any-change)
2. [Fix a bug](#2-fix-a-bug)
3. [Add a new pipeline agent stage](#3-add-a-new-pipeline-agent-stage)
4. [Add a new ingestion source](#4-add-a-new-ingestion-source)
5. [Add or update a legal compliance rule](#5-add-or-update-a-legal-compliance-rule)
6. [Add a new database migration](#6-add-a-new-database-migration)
7. [Add a new API route](#7-add-a-new-api-route)
8. [Add a new dashboard page or panel](#8-add-a-new-dashboard-page-or-panel)
9. [Write a test](#9-write-a-test)
10. [Add a new investigative tool](#10-add-a-new-investigative-tool)
11. [Update circuit / legal precedent logic](#11-update-circuit--legal-precedent-logic)
12. [Work on a backlog item](#12-work-on-a-backlog-item)
13. [Pre-commit checklist](#13-pre-commit-checklist)

---

## 1. Before any change

Always run these two gates first. They must be clean before and after your change.

```bash
npm run typecheck   # Zero TypeScript errors required
npm test            # All Vitest tests must pass
```

Read the relevant documents before touching the affected subsystem:

| Subsystem | Read first |
|-----------|-----------|
| Pipeline logic, agent behaviour | `CLAUDE.md`, `AGENTS.md` |
| Investigator-facing features | `USER_JOURNEYS.md` |
| Legal / compliance | `CLAUDE.md` § "Non-negotiable legal invariants" |
| Tests | `AUDIT_REPORT.md` (avoid duplicate coverage) |
| Env config / ingestion | `SETUP_GUIDE.md` |
| Open bugs / priorities | `BACKLOG.md` |

---

## 2. Fix a bug

1. **Identify** the affected files from `BACKLOG.md` or the bug report.
2. **Read** the current implementation before editing.
3. **Write a failing test** in `src/__tests__/` or `src/agents/__tests__/` that reproduces the bug.
4. **Apply the fix** — minimal change, no unrelated refactors.
5. **Verify** `npm run typecheck && npm test` are both clean.
6. If the fix touches legal logic (Wilson, audit, priority overrides), run a specific check:

```bash
# Legal path smoke test (in-memory, no API key needed)
DEMO_MODE=true npm run dev &
sleep 3
curl -s -X POST http://localhost:3000/intake/public \
  -H "Content-Type: application/json" \
  -d '{"ncmec_tip_number":"TEST-001","reporter":{"esp_name":"TestESP"},"files":[]}' | jq .
kill %1
```

7. Append an entry to the fixed bug in `BACKLOG.md` marking it resolved.

---

## 3. Add a new pipeline agent stage

> See `src/orchestrator.ts` for how stages are wired together.

### Files to create / modify

| Action | File |
|--------|------|
| Create agent | `src/agents/<name>.ts` |
| Wire into pipeline | `src/orchestrator.ts` |
| Define output schema | `src/models/<name>.ts` (or extend existing) |
| Export schema | `src/models/index.ts` |
| Add tests | `src/agents/__tests__/<name>.test.ts` |

### Agent skeleton

```typescript
// src/agents/<name>.ts
import { getLLMProvider } from "../llm/index.js";
import { appendAuditEntry } from "../compliance/audit.js";
import type { CyberTip } from "../models/index.js";

export async function runMyAgent(tip: CyberTip): Promise<MyAgentOutput> {
  try {
    const text = await getLLMProvider().runAgent({
      role: "medium",           // "fast" | "medium" | "high"
      system: SYSTEM_PROMPT,
      userMessage: `<tip_content>${JSON.stringify(tip)}</tip_content>`,
    });

    const result = parseOutput(text);

    await appendAuditEntry({
      tip_id: tip.ncmec_tip_number,
      agent: "MyAgent",
      timestamp: new Date().toISOString(),
      status: "success",
      summary: "One-line description of what was determined",
    });

    return result;
  } catch (err) {
    await appendAuditEntry({
      tip_id: tip.ncmec_tip_number,
      agent: "MyAgent",
      timestamp: new Date().toISOString(),
      status: "error",
      summary: String(err),
    });
    throw err;
  }
}
```

### Rules

- **Always** wrap tip body in `<tip_content>` delimiters before sending to LLM.
- **Always** write an audit entry on success and on error.
- **Never** import `@anthropic-ai/sdk` directly — use `getLLMProvider()`.
- **Never** call another agent directly — all calls go through `orchestrator.ts`.
- Legal Gate failures are hard stops — do not catch `LegalGateBlockedError` and continue.

---

## 4. Add a new ingestion source

### Files to create / modify

| Action | File |
|--------|------|
| Source implementation | `src/ingestion/<source>.ts` |
| Register HTTP endpoint | `src/ingestion/routes.ts` |
| Update config | `src/ingestion/config.ts` |
| Add env vars | `.env.example` |
| Document | `SETUP_GUIDE.md` |

### Required call sequence

```typescript
// MUST happen in this order — never skip dedup
const isDuplicate = await checkBundleDuplicate(tip);
if (!isDuplicate) {
  await enqueueTip(tip);
}
```

### Authentication patterns by source type

| Type | Pattern |
|------|---------|
| ESP direct push | HMAC-SHA256 signature on body |
| Agency API | `X-Agency-Key` header (validated against agency registry) |
| Public intake | Rate-limit 5 req/min/IP; no auth |
| NCMEC | TOTP (IDS Portal) or API key (XML API) |

---

## 5. Add or update a legal compliance rule

> **Caution.** These rules affect real investigations. Get a second review.

### Wilson (Fourth Amendment file blocking)

All warrant/file-access logic lives in `src/compliance/wilson.ts`.

- `computeWarrantRequired(file)` — returns boolean deterministically
- `computeFileAccessBlocked(file)` — returns boolean deterministically
- `assertFileAccessible(file)` — throws `WilsonBlockedError` if blocked

**Do not** add any LLM-driven path that can override these functions.
After changing Wilson logic, run:

```bash
npm run typecheck && npm test
grep -r "computeWarrantRequired\|computeFileAccessBlocked\|assertFileAccessible" src/ --include="*.ts"
```

Check every call site still applies the rule correctly.

### Circuit precedent

Add new precedent to `src/compliance/statutes.ts` → `CIRCUIT_PRECEDENT_MAP`.
Persist via `src/db/precedents.ts` so overrides survive restart.

### Sextortion / CSAM critical overrides

`applyCriticalOverrides()` lives in `src/orchestrator.ts`.
Any new "always-critical" rule must be added there — not in the LLM prompt.

### Adding a new statute

1. Add to `src/compliance/statutes.ts` with the full USC citation.
2. Map to `OffenseCategory` in `src/models/classification.ts` if needed.
3. Reference in the relevant agent's system prompt.
4. Add a unit test in `src/__tests__/` that verifies the statute is applied to appropriate tip types.

---

## 6. Add a new database migration

1. Create `src/db/migrations/00N_<description>.sql` (increment N from highest existing).
2. Follow the pattern of existing migrations — include `IF NOT EXISTS` guards.
3. **Never** add `DROP TABLE` or `DELETE FROM audit_log` — the audit log is forensic evidence.
4. Expose a TypeScript data-access function in `src/db/<table>.ts`.
5. Test with both in-memory (mock) and PostgreSQL paths.

```bash
# Apply migration manually
npm run db:migrate

# Or for Docker production stack
docker compose --profile production up --build
```

---

## 7. Add a new API route

### Files to modify

| Route type | File |
|-----------|------|
| Core tip/queue/cluster API | `src/api/routes.ts` |
| Warrant/OJJDP/preservation | `src/auth/tier2_routes.ts` |
| Hash integration management | `src/api/tier3_routes.ts` |
| Setup wizard | `src/api/setup_routes.ts` |
| Ingestion endpoints | `src/ingestion/routes.ts` |

### Checklist for every new route

- [ ] Rate limiting applied (import from `src/middleware/rate-limit.ts`)
- [ ] Auth middleware applied if `AUTH_ENABLED=true` path (see `src/auth/middleware.ts`)
- [ ] Input validated with Zod schema (define in `src/models/`)
- [ ] Human actions (assign, warrant update, preservation issue) write an audit entry
- [ ] 400 returned for invalid input, 404 for missing tip, 500 only for unexpected errors
- [ ] Integration test added in `src/__tests__/`

---

## 8. Add a new dashboard page or panel

Dashboard pages are static HTML in `dashboard/`. No build step. React loads via CDN.

### Add a new page

1. Create `dashboard/<name>.html` (copy structure from `dashboard/status.html` as a minimal template).
2. Register the route in `src/index.ts`:

```typescript
app.get("/<name>", (_req, res) => {
  res.sendFile(path.join(__dirname, "../dashboard/<name>.html"));
});
```

3. Add the link to `dashboard/index.html` nav or `dashboard/quickstart.html` reference card.
4. Document the page in `USER_JOURNEYS.md` under the relevant investigator journey.

### Add a panel to an existing page

- All dashboard pages use SSE (`EventSource`) for live updates — follow the pattern in `dashboard/index.html`.
- Use `GET /api/queue` for tip list data, `GET /api/tips/:id` for detail.
- Tier4 admin uses `GET /api/clusters`, `GET /api/tips/:id/mlat`, and `GET /api/circuit`.

---

## 9. Write a test

### File placement

| Test type | Location |
|-----------|---------|
| Agent unit tests | `src/agents/__tests__/<agent>.test.ts` |
| API / integration tests | `src/__tests__/<feature>.test.ts` |
| Compliance / legal unit tests | `src/__tests__/compliance.test.ts` |

### Test skeleton

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Anthropic — ALWAYS do this in any file that touches agents
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: '{"result": "ok"}' }],
        stop_reason: "end_turn",
      }),
    },
  })),
}));

// Use fixtures for tip data — don't hand-craft raw tips
import { createMockTip } from "../fixtures.js";

describe("MyFeature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should do X when Y", async () => {
    const tip = createMockTip({ /* overrides */ });
    // ...test body...
    expect(result).toMatchObject({ /* expected */ });
  });
});
```

### Rules

- Check `AUDIT_REPORT.md` first — don't duplicate existing coverage.
- Use `src/__tests__/fixtures.ts` for tip data (225 synthetic tips across 15 categories).
- Mock all LLM calls — tests must run without an Anthropic API key.
- No external services — `DB_MODE=memory` and `QUEUE_MODE=memory` are the defaults.
- Wilson enforcement tests must verify the *deterministic* path, not the LLM path.

---

## 10. Add a new investigative tool

Tools are the functions that pipeline agents call via the LLM tool-use API.

### Files to create / modify

| Action | File |
|--------|------|
| Tool implementation | `src/tools/<category>/<tool_name>.ts` |
| Register tool definition | `src/tools/index.ts` |
| Define tool types | `src/tools/types.ts` (if new category) |

### Tool skeleton

```typescript
// src/tools/<category>/<tool_name>.ts
import type { ToolResult } from "../types.js";

export async function myTool(params: MyToolParams): Promise<ToolResult> {
  // In TOOL_MODE=stub: return realistic fake data
  if (process.env.TOOL_MODE !== "real") {
    return { success: true, data: STUB_RESPONSE };
  }
  // Real implementation here
}

export const MY_TOOL_DEFINITION = {
  name: "my_tool",
  description: "What this tool does for the agent",
  input_schema: {
    type: "object" as const,
    properties: { /* params */ },
    required: ["param1"],
  },
};
```

### Rules

- **Always** provide a stub path for `TOOL_MODE=stub` (dev/test).
- **Never** make real external calls in tests — use stubs or mocks.
- Register in `src/tools/index.ts` so agents can reference the tool definition.
- Deconfliction and hash tools require LE registration for real mode — document this clearly.

---

## 11. Update circuit / legal precedent logic

Circuit guidance lives in `src/compliance/circuit_guide.ts`.

### Add a new circuit precedent

```typescript
// In src/compliance/statutes.ts — CIRCUIT_PRECEDENT_MAP
CIRCUIT_PRECEDENT_MAP["5th"] = {
  warrantRequired: true,
  basis: "United States v. Smith, 5th Cir. 2023",
  notes: "Aligns with Wilson; warrants required for ESP-unviewed files",
};
```

### Persist a runtime circuit override

Circuit rule overrides entered via the tier4 admin UI are persisted through `src/db/precedents.ts` — `saveCircuitRuleOverride()` / `getCircuitRuleOverride()`. They survive server restart (PostgreSQL) or are ephemeral (memory mode).

### Test circuit logic

```bash
# Verify circuit detection for a specific state
curl -s http://localhost:3000/api/circuit?state=TX | jq .
```

---

## 12. Work on a backlog item

1. Find the item in `BACKLOG.md` — note the priority (P0/P1/P2) and affected files.
2. P0 items are production blockers — fix these first.
3. For each item:
   - Read the affected files listed in the bug description.
   - Follow the relevant skill workflow above (fix a bug / add a route / add a migration).
   - Mark the item resolved in `BACKLOG.md` with the fix date.
4. For new features that investigators will use, add a step or note to the relevant journey in `USER_JOURNEYS.md`.

**Current P0 items** (as of 2026-03-17):

| ID | Description | Key files |
|----|-------------|-----------|
| BUG-001 | Warrant status value mismatch | `src/models/tip.ts`, `src/agents/legal_gate.ts` |
| BUG-002 | Circuit warrant logic not wired | `src/agents/legal_gate.ts`, `src/compliance/circuit_guide.ts` |
| BUG-003 | BullMQ new Queue per enqueue | `src/ingestion/queue.ts` |
| BUG-004 | Public intake no rate limiting | `src/ingestion/routes.ts` |
| BUG-005 | In-memory queue race condition | `src/ingestion/queue.ts` |
| BUG-006 | No timeout on Anthropic API calls | all agent files |

---

## 13. Pre-commit checklist

Run through this before every commit:

```bash
# Gates — both must be clean
npm run typecheck
npm test

# Optional: coverage (check for regressions)
npm run test:coverage
```

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 — no skipped tests hiding failures
- [ ] No `console.log` added to production paths (use `src/utils/logger.ts`)
- [ ] All new human actions write an audit entry via `appendAuditEntry()`
- [ ] Tip body text wrapped in `<tip_content>` before any LLM call
- [ ] Wilson enforcement remains deterministic — no LLM override paths added
- [ ] `.env`, `*.pdf`, `*.zip`, actual tip data not staged (`git status` check)
- [ ] New legal features documented in `USER_JOURNEYS.md`
- [ ] BACKLOG items fixed are marked resolved in `BACKLOG.md`

---

*Last updated: 2026-03-17*
