/**
 * Griffeye Analyze DI Export — Project VIC JSON + Case CSV
 *
 * Griffeye Analyze DI is the dominant tool in ICAC triage workflows.
 * It integrates natively with Project VIC hashes, auto-categorizes media
 * by IWF severity (A/B/C), supports bulk review without manually opening
 * each file, and is used by the majority of ICAC task forces nationally.
 *
 * Two export formats are produced:
 *
 * 1. Project VIC JSON (vic_hashset_<tipId>.json)
 *    — Imported into Griffeye via File > Import > Project VIC Hash Set
 *    — Griffeye automatically categorizes media matching these hashes
 *    — Spec: Project VIC Data Model v2.1 (https://projectvic.org)
 *
 * 2. Griffeye Case CSV (griffeye_case_<tipId>.csv)
 *    — Imported via Griffeye > Cases > Import from CSV
 *    — Pre-populates case metadata so the analyst doesn't re-enter tip data
 *
 * Wilson compliance: only files with file_access_blocked === false are
 * included. The coordinator (forensics_handoff.ts) enforces this before
 * calling this module.
 */

import type { ForensicsTipContext, ProjectVicExport, ProjectVicHashSet, GriffeyCaseRow } from "../../models/forensics.js";

// ── IWF severity → Project VIC category number ───────────────────────────────
// Griffeye uses IWF A/B/C internally; Project VIC maps these to 1/2/3.
// If no IWF category is available, fall back based on ICAC severity.

function iwfToProjectVicCategory(
  iwfCategory: string | undefined,
  icacSeverity: string
): 1 | 2 | 3 {
  if (iwfCategory === "A") return 1;
  if (iwfCategory === "B") return 2;
  if (iwfCategory === "C") return 3;
  // Fallback: map ICAC P1/P2 → A(1), P3 → B(2), P4 → C(3)
  if (icacSeverity === "P1_CRITICAL" || icacSeverity === "P2_HIGH") return 1;
  if (icacSeverity === "P3_MEDIUM") return 2;
  return 3;
}

function mediaTypeForProjectVic(mediaType: string): "Image" | "Video" | "Other" {
  if (mediaType === "image") return "Image";
  if (mediaType === "video") return "Video";
  return "Other";
}

// ── Project VIC JSON export ───────────────────────────────────────────────────

export function buildProjectVicExport(
  ctx: ForensicsTipContext,
  exportedBy: string
): ProjectVicExport {
  const category = iwfToProjectVicCategory(ctx.severity_iwf, ctx.severity_us_icac);

  // Group files by media type — each group becomes a separate HashSet in
  // Griffeye (allows per-type categorization)
  const imageFiles = ctx.files.filter((f) => f.media_type === "image");
  const videoFiles = ctx.files.filter((f) => f.media_type === "video");
  const otherFiles = ctx.files.filter((f) => f.media_type !== "image" && f.media_type !== "video");

  const hashSets: ProjectVicHashSet[] = [];

  for (const [files, mediaType] of [
    [imageFiles, "Image"],
    [videoFiles, "Video"],
    [otherFiles, "Other"],
  ] as const) {
    if (files.length === 0) continue;

    const hashes = files
      .filter((f) => f.hash_md5 || f.hash_sha1 || f.photodna_hash)
      .map((f) => ({
        ...(f.hash_md5 ? { MD5: f.hash_md5 } : {}),
        ...(f.hash_sha1 ? { SHA1: f.hash_sha1 } : {}),
        ...(f.photodna_hash ? { PhotoDNA: f.photodna_hash } : {}),
        ...(f.file_size_bytes ? { Filesize: f.file_size_bytes } : {}),
      }));

    if (hashes.length === 0) continue;

    hashSets.push({
      HashSetID: `${ctx.tip_id}-${mediaType.toLowerCase()}`,
      HashSetName: [
        ctx.ncmec_tip_number ? `NCMEC ${ctx.ncmec_tip_number}` : `CyberTip ${ctx.tip_id.slice(0, 8)}`,
        ctx.esp_name ?? "",
        mediaType,
        new Date(ctx.received_at).toLocaleDateString("en-US"),
      ]
        .filter(Boolean)
        .join(" — "),
      Category: category,
      MediaType: mediaType,
      IsActive: true,
      CreatedDate: new Date().toISOString(),
      Hashes: hashes,
    });
  }

  return {
    VictimListVersion: "2.1",
    ExportDate: new Date().toISOString(),
    ExportedBy: exportedBy,
    HashSets: hashSets,
  };
}

// ── Griffeye Case CSV ─────────────────────────────────────────────────────────

export function buildGriffeyCaseCsv(ctx: ForensicsTipContext): string {
  const anyHashMatch = ctx.files.some(
    (f) => f.ncmec_hash_match || f.project_vic_match || f.iwf_match
  );
  const anyAig = ctx.files.some((f) => f.aig_csam_suspected);

  const row: GriffeyCaseRow = {
    CaseNumber: ctx.ids_case_number
      ?? ctx.ncmec_tip_number
      ?? ctx.tip_id.slice(0, 8).toUpperCase(),
    CaseDescription: [
      ctx.offense_category.replace(/_/g, " "),
      ctx.esp_name ? `via ${ctx.esp_name}` : "",
      ctx.ncmec_tip_number ? `NCMEC #${ctx.ncmec_tip_number}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
    OffenseCategory: ctx.offense_category,
    IWFCategory: ctx.severity_iwf ?? "UNCLASSIFIED",
    NCMECTipNumber: ctx.ncmec_tip_number ?? "",
    ESPName: ctx.esp_name ?? "",
    ReceivedDate: new Date(ctx.received_at).toLocaleDateString("en-US"),
    PriorityScore: String(Math.round(ctx.priority_score)),
    PriorityTier: ctx.priority_tier,
    SubjectCount: String(ctx.subject_count),
    VictimAgeRanges: ctx.victim_age_ranges.join("; "),
    OngoingAbuse: ctx.ongoing_abuse_indicated ? "YES" : "NO",
    ApplicableStatutes: ctx.applicable_statutes.join("; "),
    HashMatchNCMEC: anyHashMatch ? "YES" : "NO",
    HashMatchProjectVIC: ctx.files.some((f) => f.project_vic_match) ? "YES" : "NO",
    HashMatchIWF: ctx.files.some((f) => f.iwf_match) ? "YES" : "NO",
    AIGCSAMSuspected: anyAig ? "YES" : "NO",
    WarrantRequired: ctx.warrant_required ? "YES" : "NO",
    RoutingUnit: ctx.routing_unit,
    RecommendedAction: ctx.recommended_action,
  };

  const headers = Object.keys(row) as (keyof GriffeyCaseRow)[];
  const csvLine = (v: string) => `"${v.replace(/"/g, '""')}"`;

  return [
    headers.join(","),
    headers.map((h) => csvLine(row[h])).join(","),
  ].join("\n");
}

// ── Bundle both outputs ───────────────────────────────────────────────────────

export interface GriffeyeExportBundle {
  projectVicJson: string;     // serialize and save as .json
  caseCsv: string;            // save as .csv
  hashSetCount: number;
  hashCount: number;
  importInstructions: string;
}

export function buildGriffeyeExport(
  ctx: ForensicsTipContext,
  exportedBy: string
): GriffeyeExportBundle {
  const projectVic = buildProjectVicExport(ctx, exportedBy);
  const caseCsv = buildGriffeyCaseCsv(ctx);

  const hashCount = projectVic.HashSets.reduce(
    (sum, hs) => sum + hs.Hashes.length,
    0
  );

  const caseRef = ctx.ncmec_tip_number
    ? `NCMEC #${ctx.ncmec_tip_number}`
    : ctx.tip_id.slice(0, 8).toUpperCase();

  const importInstructions = [
    "=== GRIFFEYE ANALYZE DI — IMPORT INSTRUCTIONS ===",
    "",
    `Case Reference : ${caseRef}`,
    `Files Included : ${ctx.accessible_file_count} of ${ctx.total_file_count} (${ctx.total_file_count - ctx.accessible_file_count} blocked by Wilson/warrant)`,
    `Hash Sets      : ${projectVic.HashSets.length}`,
    `Hashes         : ${hashCount}`,
    "",
    "STEP 1 — Import Project VIC Hash Set:",
    "  Griffeye Analyze DI > File > Import > Project VIC Hash Set",
    "  Select: vic_hashset_<caseid>.json",
    "  Griffeye will auto-categorize any matching media by IWF severity (A/B/C).",
    "",
    "STEP 2 — Import Case Metadata:",
    "  Griffeye Analyze DI > Cases > Import from CSV",
    "  Select: griffeye_case_<caseid>.csv",
    "  This pre-populates case number, offense category, subject/victim counts.",
    "",
    "STEP 3 — Add Evidence:",
    "  Add the evidence folder/image as a new source in the imported case.",
    "  Griffeye will scan and match against the imported Project VIC hashes.",
    "",
    "STEP 4 — Review & Categorize:",
    "  Use Griffeye's bulk review mode. Files matching imported hashes are",
    "  pre-categorized. Analyst only needs to manually review unmatched media.",
    "",
    "NOTE: Files excluded from this bundle require an active warrant.",
    "      Do not import the actual media files — only the hash manifest.",
    "      The investigator must acquire evidence through authorized channels.",
  ].join("\n");

  return {
    projectVicJson: JSON.stringify(projectVic, null, 2),
    caseCsv,
    hashSetCount: projectVic.HashSets.length,
    hashCount,
    importInstructions,
  };
}
