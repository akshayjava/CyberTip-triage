/**
 * NCMEC PDF Parser
 *
 * Parses the structured text extracted from NCMEC CyberTip PDF reports.
 * NCMEC PDFs have three labeled sections (A, B, C) with consistent
 * field headers. This parser is regex-based with robust fallbacks.
 *
 * CRITICAL: The esp_viewed and publicly_available fields in Section A
 * determine Wilson Ruling compliance for every file. If absent → missing flag.
 */

import { randomUUID } from "crypto";
import type { TipFile, Reporter } from "../models/index.js";

export interface NcmecFileMeta {
  filename?: string;
  file_size?: string;
  media_type: "image" | "video" | "document" | "other";
  esp_viewed: boolean;
  esp_viewed_missing: boolean;
  esp_categorized_as?: string;
  publicly_available: boolean;
  hash_md5?: string;
  hash_sha1?: string;
  hash_sha256?: string;
  photodna_hash?: string;
}

export interface NcmecPdfParsed {
  ncmec_tip_number?: string;
  ncmec_urgent_flag: boolean;
  is_bundled: boolean;
  bundled_incident_count?: number;
  reporter: Reporter;

  section_a: {
    esp_name?: string;
    incident_description: string;
    incident_time?: string;
    subject_email?: string;
    subject_username?: string;
    subject_ip?: string;
    files: NcmecFileMeta[];
    additional_context?: string;
  };

  section_b: {
    ip_geolocation?: string;
    isp?: string;
    country?: string;
    city?: string;
    region?: string;
  };

  section_c: {
    additional_info?: string;
    related_tip_numbers: string[];
    notes?: string;
  };
}

// ── Field extraction helpers ─────────────────────────────────────────────────

function extractField(text: string, ...patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const m = pattern.exec(text);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

function extractBooleanField(
  text: string,
  ...patterns: RegExp[]
): { value: boolean; found: boolean } {
  for (const pattern of patterns) {
    const m = pattern.exec(text);
    if (m?.[1]) {
      const val = m[1].trim().toLowerCase();
      return { value: val === "yes" || val === "true" || val === "1", found: true };
    }
  }
  return { value: false, found: false };
}

function inferMediaType(filename?: string): "image" | "video" | "document" | "other" {
  if (!filename) return "other";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "bmp", "webp", "heic", "tiff"].includes(ext)) return "image";
  if (["mp4", "mov", "avi", "mkv", "wmv", "flv", "webm", "m4v"].includes(ext)) return "video";
  if (["pdf", "doc", "docx", "txt", "rtf"].includes(ext)) return "document";
  return "other";
}

// ── File block parser ─────────────────────────────────────────────────────────

function parseFileBlock(block: string): NcmecFileMeta {
  const filename = extractField(
    block,
    /File(?:name)?:\s*(.+)/i,
    /Attachment:\s*(.+)/i,
    /Original\s+Filename:\s*(.+)/i
  );

  const espViewedResult = extractBooleanField(
    block,
    /File\s+[Vv]iewed\s+by\s+[Rr]eporting\s+ESP:\s*(Yes|No|True|False)/i,
    /ESP\s+[Vv]iewed:\s*(Yes|No|True|False)/i,
    /[Vv]iewed\s+by\s+ESP:\s*(Yes|No)/i
  );

  const publicResult = extractBooleanField(
    block,
    /(?:File\s+)?[Pp]ublicly\s+[Aa]vailable:\s*(Yes|No|True|False)/i,
    /[Pp]ublic(?:ly)?\s+[Aa]ccessible:\s*(Yes|No)/i
  );

  return {
    filename,
    file_size: extractField(block, /File\s+[Ss]ize:\s*(.+)/i, /Size:\s*(\d+\s*\w+)/i),
    media_type: inferMediaType(filename),
    esp_viewed: espViewedResult.value,
    esp_viewed_missing: !espViewedResult.found,
    esp_categorized_as: extractField(
      block,
      /ESP\s+(?:Category|Classification):\s*(.+)/i,
      /Categorized\s+[Aa]s:\s*(.+)/i
    ),
    publicly_available: publicResult.value,
    hash_md5: extractField(block, /MD5:\s*([a-fA-F0-9]{32})/i),
    hash_sha1: extractField(block, /SHA[-\s]?1:\s*([a-fA-F0-9]{40})/i),
    hash_sha256: extractField(block, /SHA[-\s]?256:\s*([a-fA-F0-9]{64})/i),
    photodna_hash: extractField(block, /PhotoDNA(?:\s+Hash)?:\s*([^\n]+)/i),
  };
}

// ── Section splitter ─────────────────────────────────────────────────────────

function splitSections(text: string): {
  a: string;
  b: string;
  c: string;
  header: string;
} {
  const sectionAStart = text.search(/Section\s+A[:\s]/i);
  const sectionBStart = text.search(/Section\s+B[:\s]/i);
  const sectionCStart = text.search(/Section\s+C[:\s]/i);

  const header = sectionAStart > 0 ? text.slice(0, sectionAStart) : "";

  const a =
    sectionAStart >= 0
      ? text.slice(
          sectionAStart,
          sectionBStart > sectionAStart ? sectionBStart : undefined
        )
      : text; // Fall back to whole text if no section markers

  const b =
    sectionBStart >= 0
      ? text.slice(
          sectionBStart,
          sectionCStart > sectionBStart ? sectionCStart : undefined
        )
      : "";

  const c = sectionCStart >= 0 ? text.slice(sectionCStart) : "";

  return { a, b, c, header };
}

// ── File block splitter ───────────────────────────────────────────────────────

function extractFileBlocks(sectionA: string): string[] {
  // NCMEC marks file blocks with consistent headers
  const splitPatterns = [
    /(?=Uploaded\s+File\s*\d*[:\s])/gi,
    /(?=Attachment\s*\d*[:\s])/gi,
    /(?=File\s*\d+[:\s])/gi,
  ];

  for (const pattern of splitPatterns) {
    const parts = sectionA.split(pattern);
    if (parts.length > 1) {
      // First part is usually the section A header/preamble (ESP info, subject info)
      // Discard it if we successfully split by file markers
      return parts.slice(1).filter((p) => p.trim().length > 20);
    }
  }

  // Single file — return entire section A as one block
  return [sectionA];
}

// ── Main parser ───────────────────────────────────────────────────────────────

export function parseNcmecPdfText(text: string): NcmecPdfParsed {
  const { a, b, c, header } = splitSections(text);

  // Header / tip-level fields
  const ncmecTipNumber = extractField(
    header + a,
    /(?:NCMEC\s+)?(?:Tip|Report|CyberTip(?:line)?)\s*(?:Number|#|No\.?):\s*(\d+)/i,
    /Report\s+ID:\s*(\d+)/i
  );

  const ncmecUrgent =
    /urgent|priority\s+1|P1/i.test(header) ||
    /ESP\s+marked\s+urgent/i.test(header);

  const bundledMatch = /Bundled\s+Report[:\s]+(\d+)\s+incidents?/i.exec(text);
  const isBundled = !!bundledMatch || /bundled/i.test(header);
  const bundledCount = bundledMatch ? parseInt(bundledMatch[1] ?? "0", 10) : undefined;

  const espName = extractField(
    a,
    /(?:^|\n)(?:Reporting\s+)?(?:ESP|Electronic\s+Service\s+Provider)[:\s]+(.+)/i,
    /(?:^|\n)Report(?:ed|ing)\s+Company[:\s]+(.+)/i,
    /(?:^|\n)Submitted\s+[Bb]y[:\s]+(.+)/i
  );

  // File blocks
  const fileBlocks = extractFileBlocks(a);
  const files = fileBlocks.map(parseFileBlock);

  // Section B — geolocation
  const country = extractField(b, /Country[:\s]+(.+)/i, /Location[:\s]+(.+)/i);
  const isp = extractField(b, /ISP[:\s]+(.+)/i, /Internet\s+Service\s+Provider[:\s]+(.+)/i);
  const ipGeo = extractField(b, /(?:IP\s+)?Geolocation[:\s]+(.+)/i);

  // Section C — related tips
  const relatedMatches = [...(c.matchAll(/(?:Related\s+Tip|Prior\s+Report)[:\s]+(\d+)/gi))];
  const relatedTipNumbers = relatedMatches.map((m) => m[1] ?? "");

  // Reporter
  const reporter: Reporter = {
    type: "NCMEC",
    esp_name: espName,
    originating_country: country?.slice(0, 2).toUpperCase() as `${string}${string}` | undefined,
  };

  return {
    ncmec_tip_number: ncmecTipNumber,
    ncmec_urgent_flag: ncmecUrgent,
    is_bundled: isBundled,
    bundled_incident_count: bundledCount,
    reporter,
    section_a: {
      esp_name: espName,
      incident_description: a.slice(0, 2000),
      incident_time: extractField(
        a,
        /(?:Incident\s+)?(?:Date|Time)[:\s]+(.+)/i,
        /Occurred[:\s]+(.+)/i
      ),
      subject_email: extractField(a, /(?:Subject\s+)?Email[:\s]+([\w.+%-]+@[\w.-]+\.\w+)/i),
      subject_username: extractField(
        a,
        /(?:Subject\s+)?Username[:\s]+(.+)/i,
        /Screen\s+Name[:\s]+(.+)/i
      ),
      subject_ip: extractField(
        a,
        /(?:Subject(?:'s)?\s+)?IP(?:\s+Address)?[:\s]+([\d.]+|[a-fA-F0-9:]+)/i
      ),
      files,
    },
    section_b: {
      ip_geolocation: ipGeo,
      isp,
      country,
      city: extractField(b, /City[:\s]+(.+)/i),
      region: extractField(b, /(?:State|Region|Province)[:\s]+(.+)/i),
    },
    section_c: {
      additional_info: c.slice(0, 1000) || undefined,
      related_tip_numbers: relatedTipNumbers,
      notes: extractField(c, /Notes?[:\s]+(.+)/i),
    },
  };
}

// ── Convert parsed PDF → TipFile array ───────────────────────────────────────

export function ncmecFilesToTipFiles(files: NcmecFileMeta[]): TipFile[] {
  return files.map((f) => ({
    file_id: randomUUID(),
    filename: f.filename,
    media_type: f.media_type,
    hash_md5: f.hash_md5,
    hash_sha1: f.hash_sha1,
    hash_sha256: f.hash_sha256,
    photodna_hash: f.photodna_hash,
    // Wilson compliance — set by parser, enforced by Legal Gate
    esp_viewed: f.esp_viewed,
    esp_viewed_missing: f.esp_viewed_missing,
    esp_categorized_as: f.esp_categorized_as,
    publicly_available: f.publicly_available,
    // Conservative defaults — Legal Gate will compute final values
    warrant_required: !f.esp_viewed || f.esp_viewed_missing,
    warrant_status: "applied" as const,
    file_access_blocked: !f.esp_viewed || f.esp_viewed_missing,
    // Hash match results — populated later by Hash & OSINT Agent
    ncmec_hash_match: false,
    project_vic_match: false,
    iwf_match: false,
    interpol_icse_match: false,
    aig_csam_suspected: false,
  }));
}
