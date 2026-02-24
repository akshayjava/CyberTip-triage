/**
 * AccessData FTK (Forensic Toolkit) / FTK Imager — Case Import XML
 *
 * FTK is used for forensic imaging, file examination, and structured case
 * management. FTK case import accepts XML-formatted case metadata that
 * pre-populates investigator fields and known-hash lists.
 *
 * Export format: FTK Case XML (compatible with FTK 7.x+ import schema)
 * Import path: FTK > File > Import Case Data > XML
 *
 * Separately, a Known File Filter (KFF) hash list is produced for import
 * into FTK's KFF library so that files matching NCMEC/Project VIC hashes
 * are automatically flagged during acquisition processing.
 *
 * Wilson compliance: only files with file_access_blocked === false appear here.
 */

import type { ForensicsTipContext } from "../../models/forensics.js";

// ── XML helpers ───────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tag(name: string, value: string | number | boolean, attrs?: Record<string, string>): string {
  const attrStr = attrs
    ? " " + Object.entries(attrs).map(([k, v]) => `${k}="${xmlEscape(String(v))}"`).join(" ")
    : "";
  return `<${name}${attrStr}>${xmlEscape(String(value))}</${name}>`;
}

// ── FTK Case XML builder ──────────────────────────────────────────────────────

export function buildFtkCaseXml(ctx: ForensicsTipContext, exportedBy: string): string {
  const caseNumber = ctx.ids_case_number
    ?? ctx.ncmec_tip_number
    ?? ctx.tip_id.slice(0, 8).toUpperCase();

  const caseName = [
    ctx.offense_category.replace(/_/g, " "),
    ctx.ncmec_tip_number ? `NCMEC #${ctx.ncmec_tip_number}` : "",
    ctx.esp_name ?? "",
  ]
    .filter(Boolean)
    .join(" | ");

  // Subject entries
  const subjectXml = ctx.subjects_summary
    .map(
      (s) => `      <Subject>
        ${tag("SubjectID", s.subject_id)}
        ${s.name ? tag("Name", s.name) : ""}
        ${s.dob ? tag("DateOfBirth", s.dob) : ""}
        ${s.country ? tag("Country", s.country) : ""}
        ${s.accounts.length > 0
          ? `<OnlineAccounts>${s.accounts.map((a) => tag("Account", a)).join("")}</OnlineAccounts>`
          : ""}
        ${s.aliases && s.aliases.length > 0
          ? `<Aliases>${s.aliases.map((a) => tag("Alias", a)).join("")}</Aliases>`
          : ""}
      </Subject>`
    )
    .join("\n");

  // File evidence entries — hashes only, not actual content
  const fileXml = ctx.files
    .map(
      (f) => `      <FileEvidence>
        ${tag("FileID", f.file_id)}
        ${f.filename ? tag("Filename", f.filename) : ""}
        ${tag("MediaType", f.media_type)}
        ${f.file_size_bytes ? tag("FileSizeBytes", f.file_size_bytes) : ""}
        ${f.hash_md5 ? tag("HashMD5", f.hash_md5) : ""}
        ${f.hash_sha1 ? tag("HashSHA1", f.hash_sha1) : ""}
        ${f.hash_sha256 ? tag("HashSHA256", f.hash_sha256) : ""}
        ${tag("NCMECHashMatch", f.ncmec_hash_match)}
        ${tag("ProjectVICMatch", f.project_vic_match)}
        ${tag("IWFMatch", f.iwf_match)}
        ${tag("AIGCSAMSuspected", f.aig_csam_suspected)}
        ${tag("WarrantStatus", f.warrant_status)}
        ${f.warrant_number ? tag("WarrantNumber", f.warrant_number) : ""}
      </FileEvidence>`
    )
    .join("\n");

  // Network indicators
  const networkXml = [
    ctx.ip_addresses.length > 0
      ? `<IPAddresses>${ctx.ip_addresses.map((ip) => tag("IP", ip)).join("")}</IPAddresses>`
      : "",
    ctx.domains.length > 0
      ? `<Domains>${ctx.domains.map((d) => tag("Domain", d)).join("")}</Domains>`
      : "",
    ctx.usernames.length > 0
      ? `<Usernames>${ctx.usernames.map((u) => tag("Username", u)).join("")}</Usernames>`
      : "",
    ctx.dark_web_urls.length > 0
      ? `<DarkWebURLs>${ctx.dark_web_urls.map((u) => tag("URL", u)).join("")}</DarkWebURLs>`
      : "",
    ctx.crypto_addresses.length > 0
      ? `<CryptoAddresses>${ctx.crypto_addresses.map((a) => tag("Address", a)).join("")}</CryptoAddresses>`
      : "",
  ]
    .filter(Boolean)
    .join("\n      ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  FTK Case Import XML
  Source: CyberTip-Triage v1.0
  Generated: ${new Date().toISOString()}
  Exported by: ${xmlEscape(exportedBy)}

  Import via: FTK > File > Import Case Data > XML
  NOTE: This file contains hash metadata only. Acquire actual evidence
        through authorized legal channels before adding to FTK case.
-->
<FTKCaseImport xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="7.0">

  <CaseMetadata>
    ${tag("CaseNumber", caseNumber)}
    ${tag("CaseName", caseName)}
    ${tag("CaseType", "Child Exploitation — Internet Crimes Against Children")}
    ${tag("AssignedTo", exportedBy)}
    ${tag("RoutingUnit", ctx.routing_unit)}
    ${tag("CreatedDate", new Date().toISOString())}
    ${tag("TriageReference", ctx.tip_id)}
    ${ctx.ncmec_tip_number ? tag("NCMECTipNumber", ctx.ncmec_tip_number) : ""}
    ${ctx.ids_case_number ? tag("IDSCaseNumber", ctx.ids_case_number) : ""}
    ${ctx.esp_name ? tag("ReportingESP", ctx.esp_name) : ""}
    ${tag("ReceivedDate", ctx.received_at)}
    ${tag("OffenseCategory", ctx.offense_category)}
    ${tag("PriorityScore", ctx.priority_score)}
    ${tag("PriorityTier", ctx.priority_tier)}
    ${tag("IWFCategory", ctx.severity_iwf ?? "UNCLASSIFIED")}
    ${tag("WarrantRequired", ctx.warrant_required)}
    ${ctx.preservation_deadline ? tag("PreservationDeadline", ctx.preservation_deadline) : ""}
    <ApplicableStatutes>
      ${ctx.applicable_statutes.map((s) => tag("Statute", s)).join("\n      ")}
    </ApplicableStatutes>
    ${tag("RecommendedAction", ctx.recommended_action)}
    ${tag("FilesIncluded", ctx.accessible_file_count)}
    ${tag("FilesBlockedWilson", ctx.total_file_count - ctx.accessible_file_count)}
  </CaseMetadata>

  <Subjects>
${subjectXml}
  </Subjects>

  <VictimSummary>
    ${tag("TotalVictims", ctx.victim_count)}
    ${tag("OngoingAbuse", ctx.ongoing_abuse_indicated)}
    <AgeRanges>
      ${ctx.victim_age_ranges.map((r) => tag("AgeRange", r)).join("\n      ")}
    </AgeRanges>
  </VictimSummary>

  <FileEvidenceList>
${fileXml}
  </FileEvidenceList>

  <NetworkIndicators>
      ${networkXml}
  </NetworkIndicators>

</FTKCaseImport>`;
}

// ── FTK KFF (Known File Filter) hash list ────────────────────────────────────
// FTK's KFF library identifies known files during processing.
// CSV format: MD5,SHA1,Category,Filename,Notes

export function buildFtkKffCsv(ctx: ForensicsTipContext): string {
  const header = "MD5,SHA1,Category,Filename,Notes";
  const caseRef = ctx.ncmec_tip_number
    ? `NCMEC ${ctx.ncmec_tip_number}`
    : ctx.tip_id.slice(0, 8).toUpperCase();

  const rows = ctx.files
    .filter((f) => f.hash_md5 || f.hash_sha1)
    .map((f) => {
      const md5 = f.hash_md5 ?? "";
      const sha1 = f.hash_sha1 ?? "";

      let category = "Notable";
      if (f.ncmec_hash_match || f.project_vic_match || f.iwf_match) {
        category = "Known Child Exploitation Material";
      } else if (f.aig_csam_suspected) {
        category = "Suspected AI-Generated CSAM";
      }

      const notes = [
        `Source: ${caseRef}`,
        f.ncmec_hash_match ? "NCMEC:match" : "",
        f.project_vic_match ? "ProjectVIC:match" : "",
        f.iwf_match ? "IWF:match" : "",
        f.aig_csam_suspected ? `AIG-CSAM:suspected(${((f.aig_detection_confidence ?? 0) * 100).toFixed(0)}%)` : "",
      ]
        .filter(Boolean)
        .join("|");

      const csvVal = (v: string) => `"${v.replace(/"/g, '""')}"`;
      return [csvVal(md5), csvVal(sha1), csvVal(category), csvVal(f.filename ?? ""), csvVal(notes)].join(",");
    });

  return [header, ...rows].join("\n");
}

export function buildFtkExport(
  ctx: ForensicsTipContext,
  exportedBy: string
): { caseXml: string; kffCsv: string; importInstructions: string } {
  const caseNumber = ctx.ids_case_number
    ?? ctx.ncmec_tip_number
    ?? ctx.tip_id.slice(0, 8).toUpperCase();

  const importInstructions = [
    "=== FTK / FTK IMAGER — IMPORT INSTRUCTIONS ===",
    "",
    `Case Reference : ${caseNumber}`,
    `Files Included : ${ctx.accessible_file_count} of ${ctx.total_file_count}`,
    "",
    "STEP 1 — Import KFF Hash List:",
    "  FTK > Manage > KFF > Import",
    "  Select: ftk_kff_<caseid>.csv",
    "  FTK will flag matching files automatically during evidence processing.",
    "",
    "STEP 2 — Create / Import Case:",
    "  FTK > File > New Case > Import from XML",
    "  Select: ftk_case_<caseid>.xml",
    "  FTK will pre-populate case number, subjects, and network indicators.",
    "",
    "STEP 3 — Add Evidence:",
    "  Add acquired disk images or logical evidence via FTK Imager.",
    "  KFF matches will surface automatically after processing.",
    "",
    "NOTE: The XML contains hash metadata only — not actual media content.",
    "      Files with WarrantStatus='applied' require a granted warrant",
    "      before accessing the underlying evidence.",
  ].join("\n");

  return {
    caseXml: buildFtkCaseXml(ctx, exportedBy),
    kffCsv: buildFtkKffCsv(ctx),
    importInstructions,
  };
}
