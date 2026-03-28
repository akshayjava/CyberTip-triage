/**
 * Cellebrite UFED / Cellebrite Inspector — Case Handoff Package
 *
 * Cellebrite UFED is primarily used for mobile device acquisition and
 * extraction. Cellebrite Inspector provides analysis and reporting on
 * extracted data. The UFDR (Universal Forensics Data Request) format is
 * Cellebrite's standard exchange format between tools.
 *
 * This exporter produces:
 *  1. A UFDR-style case manifest (JSON, since full UFDR is a ZIP container)
 *  2. A hash reference CSV for cross-referencing against extracted data
 *  3. Import instructions for Cellebrite Inspector
 *
 * The primary handoff point to Cellebrite is when:
 *  - A subject's device is to be seized and extracted (warrant in hand)
 *  - CyberTip identifies a mobile-associated account (phone number, IMEI, etc.)
 *  - EXIF metadata in tip files reveals device identifiers for mobile forensics
 *
 * Wilson compliance: only files with file_access_blocked === false appear here.
 */

import type { ForensicsTipContext } from "../../models/forensics.js";

export interface CellebriteUfdrManifest {
  ufdr_schema_version: "1.0";
  export_timestamp: string;
  exported_by: string;
  source_system: "CyberTip-Triage";
  case_info: {
    case_id: string;
    case_name: string;
    case_type: string;
    investigator: string;
    agency: string;
    ncmec_tip_number?: string;
    ids_case_number?: string;
    received_date: string;
    priority_tier: string;
    priority_score: number;
    offense_category: string;
    routing_unit: string;
  };
  subjects: Array<{
    subject_id: string;
    name?: string;
    phone_numbers: string[];
    device_identifiers: string[];  // IMEI, serial numbers from EXIF, etc.
    accounts: string[];
    country?: string;
  }>;
  file_hashes: Array<{
    file_id: string;
    media_type: string;
    hash_md5?: string;
    hash_sha1?: string;
    hash_sha256?: string;
    known_csam: boolean;
    aig_suspected: boolean;
    warrant_status: string;
    // EXIF/metadata placeholders — populated when actual file is examined
    exif_device_make?: string;
    exif_device_model?: string;
    exif_gps_lat?: string;
    exif_gps_lon?: string;
    exif_datetime_original?: string;
    exif_notes: string;
  }>;
  network_indicators: {
    ip_addresses: string[];
    usernames: string[];
    phone_numbers: string[];   // extracted from tip text
    device_identifiers: string[];
  };
  extraction_guidance: {
    recommended_extraction_type: string;
    legal_basis: string;
    warrant_required: boolean;
    preservation_deadline?: string;
    applicable_statutes: string[];
    notes: string;
  };
}

export function buildCellebriteManifest(
  ctx: ForensicsTipContext,
  exportedBy: string,
  agencyName = "ICAC Task Force"
): CellebriteUfdrManifest {
  const caseId = ctx.ids_case_number
    ?? ctx.ncmec_tip_number
    ?? ctx.tip_id.slice(0, 8).toUpperCase();

  // Phone numbers and device IDs extracted by the triage pipeline
  // These come from ExtractedEntities.device_identifiers and phone_numbers.
  // At this integration point they are already in ctx.usernames / network context.
  const phoneNumbers = ctx.usernames.filter(
    (u) => /^\+?[\d\-\(\)\s]{7,15}$/.test(u)
  );
  const deviceIds = ctx.usernames.filter(
    (u) => /^[A-F0-9]{14,16}$/i.test(u) // IMEI pattern
  );

  const subjects = ctx.subjects_summary.map((s) => ({
    subject_id: s.subject_id,
    name: s.name,
    phone_numbers: phoneNumbers, // associated until account-level mapping is available
    device_identifiers: deviceIds,
    accounts: s.accounts,
    country: s.country,
  }));

  const fileHashes = ctx.files.map((f) => ({
    file_id: f.file_id,
    media_type: f.media_type,
    hash_md5: f.hash_md5,
    hash_sha1: f.hash_sha1,
    hash_sha256: f.hash_sha256,
    known_csam: f.ncmec_hash_match || f.project_vic_match || f.iwf_match,
    aig_suspected: f.aig_csam_suspected,
    warrant_status: f.warrant_status,
    // EXIF metadata is populated when the actual file is examined.
    // CyberTip-Triage does not receive the raw file — only hashes and metadata
    // provided by the ESP. These fields are pre-allocated for Cellebrite to fill
    // after device extraction.
    exif_notes: [
      "EXIF fields are unpopulated at triage stage — CyberTip-Triage receives",
      "hash manifests from ESPs, not raw media. Cellebrite should populate these",
      "fields after acquiring and extracting device storage.",
      f.ncmec_hash_match
        ? "PRIORITY: This file hash is confirmed in NCMEC database."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  }));

  const warrantRequired = ctx.warrant_required;
  const legalBasis = warrantRequired
    ? `Search warrant required. Warrant status: ${ctx.files.some((f) => f.warrant_status === "granted") ? "GRANTED" : "APPLIED/PENDING"}.`
    : "No warrant required — files are ESP-viewed or publicly available (Wilson compliant).";

  return {
    ufdr_schema_version: "1.0",
    export_timestamp: new Date().toISOString(),
    exported_by: exportedBy,
    source_system: "CyberTip-Triage",
    case_info: {
      case_id: caseId,
      case_name: [
        ctx.offense_category.replace(/_/g, " "),
        ctx.ncmec_tip_number ? `— NCMEC #${ctx.ncmec_tip_number}` : "",
      ]
        .filter(Boolean)
        .join(" "),
      case_type: "Internet Crimes Against Children",
      investigator: exportedBy,
      agency: agencyName,
      ncmec_tip_number: ctx.ncmec_tip_number,
      ids_case_number: ctx.ids_case_number,
      received_date: ctx.received_at,
      priority_tier: ctx.priority_tier,
      priority_score: ctx.priority_score,
      offense_category: ctx.offense_category,
      routing_unit: ctx.routing_unit,
    },
    subjects,
    file_hashes: fileHashes,
    network_indicators: {
      ip_addresses: ctx.ip_addresses,
      usernames: ctx.usernames,
      phone_numbers: phoneNumbers,
      device_identifiers: deviceIds,
    },
    extraction_guidance: {
      recommended_extraction_type: ctx.offense_category === "CSAM" || ctx.offense_category === "CHILD_GROOMING"
        ? "Advanced Logical + File System (full filesystem preferred if legally authorized)"
        : "Advanced Logical",
      legal_basis: legalBasis,
      warrant_required: warrantRequired,
      preservation_deadline: ctx.preservation_deadline,
      applicable_statutes: ctx.applicable_statutes,
      notes: [
        ctx.ongoing_abuse_indicated
          ? "ONGOING ABUSE INDICATED — treat as exigent; expedite extraction timeline."
          : "",
        ctx.dark_web_urls.length > 0
          ? "Dark web indicators present — flag for HSI/FBI Cyber Division review."
          : "",
        ctx.crypto_addresses.length > 0
          ? "Cryptocurrency addresses identified — financial forensics may be needed."
          : "",
        `${ctx.accessible_file_count} files cleared for review. ` +
          `${ctx.total_file_count - ctx.accessible_file_count} files blocked pending warrant.`,
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}

// ── Hash reference CSV for cross-referencing against Cellebrite extraction ───

export function buildCellebriteHashCsv(ctx: ForensicsTipContext): string {
  const header = "FileID,MediaType,MD5,SHA1,SHA256,KnownCSAM,AIGSuspected,WarrantStatus";
  const rows = ctx.files.map((f) => {
    const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;
    return [
      csv(f.file_id),
      csv(f.media_type),
      csv(f.hash_md5 ?? ""),
      csv(f.hash_sha1 ?? ""),
      csv(f.hash_sha256 ?? ""),
      csv(String(f.ncmec_hash_match || f.project_vic_match || f.iwf_match)),
      csv(String(f.aig_csam_suspected)),
      csv(f.warrant_status),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

export function buildCellebriteExport(
  ctx: ForensicsTipContext,
  exportedBy: string,
  agencyName?: string
): { manifestJson: string; hashCsv: string; importInstructions: string } {
  const manifest = buildCellebriteManifest(ctx, exportedBy, agencyName);
  const caseId = manifest.case_info.case_id;

  const importInstructions = [
    "=== CELLEBRITE UFED / INSPECTOR — IMPORT INSTRUCTIONS ===",
    "",
    `Case Reference : ${caseId}`,
    `Files Included : ${ctx.accessible_file_count} of ${ctx.total_file_count}`,
    `Phone Numbers  : ${manifest.network_indicators.phone_numbers.length} identified`,
    `Device IDs     : ${manifest.network_indicators.device_identifiers.length} identified (IMEI-pattern)`,
    "",
    "STEP 1 — Device Acquisition (UFED):",
    "  Use identified phone numbers and device IDs to target acquisition.",
    "  Select extraction type per extraction_guidance.recommended_extraction_type.",
    "  Ensure warrant is in hand if extraction_guidance.warrant_required = true.",
    "",
    "STEP 2 — Import into Cellebrite Inspector:",
    "  Inspector > New Case > Import UFDR",
    "  Load the UFDR container generated by UFED extraction.",
    "  Then import this manifest JSON as a case annotation:",
    "  Inspector > Annotations > Import > JSON",
    "",
    "STEP 3 — Hash Cross-Reference:",
    "  Inspector > Analytics > Known Hashes > Import CSV",
    "  Select: cellebrite_hashes_<caseid>.csv",
    "  Inspector will flag files matching NCMEC/Project VIC hashes.",
    "",
    "STEP 4 — EXIF / Metadata Examination:",
    "  For each flagged file, use Inspector's media metadata panel.",
    "  Populate exif_device_make, exif_gps_lat/lon, exif_datetime_original",
    "  back into this manifest for chain-of-custody documentation.",
    "",
    "NOTE: This manifest does not contain actual media — only hash metadata.",
    "      Acquire the device through authorized legal channels.",
  ].join("\n");

  return {
    manifestJson: JSON.stringify(manifest, null, 2),
    hashCsv: buildCellebriteHashCsv(ctx),
    importInstructions,
  };
}
