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

// ── In-memory store (Tier 2.2 — replace with DB table 002+) ──────────────────

const applicationStore = new Map<string, WarrantApplication>();

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

  applicationStore.set(application.application_id, application);
  return application;
}

/** Record a granted warrant — triggers file unblocking */
export async function recordWarrantGrant(
  applicationId: string,
  warrantNumber: string,
  grantingJudge: string,
  approvedBy: string
): Promise<WarrantApplication | null> {
  const app = applicationStore.get(applicationId);
  if (!app) return null;

  const now = new Date().toISOString();
  app.status = "granted";
  app.warrant_number = warrantNumber;
  app.granting_judge = grantingJudge;
  app.approved_by = approvedBy;
  app.decided_at = now;
  app.updated_at = now;

  // Unblock all files covered by this warrant
  // Note: updateFileWarrant also writes to DB (if postgres) and audit log
  for (const fileId of app.file_ids) {
    await updateFileWarrant(app.tip_id, fileId, "granted", warrantNumber, grantingJudge);
  }

  applicationStore.set(applicationId, app);
  return app;
}

/** Record a denied warrant */
export async function recordWarrantDenial(
  applicationId: string,
  denialReason: string
): Promise<WarrantApplication | null> {
  const app = applicationStore.get(applicationId);
  if (!app) return null;

  const now = new Date().toISOString();
  app.status = "denied";
  app.denial_reason = denialReason;
  app.decided_at = now;
  app.updated_at = now;

  applicationStore.set(applicationId, app);
  return app;
}

/** Get all warrant applications for a tip */
export function getWarrantApplications(tipId: string): WarrantApplication[] {
  return Array.from(applicationStore.values()).filter((a: any) => a.tip_id === tipId);
}

/** For testing — clear the application store */
export function clearApplicationStore(): void {
  applicationStore.clear();
}
