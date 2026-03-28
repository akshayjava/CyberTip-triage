/**
 * Warrant Workflow
 *
 * TIER 2.2 FEATURE — Tracks the lifecycle of search warrant applications
 * for file access blocked by the Legal Gate Agent (Wilson compliance).
 *
 * Problem: When the Legal Gate blocks files (esp_viewed=false, no warrant),
 * investigators have no structured way to track warrant applications through
 * drafting → DA review → court filing → grant/denial. Files remain blocked
 * until manually updated via the warrant API endpoint.
 *
 * Solution:
 *   1. Priority Agent notes blocked files and suggests warrant language
 *   2. Investigator opens a warrant application via POST /api/tips/:id/warrant/apply
 *   3. System pre-fills affidavit from extracted entities (subject, files, timeline)
 *   4. Supervisor approves draft → DA files → court issues/denies
 *   5. On grant: updateFileWarrant() called → files auto-unblock → SSE event fired
 *
 * Affidavit template:
 *   Based on 18 U.S.C. § 2703(a) (warrant for stored content) language.
 *   Incorporates extracted tip data: IP, email, account IDs, timeline, victim age.
 *   Cites NCMEC CyberTipline report number and REPORT Act mandatory reporting.
 *
 * Auto-unblocking:
 *   When warrant_status → "granted":
 *     - All files covered by warrant: file_access_blocked = false
 *     - audit_log entry with warrant_number + granting judge
 *     - Investigator email notification (existing alert tools)
 *     - SSE event "warrant_granted" → dashboard UI unlocks file tabs
 */

import { updateFileWarrant } from "../../db/tips.js";
import { getPool } from "../../db/pool.js";
import type { CyberTip } from "../../models/index.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WarrantApplicationStatus =
  | "draft"               // Being written by investigator
  | "pending_da_review"   // Submitted to DA's office
  | "pending_court"       // Filed with court
  | "granted"             // Court issued warrant
  | "denied"              // Court denied; note reason
  | "withdrawn";          // Application withdrawn

export interface WarrantApplication {
  application_id: string;
  tip_id: string;
  file_ids: string[];               // Files this warrant covers
  status: WarrantApplicationStatus;
  affidavit_draft: string;         // Pre-filled from extracted entities
  warrant_number?: string;         // Assigned when granted
  granting_judge?: string;
  court?: string;
  da_name?: string;
  submitted_at?: string;
  filed_at?: string;
  decided_at?: string;
  denial_reason?: string;
  created_by: string;              // Officer badge number
  approved_by?: string;            // Supervisor badge number
  created_at: string;
  updated_at: string;
}

// ── In-memory store (Fallback when DB_MODE != postgres) ───────────────────────

const applicationStore = new Map<string, WarrantApplication>();

function isPostgres(): boolean {
  return process.env["DB_MODE"] === "postgres";
}

// ── Affidavit builder ─────────────────────────────────────────────────────────

/**
 * Pre-populate warrant affidavit language from extracted tip data.
 *
 * The investigator must review and supplement this draft.
 * It is intentionally sparse on specifics to avoid misrepresentation.
 */
export function buildAffidavitDraft(tip: CyberTip): string {
  const ext = tip.extracted;
  const cls = tip.classification;
  const blockedFiles = tip.files.filter((f: any) => f.file_access_blocked);

  const subjectDesc = ext?.subjects?.length
    ? ext.subjects.map((s: Record<string, unknown>) => s["username"] ?? s["name"] ?? "Unknown").join(", ")
    : "[SUBJECT IDENTIFIER — complete from extracted entities]";

  const accountIds = ext?.digital_artifacts?.length
    ? (ext.digital_artifacts as Array<Record<string, unknown>>)
        .filter((a) => a["type"] === "account_id" || a["type"] === "email")
        .map((a) => `${a["platform"] ?? "platform"}: ${a["value"]}`)
        .join("\n      ")
    : "[ACCOUNT IDENTIFIERS — complete from extracted entities]";

  const offenseCategory = cls?.offense_category ?? "[OFFENSE CATEGORY]";
  const ncmecNumber = tip.ncmec_tip_number ? `NCMEC CyberTipline Report #${tip.ncmec_tip_number}` : "[NCMEC Report Number]";

  return `
AFFIDAVIT IN SUPPORT OF APPLICATION FOR SEARCH WARRANT
(DRAFT — REQUIRES INVESTIGATOR REVIEW AND LEGAL COUNSEL APPROVAL)

I, [OFFICER NAME], Badge No. [BADGE NUMBER], being duly sworn, state as follows:

1. INTRODUCTION
   I am a [TITLE] with the [AGENCY NAME], assigned to the Internet Crimes
   Against Children (ICAC) Task Force. I have [X] years of experience
   investigating internet crimes against children.

2. PURPOSE
   This affidavit supports an application for a search warrant pursuant to
   18 U.S.C. § 2703(a) to compel [ESP NAME] to disclose the contents of
   stored electronic communications and associated records.

3. PROBABLE CAUSE
   On or about ${new Date(tip.received_at).toLocaleDateString()}, this agency
   received ${ncmecNumber}, reporting suspected ${offenseCategory} activity
   associated with the following account(s):

      ${accountIds}

   Subject identifier(s): ${subjectDesc}

   The reporting Electronic Service Provider (ESP) transmitted this report
   pursuant to 18 U.S.C. § 2258A. The REPORT Act (Pub. L. 118-58, 2024)
   requires mandatory reporting of ${offenseCategory} activity.

4. ITEMS TO BE SEIZED
   All stored electronic communications, records, and information associated
   with the above account(s), including:
   a. Account registration information
   b. IP address logs and login records
   c. All content, files, and communications associated with the account
   d. Device identifiers and metadata

   SPECIFIC FILES (${blockedFiles.length} files currently blocked pending warrant):
   ${blockedFiles.map((f: any, i: number) => `   ${i + 1}. File ID: ${f.file_id} | Type: ${f.media_type}`).join("\n")}

5. CONCLUSION
   Based on the foregoing, I respectfully request that this Court issue a
   search warrant authorizing the search of the accounts described herein.

[SIGNATURE BLOCK — complete before filing]

DRAFT — Internal Reference: ${tip.tip_id}
Generated: ${new Date().toISOString()}
`.trim();
}

// ── Workflow functions ────────────────────────────────────────────────────────

/** Open a new warrant application for a tip's blocked files */
export async function openWarrantApplication(
  tip: CyberTip,
  createdBy: string,
  daName?: string,
  court?: string
): Promise<WarrantApplication> {
  const { randomUUID } = await import("crypto");
  const now = new Date().toISOString();

  const blockedFileIds = tip.files
    .filter((f: any) => f.file_access_blocked)
    .map((f: any) => f.file_id);

  const application: WarrantApplication = {
    application_id: randomUUID(),
    tip_id: tip.tip_id,
    file_ids: blockedFileIds,
    status: "draft",
    affidavit_draft: buildAffidavitDraft(tip),
    da_name: daName,
    court,
    created_by: createdBy,
    created_at: now,
    updated_at: now,
  };

  if (!isPostgres()) {
    applicationStore.set(application.application_id, application);
    return application;
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO warrant_applications (
       application_id, tip_id, file_ids, status, affidavit_draft,
       da_name, court, created_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      application.application_id,
      application.tip_id,
      JSON.stringify(application.file_ids),
      application.status,
      application.affidavit_draft,
      application.da_name ?? null,
      application.court ?? null,
      application.created_by,
      application.created_at,
      application.updated_at
    ]
  );

  return application;
}

/** Record a granted warrant — triggers file unblocking */
export async function recordWarrantGrant(
  applicationId: string,
  warrantNumber: string,
  grantingJudge: string,
  approvedBy: string
): Promise<WarrantApplication | null> {
  let app: WarrantApplication | null = null;
  const now = new Date().toISOString();

  if (!isPostgres()) {
    app = applicationStore.get(applicationId) ?? null;
    if (!app) return null;

    app.status = "granted";
    app.warrant_number = warrantNumber;
    app.granting_judge = grantingJudge;
    app.approved_by = approvedBy;
    app.decided_at = now;
    app.updated_at = now;
    applicationStore.set(applicationId, app);
  } else {
    const pool = getPool();
    const result = await pool.query<WarrantApplication>(
      `UPDATE warrant_applications SET
         status = 'granted',
         warrant_number = $1,
         granting_judge = $2,
         approved_by = $3,
         decided_at = $4,
         updated_at = $5
       WHERE application_id = $6
       RETURNING *`,
      [warrantNumber, grantingJudge, approvedBy, now, now, applicationId]
    );
    app = result.rows[0] ?? null;
  }

  if (!app) return null;

  // Unblock all files covered by this warrant
  // Note: updateFileWarrant writes to DB (if postgres) and handles audit log
  for (const fileId of app.file_ids) {
    await updateFileWarrant(app.tip_id, fileId, "granted", warrantNumber, grantingJudge);
  }

  return app;
}

/** Submit warrant application to DA for review */
export async function submitWarrantToDA(
  applicationId: string,
  daName?: string
): Promise<WarrantApplication | null> {
  const now = new Date().toISOString();

  if (!isPostgres()) {
    const app = applicationStore.get(applicationId);
    if (!app) return null;

    app.status = "pending_da_review";
    if (daName) app.da_name = daName;
    app.submitted_at = now;
    app.updated_at = now;
    applicationStore.set(applicationId, app);
    return app;
  }

  const pool = getPool();
  const result = await pool.query<WarrantApplication>(
    `UPDATE warrant_applications SET
       status = 'pending_da_review',
       da_name = COALESCE($1, da_name),
       submitted_at = $2,
       updated_at = $3
     WHERE application_id = $4
     RETURNING *`,
    [daName ?? null, now, now, applicationId]
  );

  return result.rows[0] ?? null;
}

/** Record a denied warrant */
export async function recordWarrantDenial(
  applicationId: string,
  denialReason: string
): Promise<WarrantApplication | null> {
  const now = new Date().toISOString();

  if (!isPostgres()) {
    const app = applicationStore.get(applicationId);
    if (!app) return null;

    app.status = "denied";
    app.denial_reason = denialReason;
    app.decided_at = now;
    app.updated_at = now;
    applicationStore.set(applicationId, app);
    return app;
  }

  const pool = getPool();
  const result = await pool.query<WarrantApplication>(
    `UPDATE warrant_applications SET
       status = 'denied',
       denial_reason = $1,
       decided_at = $2,
       updated_at = $3
     WHERE application_id = $4
     RETURNING *`,
    [denialReason, now, now, applicationId]
  );
  return result.rows[0] ?? null;
}

/** Get all warrant applications for a tip */
export async function getWarrantApplications(tipId: string): Promise<WarrantApplication[]> {
  if (!isPostgres()) {
    return Array.from(applicationStore.values()).filter((a: any) => a.tip_id === tipId);
  }

  const pool = getPool();
  const result = await pool.query<WarrantApplication>(
    `SELECT * FROM warrant_applications WHERE tip_id = $1 ORDER BY created_at DESC`,
    [tipId]
  );
  return result.rows;
}

/** Get a single warrant application by ID (O(1) lookup) */
export async function getWarrantApplicationById(applicationId: string): Promise<WarrantApplication | undefined> {
  if (!isPostgres()) {
    return applicationStore.get(applicationId);
  }

  const pool = getPool();
  const result = await pool.query<WarrantApplication>(
    `SELECT * FROM warrant_applications WHERE application_id = $1`,
    [applicationId]
  );
  return result.rows[0] ?? undefined;
}

/** For testing — clear the application store */
export function clearApplicationStore(): void {
  applicationStore.clear();
}
