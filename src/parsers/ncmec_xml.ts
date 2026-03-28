/**
 * NCMEC XML Parser
 *
 * Parses NCMEC CyberTipline reports delivered in XML format
 * via the NCMEC API. Maps XML fields to NcmecPdfParsed structure
 * for uniform downstream processing.
 */

import type { NcmecPdfParsed, NcmecFileMeta } from "./ncmec_pdf.js";
import type { Reporter } from "../models/index.js";

// ── Lightweight XML value extractor (no external dep needed for known schema) ─

const regexCache = new Map<string, RegExp>();

function getCachedRegex(key: string, source: string, flags: string): RegExp {
  let regex = regexCache.get(key);
  if (!regex) {
    regex = new RegExp(source, flags);
    regexCache.set(key, regex);
  }
  return regex;
}

class XmlContext {
  public safeXml: string;
  private cdatas: string[] = [];
  private comments: string[] = [];

  constructor(rawXml: string) {
    this.safeXml = rawXml
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, (match) => {
        this.cdatas.push(match);
        return `__NCMEC_XML_CDATA_${this.cdatas.length - 1}__`;
      })
      .replace(/<!--[\s\S]*?-->/g, (match) => {
        this.comments.push(match);
        return `__NCMEC_XML_COMMENT_${this.comments.length - 1}__`;
      });
  }

  restore(text: string, stripCdata = true): string {
    return text
      .replace(/__NCMEC_XML_CDATA_(\d+)__/g, (_, id) => {
        const full = this.cdatas[parseInt(id, 10)];
        return stripCdata ? full.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1") : full;
      })
      .replace(/__NCMEC_XML_COMMENT_(\d+)__/g, (_, id) => {
        return stripCdata ? "" : this.comments[parseInt(id, 10)];
      });
  }
}

function xmlText(safeXmlSnippet: string, tag: string, ctx: XmlContext): string | undefined {
  const pattern = getCachedRegex(
    `text:${tag}`,
    `<${tag}(?![a-zA-Z0-9])([^>]*)>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  );
  const m = pattern.exec(safeXmlSnippet);
  return m ? ctx.restore(m[2]).trim() || undefined : undefined;
}

function xmlAttr(safeXmlSnippet: string, tag: string, attr: string, ctx: XmlContext): string | undefined {
  const pattern = getCachedRegex(
    `attr:${tag}:${attr}`,
    `<${tag}(?![a-zA-Z0-9])[^>]*?\\s${attr}=(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const m = pattern.exec(safeXmlSnippet);
  return m ? ctx.restore(m[1] ?? m[2]).trim() || undefined : undefined;
}

function xmlAllSafe(safeXml: string, tag: string): string[] {
  const pattern = getCachedRegex(
    `all:${tag}`,
    `<${tag}(?![a-zA-Z0-9])[^>]*>[\\s\\S]*?<\\/${tag}>`,
    "gi"
  );
  pattern.lastIndex = 0; // Reset state for global regex reused from cache
  return [...safeXml.matchAll(pattern)].map((m) => m[0]);
}

/**
 * Public helper for legacy compatibility or external use.
 * Internally uses XmlContext but returns restored strings immediately.
 */
export function xmlAll(xml: string, tag: string): string[] {
  const ctx = new XmlContext(xml);
  return xmlAllSafe(ctx.safeXml, tag).map((s) => ctx.restore(s, false));
}

function parseXmlBoolean(val: string | undefined): { value: boolean; found: boolean } {
  if (!val) return { value: false, found: false };
  const norm = val.trim().toLowerCase();
  return {
    value: norm === "true" || norm === "yes" || norm === "1",
    found: true,
  };
}

// ── File entry parser ─────────────────────────────────────────────────────────

function parseXmlFileEntry(safeFileSnippet: string, ctx: XmlContext): NcmecFileMeta {
  const filename =
    xmlText(safeFileSnippet, "FileName", ctx) ??
    xmlText(safeFileSnippet, "OriginalFileName", ctx) ??
    undefined;

  const espViewedRaw = xmlText(safeFileSnippet, "ViewedByEsp", ctx) ?? xmlText(safeFileSnippet, "EspViewed", ctx);
  const espViewedResult = parseXmlBoolean(espViewedRaw);

  const publicRaw =
    xmlText(safeFileSnippet, "PubliclyAvailable", ctx) ?? xmlText(safeFileSnippet, "IsPublic", ctx);
  const publicResult = parseXmlBoolean(publicRaw);

  const ext = filename?.split(".").pop()?.toLowerCase() ?? "";
  let media_type: "image" | "video" | "document" | "other" = "other";
  if (["jpg", "jpeg", "png", "gif", "bmp", "webp", "heic", "tiff"].includes(ext))
    media_type = "image";
  else if (["mp4", "mov", "avi", "mkv", "wmv", "flv", "webm", "m4v"].includes(ext))
    media_type = "video";
  else if (["pdf", "doc", "docx", "txt"].includes(ext)) media_type = "document";

  return {
    filename,
    file_size: xmlText(safeFileSnippet, "FileSize", ctx),
    media_type,
    esp_viewed: espViewedResult.value,
    esp_viewed_missing: !espViewedResult.found,
    esp_categorized_as:
      xmlText(safeFileSnippet, "EspCategory", ctx) ??
      xmlText(safeFileSnippet, "Classification", ctx) ??
      undefined,
    publicly_available: publicResult.value,
    hash_md5: xmlText(safeFileSnippet, "MD5", ctx),
    hash_sha1: xmlText(safeFileSnippet, "SHA1", ctx) ?? xmlText(safeFileSnippet, "Sha1", ctx),
    hash_sha256: xmlText(safeFileSnippet, "SHA256", ctx) ?? xmlText(safeFileSnippet, "Sha256", ctx),
    photodna_hash: xmlText(safeFileSnippet, "PhotoDNA", ctx),
  };
}

// ── Main XML parser ───────────────────────────────────────────────────────────

export function parseNcmecXml(xmlString: string): NcmecPdfParsed {
  const ctx = new XmlContext(xmlString);
  const { safeXml } = ctx;

  const ncmecTipNumber =
    xmlText(safeXml, "TiplineNumber", ctx) ??
    xmlText(safeXml, "ReportId", ctx) ??
    xmlAttr(safeXml, "Report", "id", ctx) ??
    undefined;

  const urgentRaw =
    xmlText(safeXml, "IsUrgent", ctx) ??
    xmlText(safeXml, "Priority", ctx) ??
    xmlAttr(safeXml, "Report", "urgent", ctx);
  const ncmecUrgentFlag =
    urgentRaw?.toLowerCase() === "true" ||
    urgentRaw?.toLowerCase() === "yes" ||
    urgentRaw === "1";

  // Bundled report detection
  const bundledCountRaw =
    xmlText(safeXml, "BundledReportCount", ctx) ??
    xmlText(safeXml, "IncidentCount", ctx);
  const bundledCount = bundledCountRaw ? parseInt(bundledCountRaw, 10) : undefined;
  const isBundled = !!(bundledCount && bundledCount > 1);

  // Reporter / ESP
  const espName =
    xmlText(safeXml, "ReportingEspName", ctx) ??
    xmlText(safeXml, "EspName", ctx) ??
    xmlText(safeXml, "ReportingEntity", ctx);

  const reporter: Reporter = {
    type: "NCMEC",
    esp_name: espName,
    originating_country:
      (xmlText(safeXml, "OriginCountry", ctx) ??
        xmlText(safeXml, "Country", ctx))?.slice(0, 2).toUpperCase() as
        | `${string}${string}`
        | undefined,
  };

  // Files
  const fileSnippets = [
    ...xmlAllSafe(safeXml, "FileDetails"),
    ...xmlAllSafe(safeXml, "File"),
    ...xmlAllSafe(safeXml, "Attachment"),
  ];
  const files: NcmecFileMeta[] =
    fileSnippets.length > 0
      ? fileSnippets.map((s) => parseXmlFileEntry(s, ctx))
      : []; // No files in tip (text-only report)

  // Section-equivalent fields
  const incidentDesc =
    xmlText(safeXml, "IncidentDescription", ctx) ??
    xmlText(safeXml, "Description", ctx) ??
    xmlText(safeXml, "ContentDescription", ctx) ??
    "";

  // Related reports - iterate snippets, not full restore
  const relatedSnippets = xmlAllSafe(safeXml, "RelatedReport");
  const relatedTipNumbers = relatedSnippets
    .map((s) => xmlText(s, "TiplineNumber", ctx) ?? "")
    .filter(Boolean);

  return {
    ncmec_tip_number: ncmecTipNumber,
    ncmec_urgent_flag: ncmecUrgentFlag,
    is_bundled: isBundled,
    bundled_incident_count: bundledCount,
    reporter,
    section_a: {
      esp_name: espName,
      incident_description: incidentDesc,
      incident_time:
        xmlText(safeXml, "IncidentDateTime", ctx) ??
        xmlText(safeXml, "DateOfIncident", ctx) ??
        undefined,
      subject_email:
        xmlText(safeXml, "SubjectEmail", ctx) ??
        xmlText(safeXml, "EmailAddress", ctx) ??
        undefined,
      subject_username:
        xmlText(safeXml, "SubjectUsername", ctx) ??
        xmlText(safeXml, "Username", ctx) ??
        undefined,
      subject_ip:
        xmlText(safeXml, "SubjectIpAddress", ctx) ??
        xmlText(safeXml, "IpAddress", ctx) ??
        undefined,
      files,
    },
    section_b: {
      country:
        xmlText(safeXml, "IpCountry", ctx) ??
        xmlText(safeXml, "GeolocationCountry", ctx) ??
        undefined,
      city:
        xmlText(safeXml, "IpCity", ctx) ??
        xmlText(safeXml, "GeolocationCity", ctx) ??
        undefined,
      region:
        xmlText(safeXml, "IpState", ctx) ??
        xmlText(safeXml, "GeolocationRegion", ctx) ??
        undefined,
      isp: xmlText(safeXml, "Isp", ctx) ?? xmlText(safeXml, "IspName", ctx) ?? undefined,
      ip_geolocation:
        xmlText(safeXml, "Geolocation", ctx) ??
        xmlText(safeXml, "GeoData", ctx) ??
        undefined,
    },
    section_c: {
      additional_info:
        xmlText(safeXml, "AdditionalInformation", ctx) ??
        xmlText(safeXml, "Notes", ctx) ??
        undefined,
      related_tip_numbers: relatedTipNumbers,
      notes: xmlText(safeXml, "InvestigatorNotes", ctx) ?? undefined,
    },
  };
}
