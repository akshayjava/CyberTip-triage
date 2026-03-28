/**
 * OpenText EnCase — Case Package Export
 *
 * EnCase is used at some agencies for structured case management combined
 * with file review. It supports EnScript (a C++-like scripting language)
 * and imports case metadata via XML and CSV.
 *
 * Export format:
 *  1. EnCase Case XML — case metadata for File > New Case > Import
 *  2. EnCase Bookmark CSV — pre-built bookmarks for hash-matched files
 *     so analysts can jump directly to flagged evidence
 *  3. EnScript-ready JSON — data formatted for use in custom EnScripts
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

// ── EnCase Case XML ───────────────────────────────────────────────────────────

export function buildEncaseCaseXml(ctx: ForensicsTipContext, exportedBy: string): string {
  const caseNumber = ctx.ids_case_number
    ?? ctx.ncmec_tip_number
    ?? ctx.tip_id.slice(0, 8).toUpperCase();

  const subjectXml = ctx.subjects_summary
    .map(
      (s) => `      <Subject>
        <ID>${xmlEscape(s.subject_id)}</ID>
        ${s.name ? `<Name>${xmlEscape(s.name)}</Name>` : ""}
        ${s.dob ? `<DateOfBirth>${xmlEscape(s.dob)}</DateOfBirth>` : ""}
        ${s.country ? `<Country>${xmlEscape(s.country)}</Country>` : ""}
        <OnlineAccounts>${s.accounts.map((a) => `<Account>${xmlEscape(a)}</Account>`).join("")}</OnlineAccounts>
      </Subject>`
    )
    .join("\n");

  const fileXml = ctx.files
    .map(
      (f) => `      <KnownFile>
        <FileID>${xmlEscape(f.file_id)}</FileID>
        ${f.filename ? `<Filename>${xmlEscape(f.filename)}</Filename>` : ""}
        <MediaType>${xmlEscape(f.media_type)}</MediaType>
        ${f.hash_md5 ? `<HashMD5>${xmlEscape(f.hash_md5)}</HashMD5>` : ""}
        ${f.hash_sha1 ? `<HashSHA1>${xmlEscape(f.hash_sha1)}</HashSHA1>` : ""}
        ${f.hash_sha256 ? `<HashSHA256>${xmlEscape(f.hash_sha256)}</HashSHA256>` : ""}
        <NCMECMatch>${f.ncmec_hash_match}</NCMECMatch>
        <ProjectVICMatch>${f.project_vic_match}</ProjectVICMatch>
        <IWFMatch>${f.iwf_match}</IWFMatch>
        <AIGSuspected>${f.aig_csam_suspected}</AIGSuspected>
        <WarrantStatus>${xmlEscape(f.warrant_status)}</WarrantStatus>
        ${f.warrant_number ? `<WarrantNumber>${xmlEscape(f.warrant_number)}</WarrantNumber>` : ""}
      </KnownFile>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  EnCase Case Import XML
  Source: CyberTip-Triage v1.0
  Generated: ${new Date().toISOString()}
  Exported by: ${xmlEscape(exportedBy)}

  Import via: EnCase > File > New Case > Import Case XML
-->
<EnCaseCaseImport version="8.0">

  <CaseInfo>
    <CaseNumber>${xmlEscape(caseNumber)}</CaseNumber>
    <CaseName>${xmlEscape([
      ctx.offense_category.replace(/_/g, " "),
      ctx.ncmec_tip_number ? `NCMEC #${ctx.ncmec_tip_number}` : "",
      ctx.esp_name ?? "",
    ].filter(Boolean).join(" | "))}</CaseName>
    <CaseType>Internet Crimes Against Children</CaseType>
    <ExaminerName>${xmlEscape(exportedBy)}</ExaminerName>
    <RoutingUnit>${xmlEscape(ctx.routing_unit)}</RoutingUnit>
    <CreatedDate>${new Date().toISOString()}</CreatedDate>
    <TriageReference>${xmlEscape(ctx.tip_id)}</TriageReference>
    ${ctx.ncmec_tip_number ? `<NCMECTipNumber>${xmlEscape(ctx.ncmec_tip_number)}</NCMECTipNumber>` : ""}
    ${ctx.esp_name ? `<ReportingESP>${xmlEscape(ctx.esp_name)}</ReportingESP>` : ""}
    <OffenseCategory>${xmlEscape(ctx.offense_category)}</OffenseCategory>
    <IWFCategory>${xmlEscape(ctx.severity_iwf ?? "UNCLASSIFIED")}</IWFCategory>
    <PriorityScore>${ctx.priority_score}</PriorityScore>
    <PriorityTier>${xmlEscape(ctx.priority_tier)}</PriorityTier>
    <WarrantRequired>${ctx.warrant_required}</WarrantRequired>
    ${ctx.preservation_deadline ? `<PreservationDeadline>${xmlEscape(ctx.preservation_deadline)}</PreservationDeadline>` : ""}
    <ApplicableStatutes>${ctx.applicable_statutes.map((s) => `<Statute>${xmlEscape(s)}</Statute>`).join("")}</ApplicableStatutes>
    <RecommendedAction>${xmlEscape(ctx.recommended_action)}</RecommendedAction>
  </CaseInfo>

  <Subjects>
${subjectXml}
  </Subjects>

  <VictimSummary>
    <TotalVictims>${ctx.victim_count}</TotalVictims>
    <OngoingAbuse>${ctx.ongoing_abuse_indicated}</OngoingAbuse>
    <AgeRanges>${ctx.victim_age_ranges.map((r) => `<AgeRange>${xmlEscape(r)}</AgeRange>`).join("")}</AgeRanges>
  </VictimSummary>

  <KnownFiles>
${fileXml}
  </KnownFiles>

  <NetworkIndicators>
    <IPAddresses>${ctx.ip_addresses.map((ip) => `<IP>${xmlEscape(ip)}</IP>`).join("")}</IPAddresses>
    <Domains>${ctx.domains.map((d) => `<Domain>${xmlEscape(d)}</Domain>`).join("")}</Domains>
    <Usernames>${ctx.usernames.map((u) => `<Username>${xmlEscape(u)}</Username>`).join("")}</Usernames>
    <DarkWebURLs>${ctx.dark_web_urls.map((u) => `<URL>${xmlEscape(u)}</URL>`).join("")}</DarkWebURLs>
    <CryptoAddresses>${ctx.crypto_addresses.map((a) => `<Address>${xmlEscape(a)}</Address>`).join("")}</CryptoAddresses>
  </NetworkIndicators>

</EnCaseCaseImport>`;
}

// ── EnCase Bookmark CSV ───────────────────────────────────────────────────────
// EnCase bookmarks let analysts jump to flagged items without scanning everything.
// CSV format: BookmarkName, Hash, Category, Notes

export function buildEncaseBookmarkCsv(ctx: ForensicsTipContext): string {
  const header = "BookmarkName,HashMD5,HashSHA1,Category,Priority,Notes";
  const caseRef = ctx.ncmec_tip_number
    ? `NCMEC ${ctx.ncmec_tip_number}`
    : ctx.tip_id.slice(0, 8).toUpperCase();

  const rows = ctx.files
    .filter((f) => f.hash_md5 || f.hash_sha1)
    .map((f, i) => {
      let category = "Evidence — Review Required";
      let priority = "Normal";

      if (f.ncmec_hash_match || f.project_vic_match) {
        category = "Known CSAM — NCMEC/ProjectVIC Match";
        priority = "High";
      } else if (f.iwf_match) {
        category = "Known CSAM — IWF Match";
        priority = "High";
      } else if (f.interpol_icse_match) {
        category = "Known CSAM — Interpol ICSE Match";
        priority = "High";
      } else if (f.aig_csam_suspected) {
        category = `Suspected AI-Generated CSAM (${((f.aig_detection_confidence ?? 0) * 100).toFixed(0)}% confidence)`;
        priority = "High";
      }

      const notes = [
        `Source: ${caseRef}`,
        `File ${i + 1} of ${ctx.files.length}`,
        f.filename ? `Filename: ${f.filename}` : "",
        f.warrant_status !== "not_needed" ? `Warrant: ${f.warrant_status}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const bookmarkName = [
        category.split("—")[0]?.trim() ?? category,
        f.filename ?? `File-${f.file_id.slice(0, 8)}`,
      ].join(": ");

      return [
        csv(bookmarkName),
        csv(f.hash_md5 ?? ""),
        csv(f.hash_sha1 ?? ""),
        csv(category),
        csv(priority),
        csv(notes),
      ].join(",");
    });

  return [header, ...rows].join("\n");
}

// ── EnScript-ready JSON ───────────────────────────────────────────────────────
// Analysts using custom EnScripts can consume this JSON directly.

export function buildEnscriptJson(ctx: ForensicsTipContext, exportedBy: string): string {
  const payload = {
    _comment: "CyberTip-Triage EnScript data — import via custom EnScript or reference manually.",
    case_reference: ctx.ids_case_number ?? ctx.ncmec_tip_number ?? ctx.tip_id.slice(0, 8),
    triage_reference: ctx.tip_id,
    exported_by: exportedBy,
    export_timestamp: new Date().toISOString(),
    priority: {
      score: ctx.priority_score,
      tier: ctx.priority_tier,
      routing_unit: ctx.routing_unit,
      recommended_action: ctx.recommended_action,
    },
    offense: {
      category: ctx.offense_category,
      secondary: ctx.secondary_categories,
      iwf_category: ctx.severity_iwf,
      statutes: ctx.applicable_statutes,
    },
    subjects: ctx.subjects_summary,
    victims: {
      count: ctx.victim_count,
      age_ranges: ctx.victim_age_ranges,
      ongoing_abuse: ctx.ongoing_abuse_indicated,
    },
    known_hashes: ctx.files.map((f) => ({
      file_id: f.file_id,
      md5: f.hash_md5,
      sha1: f.hash_sha1,
      sha256: f.hash_sha256,
      photodna: f.photodna_hash,
      ncmec_match: f.ncmec_hash_match,
      project_vic_match: f.project_vic_match,
      iwf_match: f.iwf_match,
      aig: f.aig_csam_suspected,
    })),
    network: {
      ips: ctx.ip_addresses,
      domains: ctx.domains,
      usernames: ctx.usernames,
      dark_web: ctx.dark_web_urls,
      crypto: ctx.crypto_addresses,
    },
  };

  return JSON.stringify(payload, null, 2);
}

export function buildEncaseExport(
  ctx: ForensicsTipContext,
  exportedBy: string
): { caseXml: string; bookmarkCsv: string; enscriptJson: string; importInstructions: string } {
  const caseNumber = ctx.ids_case_number
    ?? ctx.ncmec_tip_number
    ?? ctx.tip_id.slice(0, 8).toUpperCase();

  const importInstructions = [
    "=== OPENTEXT ENCASE — IMPORT INSTRUCTIONS ===",
    "",
    `Case Reference : ${caseNumber}`,
    `Files Included : ${ctx.accessible_file_count} of ${ctx.total_file_count}`,
    "",
    "STEP 1 — Create / Import Case:",
    "  EnCase > File > New Case > Import from XML",
    "  Select: encase_case_<caseid>.xml",
    "  EnCase will pre-populate case metadata, subjects, and network indicators.",
    "",
    "STEP 2 — Import Bookmarks:",
    "  EnCase > View > Bookmarks > Import from CSV",
    "  Select: encase_bookmarks_<caseid>.csv",
    "  Known-CSAM files will be pre-bookmarked with priority flags.",
    "",
    "STEP 3 — Add Evidence:",
    "  Add acquired disk images or logical evidence as evidence items.",
    "  Use imported bookmark hashes to flag matches during processing.",
    "",
    "STEP 4 — Custom EnScript (optional):",
    "  Load encase_enscript_<caseid>.json as data for a custom EnScript.",
    "  This JSON provides structured access to all triage outputs.",
    "",
    "NOTE: XML and CSV contain hash metadata only — not actual media content.",
    "      Files with WarrantStatus='applied' require a granted warrant.",
  ].join("\n");

  return {
    caseXml: buildEncaseCaseXml(ctx, exportedBy),
    bookmarkCsv: buildEncaseBookmarkCsv(ctx),
    enscriptJson: buildEnscriptJson(ctx, exportedBy),
    importInstructions,
  };
}
