# CyberTip Triage — ICAC Investigator User Journeys

**Perspective:** Evaluated as a working ICAC investigator using the system day-to-day.  
**Last evaluated:** 2026-02-19  
**Status key:** ✅ Functional · ⚠ Works with friction · ❌ Gap/broken · 🔒 Enforced by system

---

## How to read this document

Each journey traces what an investigator *actually does*, what the system *actually does in response*, and where the gaps are. This is not aspirational — it reflects the code as it exists. Future development **must consult this document** before modifying any pipeline stage, API route, or dashboard component.

---

## Journey 1: First-Thing-in-the-Morning Queue Review

**Who:** On-call investigator starting a shift.  
**Goal:** See everything that came in overnight, prioritize, dispatch self.

### Steps & system behavior

1. **Open dashboard** → `http://localhost:3000/dashboard`  
   - StatsBar loads from `GET /api/stats` → shows IMMEDIATE / URGENT / PAUSED / CRISIS counts  
   - Queue loads from `GET /api/queue` → tips grouped by tier, sorted by score DESC  
   - 🔒 IMMEDIATE tips appear at top regardless of arrival time  
   - ✅ Real-time: any tip completing pipeline during review appears via SSE without page refresh  

2. **Scan TipRow badges**  
   - 🔒 AIG = AI-generated CSAM flag (never reduces severity)  
   - 🔒 CLU = part of a temporal cluster — pattern spans ≥3 tips, 90-day window  
   - 🔒 🌐 = international subject — MLAT may be required  
   - ✅ Sextortion crisis tips show pulsing red background in mobile view  

3. **Click into a tip → Overview tab**  
   - Offense category, severity, routing unit, recommended action  
   - Score breakdown with factor explanations  
   - Deconfliction banner (yellow) if another agency has an active investigation  

4. **Self-assign**  
   - "Assign to me" button → `POST /api/tips/:id/assign`  
   - Status changes to `assigned`, audit entry written  

### Gaps found
- ⚠ **No shift-change summary email.** Supervisors have no automated overnight summary — must open dashboard manually. *A nightly email digest from Priority Agent output would close this.*  
- ⚠ **Pagination not exposed in UI.** `GET /api/queue` supports `limit`/`offset` but the dashboard loads all 200 tips at once. At high volume (500+ tips/shift) the TipRow list becomes unwieldy.  
- ⚠ **No "unread" indicator.** Tips that arrived since the investigator last logged in look the same as tips they've already reviewed.

---

## Journey 2: Victim in Crisis — Sextortion with Suicidal Ideation

**Who:** On-call investigator, any hour.  
**Goal:** Immediately identify and dispatch a crisis case with a minor victim expressing suicidal ideation.

### Steps & system behavior

1. **Alert fires automatically** when Priority Agent sets `victim_crisis_alert = true`  
   - SMS sent via Twilio to the on-call number (production only)  
   - Email alert sent to supervisor inbox  
   - ✅ Mobile dashboard shows pulsing red crisis banner at top  
   - Crisis banner shows `victim_crisis_alert_text` (age, platform, quoted crisis indicators)  

2. **Open mobile dashboard** → `http://localhost:3000/mobile`  
   - Crisis tip appears in dedicated crisis lane at top of queue  
   - Tap → slide-up detail sheet shows victim age, crisis indicators verbatim, recommended action  
   - 🔒 System never reduces severity for sextortion + active crisis indicators  

3. **Investigator reads recommended action** from Priority Agent  
   - e.g., "Dispatch victim crisis intervention IMMEDIATELY. Contact school counselor and parents. Secure Instagram account evidence before deletion."  

4. **Issue preservation request** (before contacting platform)  
   - Preservation tab → "Issue Preservation Request" button  
   - `POST /api/preservation/:id/issue` → marks status `issued`, records `issued_at`  
   - `GET /api/preservation/:id/download` → returns signed PDF letter (from `letter_pdf.ts`)  
   - PDF addressed to ESP with account identifiers and 90-day legal basis (§ 2703(f))  

5. **Download and transmit PDF letter**  
   - PDF delivered to ESP via fax/email manually  

### Gaps found
- ❌ **No "Call victim welfare check" integration.** The system identifies crisis but there is no CAD/dispatch hook. The investigator must make a phone call. *Future: webhook to dispatch system with victim location if extractable.*  
- ⚠ **Preservation letter PDF download not linked from dashboard UI.** The `GET /api/preservation/:id/download` endpoint works and returns a proper PDF, but the main dashboard preservation tab only has an "Issue" button — no download button. Download requires knowing the direct URL. *Fix: add download icon to issued preservation rows in the dashboard.*  
- ⚠ **Mobile "Assign to me" not implemented.** Mobile view shows tip details but there is no assign button. Investigator must open desktop dashboard to self-assign.  
- ✅ SMS alert is correctly rate-limited to victim crisis tips only (not all IMMEDIATE tips).

---

## Journey 3: CSAM File — Wilson Compliance & File Access

**Who:** Investigator who received a CSAM tip where the ESP did not view the file.  
**Goal:** Understand which files are accessible, apply for a warrant, track it, and access the file once granted.

### Steps & system behavior

1. **Open tip → Files tab**  
   - Legal status banner shows: `"BLOCKED per Wilson (9th Cir.). ESP did not view file. Warrant required."`  
   - 🔒 `computeWarrantRequired()` is deterministic — LLM cannot override it  
   - 🔒 `computeFileAccessBlocked()` — file stays blocked until `warrant_status = 'granted'`  
   - Circuit is shown (e.g., "9th Circuit — BINDING: 13 F.4th 961")  
   - Files list shows each file with blocked/accessible badge  

2. **Open tip → Legal tab (Tier 4.1)**  
   - Fourth Amendment status card  
   - Full circuit analysis — binding vs. persuasive, case citation  
   - All-circuits quick reference  
   - Precedent history for this circuit  

3. **Apply for warrant**  
   - Files tab → "Pending Application" button (or via tier2 warrant workflow)  
   - `POST /api/tips/:id/warrant/:fileId` body: `{ status: "applied" }`  
   - File remains blocked (`warrant_status = 'applied'` ≠ `'granted'`)  
   - Audit entry written with previous/new status  

4. **Generate warrant affidavit** (Tier 2 route)  
   - `POST /api/warrant-applications/:id/generate-affidavit`  
   - Returns draft affidavit pre-populated with: tip facts, extracted entities, offense category, applicable statutes, file hash, circuit-specific warrant standard  
   - Investigator edits draft, submits to court  

5. **Record warrant grant**  
   - `POST /api/tips/:id/warrant/:fileId` body: `{ status: "granted", warrant_number: "...", granted_by: "..." }`  
   - 🔒 `file_access_blocked` set to `false` only when `warrant_status === 'granted'`  
   - `legal_status.any_files_accessible` and `all_warrants_resolved` updated in DB  
   - Audit entry records human actor, warrant number  

6. **File now accessible** — investigator can open it in their forensic tool  

### Gaps found
- ❌ **Warrant affidavit download not in main dashboard.** The affidavit generation endpoint (`tier2_routes.ts`) returns a structured draft but there is no UI button in the main dashboard to trigger it. Investigator must know the tier2 URL. *Fix: add "Generate Affidavit" button to Files tab when `warrant_status = 'applied'`.*  
- ⚠ **No warrant application tracking in queue view.** Tips with pending warrants aren't visually distinguished from tips awaiting other actions. A "🔐 Warrant Pending" badge in TipRow would surface this.  
- ✅ Wilson enforcement is airtight — repeated testing showed no path where `file_access_blocked` can be set to `false` by LLM output alone.  
- ✅ 7th Circuit exception (Reczek) is correctly implemented — IL/IN/WI don't require warrant when ESP reviewed.

---

## Journey 4: International Tip — MLAT Request Generation

**Who:** Investigator receiving a tip where the subject is in Canada or the Philippines.  
**Goal:** Generate the correct legal request for cross-border evidence with the right mechanism and timeline.

### Steps & system behavior

1. **Tip displays 🌐 badge** in queue (international subject detected)  
   - `tipHasInternational()` checks `jurisdiction_of_tip.countries_involved` for non-US countries  

2. **Open tip → MLAT tab** (auto-visible on international tips)  
   - Tab only appears if `tipHasInternational(tip)` is true  
   - Calls `GET /api/tips/:id/mlat` on first open  
   - `tipNeedsMLAT()` confirms international subjects exist  
   - `generateMLATRequest()` runs once per subject country  

3. **For a Canadian subject:**  
   - System recommends: **CLOUD Act bilateral** (CA signed 2022)  
   - Timeline shown: "2–4 weeks" (vs. 6–18 months for MLAT)  
   - No translation required  
   - DOJ OIA contact shown: `oiacriminal@usdoj.gov`  

4. **For a Philippines subject:**  
   - System recommends: **MLAT** (no CLOUD Act agreement)  
   - Preservation draft shown first (Budapest Article 16) — *send this before MLAT to prevent data deletion while waiting*  
   - Timeline: "6–18 months"  
   - Full request letter pre-populated with: tip facts, offense description, target accounts, applicable US statutes, treaty citation, confidentiality request  

5. **Download draft**  
   - "Download draft (.txt)" button creates a named file: `MLAT-2026-{TIP8CHAR}-CA.txt`  
   - Investigator submits to supervisor → routed to DOJ OIA  

### Gaps found
- ⚠ **`tipNeedsMLAT()` only checks `countries_involved` and top-level `extracted.subject_country`.** Tips where the international location only appears in extracted IP WHOIS data or dark web URLs will not trigger the MLAT tab. *The classification agent sets `mlat_likely_required` on the classification — this field should also trigger the tab.*  
- ⚠ **No MLAT tracking log.** Once the request is generated and downloaded, the system has no record that it was submitted. There is no `mlat_requests` table or status field. Tracking ID (`MLAT-2026-...`) is generated but not persisted. *Future: persist to DB so supervisors can track outstanding MLAT requests across all cases.*  
- ⚠ **14 countries pre-configured** — covers ~70% of international ICAC tips. Tips with subjects in unconfigured countries fall back to a generic DOJ OIA redirect. Countries commonly missing from the treaty database include: Colombia, Indonesia, Romania (actually present), Thailand, Vietnam. Check `mlat_generator.ts` TREATY_DATABASE and expand.  
- ✅ Budapest Article 16 preservation draft is always generated before the MLAT draft — this is the correct operational order.  
- ✅ CLOUD Act countries (CA, GB, AU) are correctly identified and prioritized over MLAT.

---

## Journey 5: Grooming Pattern — Cluster Alert & Escalation

**Who:** Supervisor reviewing flagged clusters.  
**Goal:** Identify a slow-building predator pattern across multiple tips over 90 days, escalate, and coordinate.

### Steps & system behavior

1. **Nightly cluster scan runs at 02:00**  
   - `startClusterScheduler()` fires `runClusterScan()` every 24 hours  
   - Scans 5 pattern types: IP subnet /24, school, gaming platform, geographic area, username normalization  
   - Any tip cluster ≥3 members in 90-day window is recorded  

2. **MONITOR tip auto-escalates to STANDARD** when cluster_size ≥ 3  
   - `applyClusterToTip()` updates `tip.links.cluster_flags` and `tip.priority.tier`  
   - Audit entry written: "Cluster escalation: ip_subnet, 4 tips in 90 days, cluster ID abc123"  
   - Upserted to DB  

3. **CLU badge appears** on affected tips in the queue  

4. **Supervisor opens tip → Clusters tab**  
   - Shows: cluster type, tip count, time window, cluster ID  

5. **Tier 4 Admin panel** → `http://localhost:3000/tier4` → Cluster Scan tab  
   - "Run Cluster Scan Now" button → `POST /api/jobs/cluster-scan`  
   - Shows: clusters found, tips escalated, duration, errors  
   - Bundle deduplication stats (viral incident dedup)  

6. **Supervisor clicks into Clusters tab for related tips** — sees which other tips share the cluster  

### Gaps found
- ❌ **No cluster summary view.** There is no "all active clusters" page — the supervisor must find cluster members by clicking individual tips. `GET /api/clusters` returns tips with cluster_flags but the tier4 admin doesn't display them in a grouped format. *Fix: add a cluster list view in the tier4 admin showing each cluster with its member tips linked.*  
- ❌ **In-memory cluster scan does not query historical data.** `scanFromMemory()` in dev mode only scans `memStore` which only holds tips processed in the current server session. On restart, historical patterns are lost. In production (PostgreSQL), the JSONB queries correctly span 90 days.  
- ⚠ **No supervisor email/SMS when cluster forms.** Cluster formation triggers an audit entry and an escalation but does not fire an alert to supervisors. Supervisors only see clusters when they log in. *Fix: call `sendEmailAlert()` from `applyClusterToTip()` when escalation fires.*  
- ⚠ **Username normalization is basic** — strips only trailing digits/underscores. Predators using variations like `boy_hunter` vs `BOY_HUNTER` vs `boyhunter` across platforms won't cluster. Case-insensitive normalization and Levenshtein distance would catch these.  
- ✅ Bundle deduplication correctly suppresses repeat processing of viral incidents (e.g., one widely-shared image generating 50,000 NCMEC tips).

---

## Journey 6: Quarterly OJJDP Report Submission

**Who:** Task force administrator, end of quarter.  
**Goal:** Generate the OJJDP quarterly statistical report and submit to DOJ.

### Steps & system behavior

1. **Access via tier2 admin panel** (no dashboard UI link)  
   - `GET /api/reports/ojjdp?year=2026&quarter=1&task_force_name=...`  
   - Returns structured report: case counts by offense type, victim demographics, clearance rates, preservation requests  

2. **Download CSV/PDF**  
   - `GET /api/reports/ojjdp/download?format=csv`  
   - Returns `ojjdp-{TF_ID}-2026-Q1.csv` or `.pdf`  

3. **Manual submission to OJJDP** — no integration  

### Gaps found
- ❌ **No dashboard entry point.** The OJJDP report endpoints exist in `tier2_routes.ts` and fully work, but there is no button or link anywhere in the dashboard to reach them. An investigator who doesn't know the URLs cannot find this feature. *Fix: add a "Reports" nav item to the dashboard header linking to the OJJDP export.*  
- ⚠ **Report is computed from live DB at request time** — not pre-aggregated. At large scale (10,000+ tips/quarter), this query will be slow. For now acceptable; add a caching layer before production scale.  
- ✅ Report correctly applies REPORT Act 2024 counting rules (includes "apparent" CSAM, not just hash-confirmed).

---

## Journey 7: Deconfliction — Avoiding Double Investigation

**Who:** Investigator opening a tip that another agency is already working.  
**Goal:** Not duplicate effort or inadvertently burn an undercover operation.

### Steps & system behavior

1. **Deconfliction banner appears automatically** on the tip detail header  
   - Yellow banner: "⚠ Deconfliction conflict: Active investigation by [Agency Name] — await supervisor coordination before proceeding."  
   - 🔒 Tip tier set to `PAUSED` by Priority Agent when `active_investigation = true`  
   - PAUSED tips surface in their own tier in the queue  

2. **Investigator does not proceed** — supervisor coordinates with the other agency  

3. **Supervisor resolves**  
   - Once resolved, manually changes status and tier via API  
   - Audit entry required  

### Gaps found
- ❌ **No "resolve deconfliction" button.** The deconfliction block requires a manual API call to un-PAUSE a tip. There is no UI control for this. *Fix: add a supervisor-only "Resolve Deconfliction" button in the tip header that un-pauses and logs the coordinating agency.*  
- ⚠ **Deconfliction check is simulated.** `runLinkerAgent()` queries a mock deconfliction database. In production, this must integrate with the real ICAC National Deconfliction Working Group database or state-level deconfliction tool (e.g., CAL-ICAC DEX, HIDTA tracker).  
- ✅ PAUSED tips are visually distinct in the queue and never auto-advance.

---

## Journey 8: Prompt Injection — Adversarial Tip Submission

**Who:** Bad actor submitting a tip with instructions embedded in the content, attempting to manipulate the AI agents.  
**Goal (of attacker):** Get the system to unblock files, reduce score, or suppress alerts.  
**Goal (of system):** Detect, sanitize, and process correctly regardless.

### System response

1. **Intake Agent** strips HTML/formatting, passes normalized text to downstream agents  
2. **Prompt Guard** (`compliance/prompt-guards.ts`) scans for injection patterns before each LLM call  
   - Detects: instruction resets ("ignore all previous"), role assignment ("you are now"), output format injection  
   - Logs detection to audit trail  
   - Sanitized version passed to LLM  
3. **🔒 LLM outputs cannot override deterministic Wilson logic**  
   - `file_access_blocked` is computed from `computeFileAccessBlocked()`, not from LLM output  
   - Even if LLM says "set file_access_blocked = false", `legal_gate.ts` step 7 discards that and uses deterministic value  
4. **🔒 Score floor**: `sextortion_victim_in_crisis = true` sets score floor of 90 regardless of LLM scoring  
5. **🔒 CSAM + confirmed minor → P1_CRITICAL** applied by `applyCriticalOverrides()` in orchestrator, post-LLM  

### Gaps found
- ✅ All critical enforcement is deterministic and post-LLM — prompt injection cannot affect Wilson compliance, crisis escalation, or severity overrides.  
- ⚠ **Injection detection in prompt-guards doesn't cover all vectors.** Unicode lookalike characters, base64-encoded instructions, and multi-language injection attempts are not explicitly handled. These are low probability in practice but should be monitored.  
- ✅ Prompt injection attempts are flagged in the audit trail for human review.

---

## Journey 9: New Precedent — Circuit Court Rules on Warrant Requirement

**Who:** Supervisor who reads that the 4th Circuit just issued a binding opinion clarifying warrant requirements.  
**Goal:** Record the new precedent, update the legal database, ensure all future tips in MD/VA/NC/SC/WV reflect the new standard.

### Steps & system behavior

1. **Open Tier4 Admin → Circuit Legal tab** → `http://localhost:3000/tier4`  
   - Click "Record New Precedent"  
   - Fill form: Circuit (4th), Case Name, Citation, Effect, Summary, Badge number  

2. **Submit → `POST /api/legal/precedents`**  
   - `recordPrecedentUpdate()` appends to `PRECEDENT_LOG` in memory  
   - Audit entry written: "New precedent recorded: [case] (4th Circuit, now_binding)"  
   - All future Legal Gate calls for 4th Circuit tips will include new precedent in LLM context  

3. **Manual step required:** Edit `CIRCUIT_RULES['4th']` in `src/compliance/circuit_guide.ts`  
   - Change `application` from `no_precedent_conservative` to `strict_wilson` (or as appropriate)  
   - Update `binding_precedent` field  
   - Increment `LAST_UPDATED`  

### Gaps found
- ❌ **Precedent log is in-memory only.** `PRECEDENT_LOG` is a module-level array. On server restart, any precedents added via the API are lost. The form submission is ephemeral. *Critical fix: persist precedent log to a `legal_precedents` table in PostgreSQL. On startup, hydrate the module array from DB.*  
- ❌ **API-submitted precedents don't update `CIRCUIT_RULES`.** Step 3 above is manual. The `recordPrecedentUpdate()` function only appends to the log — it does not change the actual `application` mode or `binding_precedent` field that `requiresWarrantByCircuit()` uses. This means a newly recorded binding precedent does NOT affect warrant decisions until a developer manually edits the code. This is a significant disconnect between the admin UI and the deterministic compliance engine. *Fix: persist circuit rule overrides to DB and load them at startup, so a supervisor action actually changes warrant behavior.*  
- ✅ Precedent log is included in Legal Gate LLM context so the LLM is aware of new opinions.  
- ✅ Audit trail records who added the precedent and when (chain of custody for legal standards).

---

## Journey 10: IDS Portal — Automated NCMEC Tip Ingestion

**Who:** System process (automated).  
**Goal:** Automatically retrieve new tips from the NCMEC IDS Portal, parse them, and enter them into the pipeline.

### System behavior

1. **Poller starts** with `startIdsPoller(config)` in `src/ingestion/ids_portal.ts`  
   - TOTP authentication (otplib) + HMAC-signed session  
   - Polls on configured interval (default: every 15 minutes)  
   - Downloads new tip ZIP archives from portal  
   - Extracts and parses tip PDFs via `ncmec_pdf.ts`  
   - Each parsed tip enqueued via `enqueueTip()`  

2. **Bundle deduplication** runs at enqueue time  
   - `checkBundleDuplicate()` fingerprints the tip (ESP name + incident timestamp + file hash prefix)  
   - Duplicate viral incidents folded into canonical tip — not re-processed  
   - Saves Anthropic API costs and prevents double-alerting  

3. **Queue worker picks up tip** → orchestrator runs full 8-agent pipeline  

### Gaps found
- ⚠ **Parser is PDF-based** (`ncmec_pdf.ts`). If NCMEC changes their PDF format, all ingestion breaks silently — tips get ingested with empty fields rather than failing loudly. *Fix: add field validation after parsing; if >50% of expected fields are empty, raise a parse failure alert.*  
- ⚠ **No retry on portal auth failure.** If TOTP drift causes auth failure, the poller stops silently until the next interval. *Fix: implement exponential backoff with admin alert on repeated auth failures.*  
- ✅ Bundle deduplication is correctly wired into the enqueue path, not as a post-process.  
- ✅ TOTP secret rotation is supported via environment variable — no code change needed.

---

## System-Wide Gaps (Cross-Journey)

These issues affect multiple journeys and should be prioritized:

### P0 — Critical

| Gap | Impact | Fix |
|-----|--------|-----|
| ~~**Precedent log not persisted to DB**~~ | ~~New circuit court rulings recorded by supervisors are lost on restart. Legal compliance is silently wrong.~~ | **FIXED (2026-02-19):** Migration `003_legal_precedents.sql` adds `legal_precedents` + `circuit_rule_overrides` tables. `hydrateFromDB()` in `circuit_guide.ts` loads them at startup. `savePrecedentToDB()` persists every new submission. |
| ~~**API-recorded precedents don't update warrant logic**~~ | ~~`CIRCUIT_RULES` are hardcoded; admin UI submissions don't change deterministic warrant decisions. Supervisor believes system is updated when it isn't.~~ | **FIXED (2026-02-19):** `recordPrecedentUpdate()` now mutates `CIRCUIT_RULES` in-memory on `now_binding` effect. `saveCircuitOverrideToDB()` persists the override. `loadCircuitOverridesFromDB()` restores it on restart. Supervisor action now immediately and durably affects `requiresWarrantByCircuit()`. |
| ~~**Preservation letter download missing from dashboard UI**~~ | ~~Investigators issue preservation requests but cannot download the PDF letter without knowing a hidden URL.~~ | **FIXED (2026-02-19):** `⬇ Download Letter (PDF)` button added to issued preservation request rows in dashboard. |

### P1 — High

| Gap | Impact | Fix |
|-----|--------|-----|
| **No cluster supervisor alert** | Clusters form silently. Supervisors only see them if they log in. Slow-building patterns may be missed. | Call `sendEmailAlert()` from `applyClusterToTip()` on escalation. |
| ~~**No "Resolve Deconfliction" UI**~~ | ~~PAUSED tips stay paused until someone calls the API directly.~~ | **FIXED (2026-02-19):** Supervisor-only "Resolve Deconfliction" button added to deconfliction banner. |
| ~~**OJJDP report not accessible from dashboard**~~ | ~~Feature exists but is invisible to most users.~~ | **FIXED (2026-02-19):** `OJJDP ⬇`, `Mobile`, `Quick Ref`, and `Admin` links added to dashboard top bar. |
| ~~**Warrant affidavit download not in dashboard**~~ | ~~Affidavit generation exists in tier2 but investigators don't know how to reach it.~~ | **FIXED (2026-02-19):** `📄 Generate Affidavit` button added to Files tab when `warrant_status = 'applied'`. |
| **MLAT tracking not persisted** | Generated MLAT requests are not recorded anywhere. Supervisors can't see which MLATs are outstanding. | Add `mlat_requests` table; persist on generation. |

### P2 — Medium

| Gap | Impact | Fix |
|-----|--------|-----|
| ~~**No shift-change digest email**~~ | ~~Supervisors start shifts blind without overnight summary.~~ | Add nightly summary email. |
| ~~**Mobile: no assign button**~~ | ~~Investigators on mobile can't self-assign.~~ | Add assign button to mobile slide-up detail sheet. |
| ~~**`tipNeedsMLAT()` misses some international signals**~~ | ~~Tips where international location is only in IP WHOIS won't show MLAT tab.~~ | **FIXED (2026-02-19):** `tipHasInternational()` now checks `classification.mlat_likely_required`. |
| ~~**Cluster list view missing from admin**~~ | ~~No way to see all active clusters grouped with member tips.~~ | Add cluster list to tier4 admin Cluster Scan tab. |
| ~~**Pagination: dashboard loads all 200 tips at once**~~ | ~~At high volume the TipRow list becomes unwieldy and slow.~~ | **FIXED (2026-02-19):** Dashboard now loads 25 tips per page with Prev/Next controls. Page resets when switching tier filter. Poll interval extended to 15s. Total count shown per tier from stats. |
| ~~**PDF parser silent failure**~~ | ~~NCMEC format changes cause silent empty-field ingestion.~~ | Add field presence validation post-parse. |

---

## What the System Does Very Well

These are robust and should not be changed without careful consideration:

- 🔒 **Wilson enforcement is airtight.** `computeFileAccessBlocked()` is deterministic, runs before and after the LLM, and LLM output cannot override it. This is the most legally critical invariant in the system.
- 🔒 **Sextortion crisis floor.** `victim_crisis_alert = true` forces score ≥ 90 and tier = IMMEDIATE. This is hardcoded in Priority Agent and `applyCriticalOverrides()` in the orchestrator.
- 🔒 **AIG-CSAM never reduces severity.** AI-generated CSAM is correctly charged under § 1466A with no severity reduction.
- 🔒 **CSAM + confirmed minor = P1_CRITICAL.** `applyCriticalOverrides()` runs post-LLM in the orchestrator.
- 🔒 **Audit trail is append-only.** Every human action, agent decision, and warrant change is logged. Chain of custody is complete.
- ✅ **Bundle dedup handles viral incidents.** One widely-shared image generating 50,000 NCMEC tips is correctly collapsed to a single canonical tip.
- ✅ **CLOUD Act is prioritized over MLAT** for CA/GB/AU — cutting estimated evidence timeline from 6–18 months to 2–6 weeks.
- ✅ **In-memory fallback** works correctly in dev/test — no Postgres or Redis required to run the system.

---

## Development Rules — Derived from These Journeys

Future developers must follow these rules. They exist because real investigators' ability to do their jobs — and comply with federal law — depends on them.

1. **Never let LLM output override `file_access_blocked`.** `computeFileAccessBlocked()` is the authority. LLM enriches; it does not decide.

2. **Never add a code path where CSAM + confirmed minor victim gets a tier below IMMEDIATE.** `applyCriticalOverrides()` must always win.

3. **Never remove the deconfliction check** from the Linker Agent. An investigator who burns an undercover operation creates real harm.

4. **Any new agent output that affects file access or severity MUST be deterministic**, not LLM-derived. LLM outputs are useful; they are not authoritative on Fourth Amendment questions.

5. **Every human action (warrant update, assignment, preservation issue) MUST write an audit entry** via `appendAuditEntry()`. Chain of custody is non-negotiable.

6. **If you add a new legal feature (new statute, new circuit rule, new treaty), update this document.** A feature that isn't reflected in a journey may not be reachable by investigators.

7. **The REPORT Act 2024 "apparent CSAM" standard applies to tip counting**, not just hash-confirmed CSAM. OJJDP reports and stats must count on this basis.

8. **Budapest Article 16 preservation comes before MLAT**. Always. The preservation draft must always be generated alongside the MLAT draft, not as an afterthought.

9. **Cluster escalation must write an audit entry.** Supervisors need to know why a tip tier changed.

10. **Remaining P2 gaps** (shift-change digest, mobile assign button, cluster list view, PDF parser validation) are lower priority and do not block production deployment.

---

*This document is the authoritative record of how ICAC investigators interact with this system. It supersedes any aspirational feature descriptions. When in doubt about intended behavior, refer here first.*
