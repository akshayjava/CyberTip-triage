/**
 * Magnet AXIOM / Magnet REVIEW — Case Manifest Export
 *
 * Magnet AXIOM is widely used for parsing and reviewing digital media with
 * integrated case management. Magnet REVIEW is its browser-based collaborative
 * review companion for multi-investigator cases.
 *
 * Export format: JSON case manifest compatible with Magnet's custom connector
 * framework (AXIOM Connect). The manifest contains all case metadata extracted
 * from the triage pipeline so investigators don't re-enter data.
 *
 * Import path in AXIOM: File > New Case > Import from External Source > JSON
 *
 * Wilson compliance: only files with file_access_blocked === false appear here.
 */

import type { ForensicsTipContext } from "../../models/forensics.js";

// ── AXIOM case manifest types ─────────────────────────────────────────────────

interface AxiomCaseMetadata {
  case_number: string;
  case_name: string;
  case_type: string;          // e.g. "Child Exploitation"
  assigned_to: string;        // routing_unit from triage
  created_date: string;
  ncmec_tip_number?: string;
  esp_name?: string;
  priority_score: number;
  priority_tier: string;
  offense_category: string;
  secondary_categories: string[];
  applicable_statutes: string[];
  triage_system: "CyberTip-Triage";
  triage_reference: string;   // internal tip_id
}

interface AxiomSubjectRecord {
  subject_id: string;
  name?: string;
  aliases?: string[];
  accounts: string[];
  dob?: string;
  country?: string;
}

interface AxiomVictimSummary {
  age_ranges: string[];
  count_estimate: number;
  ongoing_abuse: boolean;
}

interface AxiomFileEvidence {
  file_id: string;
  filename?: string;
  file_size_bytes?: number;
  media_type: string;
  hash_md5?: string;
  hash_sha1?: string;
  hash_sha256?: string;
  photodna_hash?: string;
  ncmec_hash_match: boolean;
  project_vic_match: boolean;
  iwf_match: boolean;
  interpol_icse_match: boolean;
  aig_csam_suspected: boolean;
  aig_detection_confidence?: number;
  warrant_status: string;
  warrant_number?: string;
  acquisition_notes: string;
}

interface AxiomNetworkIndicators {
  ip_addresses: string[];
  domains: string[];
  urls: string[];
  usernames: string[];
  dark_web_urls: string[];
  crypto_addresses: string[];
}

export interface AxiomCaseManifest {
  schema_version: "1.0";
  export_timestamp: string;
  exported_by: string;
  source_system: "CyberTip-Triage";
  case: AxiomCaseMetadata;
  subjects: AxiomSubjectRecord[];
  victims: AxiomVictimSummary;
  file_evidence: AxiomFileEvidence[];
  network_indicators: AxiomNetworkIndicators;
  legal: {
    warrant_required: boolean;
    files_requiring_warrant: number;
    preservation_deadline?: string;
  };
  triage_summary: {
    recommended_action: string;
    routing_unit: string;
    supervisor_review_required: boolean;
  };
  import_instructions: string;
}

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildAxiomManifest(
  ctx: ForensicsTipContext,
  exportedBy: string
): AxiomCaseManifest {
  const caseNumber = ctx.ids_case_number
    ?? ctx.ncmec_tip_number
    ?? ctx.tip_id.slice(0, 8).toUpperCase();

  const files: AxiomFileEvidence[] = ctx.files.map((f) => ({
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
    warrant_status: f.warrant_status,
    warrant_number: f.warrant_number,
    acquisition_notes: f.warrant_status === "not_needed"
      ? "File publicly available or ESP-viewed — no warrant required (Wilson compliant)."
      : `Warrant ${f.warrant_status}${f.warrant_number ? ` (#${f.warrant_number})` : ""}. Acquire evidence via legal process before importing into AXIOM.`,
  }));

  const supervisorRequired =
    ctx.priority_tier === "IMMEDIATE" || ctx.ongoing_abuse_indicated;

  const importInstructions = [
    "=== MAGNET AXIOM — IMPORT INSTRUCTIONS ===",
    "",
    `Case Reference : ${caseNumber}`,
    `Files Included : ${ctx.accessible_file_count} of ${ctx.total_file_count}`,
    "",
    "STEP 1 — Create New Case:",
    "  Magnet AXIOM > File > New Case",
    "  Use the case_number field from this manifest as the AXIOM Case Number.",
    "",
    "STEP 2 — Import Case Manifest:",
    "  AXIOM Connect or File > Import from External Source",
    "  Select this JSON file (axiom_manifest_<caseid>.json).",
    "  AXIOM will pre-populate case metadata, subjects, and network indicators.",
    "",
    "STEP 3 — Add Evidence Sources:",
    "  Add acquired media/images as AXIOM evidence sources.",
    "  AXIOM will cross-reference imported hashes against acquired files.",
    "",
    "STEP 4 — Magnet REVIEW (optional):",
    "  If multi-investigator review is needed, export to Magnet REVIEW.",
    "  Cases are searchable across all imported metadata.",
    "",
    "NOTE: Hashes in file_evidence[] are pre-checked against NCMEC/Project VIC.",
    "      Files with warrant_status='applied' require warrant grant before review.",
  ].join("\n");

  return {
    schema_version: "1.0",
    export_timestamp: new Date().toISOString(),
    exported_by: exportedBy,
    source_system: "CyberTip-Triage",
    case: {
      case_number: caseNumber,
      case_name: [
        ctx.offense_category.replace(/_/g, " "),
        ctx.esp_name ? `(${ctx.esp_name})` : "",
        ctx.ncmec_tip_number ? `— NCMEC #${ctx.ncmec_tip_number}` : "",
      ]
        .filter(Boolean)
        .join(" "),
      case_type: "Child Exploitation",
      assigned_to: ctx.routing_unit,
      created_date: new Date().toISOString(),
      ncmec_tip_number: ctx.ncmec_tip_number,
      esp_name: ctx.esp_name,
      priority_score: ctx.priority_score,
      priority_tier: ctx.priority_tier,
      offense_category: ctx.offense_category,
      secondary_categories: ctx.secondary_categories,
      applicable_statutes: ctx.applicable_statutes,
      triage_system: "CyberTip-Triage",
      triage_reference: ctx.tip_id,
    },
    subjects: ctx.subjects_summary.map((s) => ({
      subject_id: s.subject_id,
      name: s.name,
      aliases: s.aliases,
      accounts: s.accounts,
      dob: s.dob,
      country: s.country,
    })),
    victims: {
      age_ranges: ctx.victim_age_ranges,
      count_estimate: ctx.victim_count,
      ongoing_abuse: ctx.ongoing_abuse_indicated,
    },
    file_evidence: files,
    network_indicators: {
      ip_addresses: ctx.ip_addresses,
      domains: ctx.domains,
      urls: ctx.urls,
      usernames: ctx.usernames,
      dark_web_urls: ctx.dark_web_urls,
      crypto_addresses: ctx.crypto_addresses,
    },
    legal: {
      warrant_required: ctx.warrant_required,
      files_requiring_warrant: ctx.total_file_count - ctx.accessible_file_count,
      preservation_deadline: ctx.preservation_deadline,
    },
    triage_summary: {
      recommended_action: ctx.recommended_action,
      routing_unit: ctx.routing_unit,
      supervisor_review_required: supervisorRequired,
    },
    import_instructions: importInstructions,
  };
}

export function buildAxiomExport(
  ctx: ForensicsTipContext,
  exportedBy: string
): { json: string; manifest: AxiomCaseManifest } {
  const manifest = buildAxiomManifest(ctx, exportedBy);
  return { json: JSON.stringify(manifest, null, 2), manifest };
}
