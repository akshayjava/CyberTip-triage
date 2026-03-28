/**
 * Forensics Handoff Coordinator
 *
 * This is the main entry point for generating a forensics tool handoff package
 * from a fully-triaged CyberTip. It:
 *
 *  1. Maps a CyberTip → ForensicsTipContext (Wilson-filtered file list)
 *  2. Routes to the correct platform exporter (Griffeye / AXIOM / FTK /
 *     Cellebrite / EnCase / Generic)
 *  3. Returns a ForensicsHandoff record (for DB persistence) plus the raw
 *     export payload ready for download
 *
 * Wilson compliance is enforced here: files where file_access_blocked === true
 * are NEVER included in any handoff package, regardless of the requested
 * platform. The blocked count is recorded in the handoff for audit purposes.
 *
 * Usage (from an API route):
 *   const result = await generateForensicsHandoff(tip, "GRIFFEYE", officerId);
 *   await saveForensicsHandoff(result.handoff);
 *   res.json(result);
 */

import { randomUUID } from "crypto";
import type { CyberTip } from "../../models/tip.js";
import type {
  ForensicsPlatform,
  ForensicsHandoff,
  ForensicsTipContext,
  ForensicsFileRecord,
} from "../../models/forensics.js";

import { buildGriffeyeExport } from "./griffeye_export.js";
import { buildAxiomExport } from "./axiom_export.js";
import { buildFtkExport } from "./ftk_export.js";
import { buildCellebriteExport } from "./cellebrite_export.js";
import { buildEncaseExport } from "./encase_export.js";

// ── Wilson-safe ForensicsTipContext builder ───────────────────────────────────

/**
 * Maps a triaged CyberTip to a ForensicsTipContext.
 *
 * Only files where file_access_blocked === false are included in the files
 * array. Blocked files are counted but never exposed to the forensics tool.
 */
export function buildForensicsTipContext(
  tip: CyberTip,
  generatedBy: string
): ForensicsTipContext {
  // ── Filter files: Wilson-blocked files must not appear ─────────────────────
  const allFiles = tip.files ?? [];
  const accessibleFiles = allFiles.filter((f) => !f.file_access_blocked);

  const fileRecords: ForensicsFileRecord[] = accessibleFiles.map((f) => ({
    file_id: f.file_id,
    filename: f.filename,
    file_size_bytes: f.file_size_bytes,
    media_type: f.media_type,
    hash_md5: f.hash_md5,
    hash_sha1: f.hash_sha1,
    hash_sha256: f.hash_sha256,
    photodna_hash: f.photodna_hash,
    ncmec_hash_match: f.ncmec_hash_match,
    project_vic_match: f.project_vic_match,
    iwf_match: f.iwf_match,
    interpol_icse_match: f.interpol_icse_match,
    aig_csam_suspected: f.aig_csam_suspected,
    aig_detection_confidence: f.aig_detection_confidence,
    warrant_status: f.warrant_status === "denied" ? "not_needed" : f.warrant_status,
    warrant_number: f.warrant_number,
  }));

  // ── Extract subject summaries ──────────────────────────────────────────────
  const subjects = tip.extracted?.subjects ?? [];
  const subjectsSummary = subjects.map((s) => ({
    subject_id: s.subject_id,
    name: s.name,
    aliases: s.aliases,
    accounts: s.accounts,
    country: s.country,
    dob: s.dob,
  }));

  // ── Extract victim info ────────────────────────────────────────────────────
  const victims = tip.extracted?.victims ?? [];
  const victimAgeRanges = [...new Set(victims.map((v) => v.age_range))];
  const ongoingAbuse = victims.some((v) => v.ongoing_abuse_indicated);

  // ── ESP name from reporter ─────────────────────────────────────────────────
  const espName = (tip.reporter as { esp_name?: string } | undefined)?.esp_name;

  // ── Classification outputs ─────────────────────────────────────────────────
  const cls = tip.classification;
  const pri = tip.priority;

  return {
    tip_id: tip.tip_id,
    ncmec_tip_number: tip.ncmec_tip_number,
    ids_case_number: tip.ids_case_number,
    source: tip.source,
    received_at: tip.received_at,
    esp_name: espName,

    offense_category: cls?.offense_category ?? "UNKNOWN",
    secondary_categories: cls?.secondary_categories ?? [],
    severity_us_icac: cls?.severity?.us_icac ?? "P4_LOW",
    severity_iwf: cls?.severity?.iwf_category,
    priority_score: pri?.score ?? 0,
    priority_tier: pri?.tier ?? "MONITOR",
    routing_unit: pri?.routing_unit ?? "ICAC Task Force",
    recommended_action: pri?.recommended_action ?? "Standard triage",

    subject_count: subjects.length,
    subjects_summary: subjectsSummary,
    victim_count: victims.reduce((acc, v) => acc + (v.count ?? 1), 0),
    victim_age_ranges: victimAgeRanges,
    ongoing_abuse_indicated: ongoingAbuse,

    ip_addresses: (tip.extracted?.ip_addresses ?? []).map((e) => e.value),
    urls: (tip.extracted?.urls ?? []).map((e) => e.value),
    domains: (tip.extracted?.domains ?? []).map((e) => e.value),
    usernames: (tip.extracted?.usernames ?? []).map((e) => e.value),
    dark_web_urls: (tip.extracted?.dark_web_urls ?? []).map((e) => e.value),
    crypto_addresses: (tip.extracted?.crypto_addresses ?? []).map((e) => e.value),

    applicable_statutes: cls?.applicable_statutes ?? [],
    warrant_required: !!(tip.legal_status?.files_requiring_warrant?.length),
    preservation_deadline: cls?.esp_data_retention_deadline,

    files: fileRecords,
    total_file_count: allFiles.length,
    accessible_file_count: accessibleFiles.length,
  };
}

// ── Export result type ────────────────────────────────────────────────────────

export interface ForensicsHandoffResult {
  handoff: ForensicsHandoff;
  context: ForensicsTipContext;
  exports: ForensicsExportPayload;
}

export interface ForensicsExportPayload {
  platform: ForensicsPlatform;
  // Each key is a named file to write/download; value is the file content
  files: Record<string, string>;
  // Human-readable import instructions
  instructions: string;
  // Summary metadata
  summary: {
    files_included: number;
    files_blocked_wilson: number;
    hash_count: number;
  };
}

// ── Generic JSON export ───────────────────────────────────────────────────────

function buildGenericExport(ctx: ForensicsTipContext): {
  files: Record<string, string>;
  instructions: string;
  hashCount: number;
} {
  const caseRef =
    ctx.ncmec_tip_number
      ? `NCMEC-${ctx.ncmec_tip_number}`
      : ctx.tip_id.slice(0, 8).toUpperCase();

  const payload = {
    schema_version: "1.0",
    export_timestamp: new Date().toISOString(),
    source_system: "CyberTip-Triage",
    case_reference: caseRef,
    context: ctx,
  };

  const instructions = [
    "=== GENERIC JSON FORENSICS EXPORT ===",
    "",
    `Case Reference: ${caseRef}`,
    `Files Included: ${ctx.accessible_file_count} of ${ctx.total_file_count}`,
    "",
    "Import this JSON bundle into any forensics tool that accepts structured",
    "case metadata. The 'context.files' array contains Wilson-cleared files only.",
    "",
    "HASH LOOKUP: Use context.files[*].hash_sha256 / hash_md5 / photodna_hash",
    "to flag matching media during acquisition processing.",
  ].join("\n");

  const hashCount = ctx.files.filter(
    (f) => f.hash_md5 || f.hash_sha1 || f.hash_sha256
  ).length;

  return {
    files: {
      [`cybertip_${caseRef.toLowerCase()}.json`]: JSON.stringify(payload, null, 2),
    },
    instructions,
    hashCount,
  };
}

// ── Main handoff generator ────────────────────────────────────────────────────

export async function generateForensicsHandoff(
  tip: CyberTip,
  platform: ForensicsPlatform,
  generatedBy: string
): Promise<ForensicsHandoffResult> {
  const context = buildForensicsTipContext(tip, generatedBy);
  const blockedCount = tip.files.length - context.accessible_file_count;

  let exportFiles: Record<string, string>;
  let instructions: string;
  let exportFormat: string;
  let hashCount = 0;

  const caseRef =
    context.ncmec_tip_number
      ? `NCMEC-${context.ncmec_tip_number}`
      : context.tip_id.slice(0, 8).toUpperCase();

  switch (platform) {
    case "GRIFFEYE": {
      const bundle = buildGriffeyeExport(context, generatedBy);
      exportFiles = {
        [`vic_hashset_${caseRef.toLowerCase()}.json`]: bundle.projectVicJson,
        [`griffeye_case_${caseRef.toLowerCase()}.csv`]: bundle.caseCsv,
      };
      instructions = bundle.importInstructions;
      exportFormat = "project_vic_json+griffeye_csv";
      hashCount = bundle.hashCount;
      break;
    }

    case "AXIOM": {
      const bundle = buildAxiomExport(context, generatedBy);
      exportFiles = {
        [`axiom_case_${caseRef.toLowerCase()}.json`]: bundle.json,
      };
      instructions = [
        "=== MAGNET AXIOM — IMPORT INSTRUCTIONS ===",
        "",
        `Case Reference : ${caseRef}`,
        `Files Included : ${context.accessible_file_count} of ${context.total_file_count}`,
        "",
        "STEP 1 — Create new case in AXIOM:",
        "  File > New Case > Import from External Source > JSON",
        `  Select: axiom_case_${caseRef.toLowerCase()}.json`,
        "",
        "STEP 2 — Add evidence sources to the imported case.",
        "",
        "NOTE: Hash-matched files are pre-flagged in the manifest.",
        "      Files excluded require an active warrant (Wilson compliance).",
      ].join("\n");
      exportFormat = "axiom_json";
      hashCount = context.files.filter((f) => f.hash_md5 || f.hash_sha1 || f.hash_sha256).length;
      break;
    }

    case "FTK": {
      const bundle = buildFtkExport(context, generatedBy);
      exportFiles = {
        [`ftk_case_${caseRef.toLowerCase()}.xml`]: bundle.caseXml,
        [`ftk_kff_${caseRef.toLowerCase()}.csv`]: bundle.kffCsv,
      };
      instructions = bundle.importInstructions;
      exportFormat = "ftk_xml+kff_csv";
      hashCount = context.files.filter((f) => f.hash_md5 || f.hash_sha1 || f.hash_sha256).length;
      break;
    }

    case "CELLEBRITE": {
      const bundle = buildCellebriteExport(context, generatedBy);
      exportFiles = {
        [`cellebrite_manifest_${caseRef.toLowerCase()}.json`]: bundle.manifestJson,
        [`cellebrite_hashes_${caseRef.toLowerCase()}.csv`]: bundle.hashCsv,
      };
      instructions = bundle.importInstructions;
      exportFormat = "ufdr_json+hash_csv";
      hashCount = context.files.filter((f) => f.hash_md5 || f.hash_sha1 || f.hash_sha256).length;
      break;
    }

    case "ENCASE": {
      const bundle = buildEncaseExport(context, generatedBy);
      exportFiles = {
        [`encase_case_${caseRef.toLowerCase()}.xml`]: bundle.caseXml,
        [`encase_bookmarks_${caseRef.toLowerCase()}.csv`]: bundle.bookmarkCsv,
        [`encase_script_${caseRef.toLowerCase()}.json`]: bundle.enscriptJson,
      };
      instructions = bundle.importInstructions;
      exportFormat = "encase_xml+bookmark_csv+enscript_json";
      hashCount = context.files.filter((f) => f.hash_md5 || f.hash_sha1 || f.hash_sha256).length;
      break;
    }

    case "GENERIC":
    default: {
      const bundle = buildGenericExport(context);
      exportFiles = bundle.files;
      instructions = bundle.instructions;
      exportFormat = "generic_json";
      hashCount = bundle.hashCount;
      break;
    }
  }

  // ── Calculate total export size ────────────────────────────────────────────
  const exportSizeBytes = Object.values(exportFiles).reduce(
    (sum, content) => sum + Buffer.byteLength(content, "utf8"),
    0
  );

  // ── Build the handoff record ───────────────────────────────────────────────
  const handoff: ForensicsHandoff = {
    handoff_id: randomUUID(),
    tip_id: tip.tip_id,
    platform,
    generated_at: new Date().toISOString(),
    generated_by: generatedBy,
    status: "pending",
    files_included: context.accessible_file_count,
    files_blocked_wilson: blockedCount,
    export_format: exportFormat,
    export_size_bytes: exportSizeBytes,
  };

  const exports: ForensicsExportPayload = {
    platform,
    files: exportFiles,
    instructions,
    summary: {
      files_included: context.accessible_file_count,
      files_blocked_wilson: blockedCount,
      hash_count: hashCount,
    },
  };

  return { handoff, context, exports };
}
