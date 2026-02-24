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

/**
 * Helper to handle XML edge cases like CDATA and comments by using placeholders
 * before applying regex matching. This prevents brittleness when tags appear
 * inside comments or CDATA.
 */
function withPlaceholders<T>(
  xml: string,
  fn: (safeXml: string, restore: (text: string, stripCdata?: boolean) => string) => T
): T {
  const cdatas: string[] = [];
  const comments: string[] = [];

  const safeXml = xml
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, (match) => {
      cdatas.push(match);
      return `__NCMEC_XML_CDATA_${cdatas.length - 1}__`;
    })
    .replace(/<!--[\s\S]*?-->/g, (match) => {
      comments.push(match);
      return `__NCMEC_XML_COMMENT_${comments.length - 1}__`;
    });

  const restore = (text: string, stripCdata = true) => {
    return text
      .replace(/__NCMEC_XML_CDATA_(\d+)__/g, (_, id) => {
        const full = cdatas[parseInt(id, 10)];
        return stripCdata ? full.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1") : full;
      })
      .replace(/__NCMEC_XML_COMMENT_(\d+)__/g, (_, id) => {
        return stripCdata ? "" : comments[parseInt(id, 10)];
      });
  };

  return fn(safeXml, restore);
}

function xmlText(xml: string, tag: string): string | undefined {
  return withPlaceholders(xml, (safeXml, restore) => {
    const pattern = getCachedRegex(
      `text:${tag}`,
      `<${tag}(?![a-zA-Z0-9])([^>]*)>([\\s\\S]*?)<\\/${tag}>`,
      "i"
    );
    const m = pattern.exec(safeXml);
    return m ? restore(m[2]).trim() || undefined : undefined;
  });
}

function xmlAttr(xml: string, tag: string, attr: string): string | undefined {
  return withPlaceholders(xml, (safeXml, restore) => {
    const pattern = getCachedRegex(
      `attr:${tag}:${attr}`,
      `<${tag}(?![a-zA-Z0-9])[^>]*?\\s${attr}=(?:"([^"]*)"|'([^']*)')`,
      "i"
    );
    const m = pattern.exec(safeXml);
    return m ? restore(m[1] ?? m[2]).trim() || undefined : undefined;
  });
}

export function xmlAll(xml: string, tag: string): string[] {
  return withPlaceholders(xml, (safeXml, restore) => {
    const pattern = getCachedRegex(
      `all:${tag}`,
      `<${tag}(?![a-zA-Z0-9])[^>]*>[\\s\\S]*?<\\/${tag}>`,
      "gi"
    );
    pattern.lastIndex = 0; // Reset state for global regex reused from cache
    return [...safeXml.matchAll(pattern)].map((m) => restore(m[0], false));
  });
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

function parseXmlFileEntry(fileXml: string): NcmecFileMeta {
  const filename =
    xmlText(fileXml, "FileName") ??
    xmlText(fileXml, "OriginalFileName") ??
    undefined;

  const espViewedRaw = xmlText(fileXml, "ViewedByEsp") ?? xmlText(fileXml, "EspViewed");
  const espViewedResult = parseXmlBoolean(espViewedRaw);

  const publicRaw =
    xmlText(fileXml, "PubliclyAvailable") ?? xmlText(fileXml, "IsPublic");
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
    file_size: xmlText(fileXml, "FileSize"),
    media_type,
    esp_viewed: espViewedResult.value,
    esp_viewed_missing: !espViewedResult.found,
    esp_categorized_as:
      xmlText(fileXml, "EspCategory") ??
      xmlText(fileXml, "Classification") ??
      undefined,
    publicly_available: publicResult.value,
    hash_md5: xmlText(fileXml, "MD5"),
    hash_sha1: xmlText(fileXml, "SHA1") ?? xmlText(fileXml, "Sha1"),
    hash_sha256: xmlText(fileXml, "SHA256") ?? xmlText(fileXml, "Sha256"),
    photodna_hash: xmlText(fileXml, "PhotoDNA"),
  };
}

// ── Main XML parser ───────────────────────────────────────────────────────────

export function parseNcmecXml(xmlString: string): NcmecPdfParsed {
  const ncmecTipNumber =
    xmlText(xmlString, "TiplineNumber") ??
    xmlText(xmlString, "ReportId") ??
    xmlAttr(xmlString, "Report", "id") ??
    undefined;

  const urgentRaw =
    xmlText(xmlString, "IsUrgent") ??
    xmlText(xmlString, "Priority") ??
    xmlAttr(xmlString, "Report", "urgent");
  const ncmecUrgentFlag =
    urgentRaw?.toLowerCase() === "true" ||
    urgentRaw?.toLowerCase() === "yes" ||
    urgentRaw === "1";

  // Bundled report detection
  const bundledCountRaw =
    xmlText(xmlString, "BundledReportCount") ??
    xmlText(xmlString, "IncidentCount");
  const bundledCount = bundledCountRaw ? parseInt(bundledCountRaw, 10) : undefined;
  const isBundled = !!(bundledCount && bundledCount > 1);

  // Reporter / ESP
  const espName =
    xmlText(xmlString, "ReportingEspName") ??
    xmlText(xmlString, "EspName") ??
    xmlText(xmlString, "ReportingEntity");

  const reporter: Reporter = {
    type: "NCMEC",
    esp_name: espName,
    originating_country:
      (xmlText(xmlString, "OriginCountry") ??
        xmlText(xmlString, "Country"))?.slice(0, 2).toUpperCase() as
        | `${string}${string}`
        | undefined,
  };

  // Files
  const fileEntries = [
    ...xmlAll(xmlString, "FileDetails"),
    ...xmlAll(xmlString, "File"),
    ...xmlAll(xmlString, "Attachment"),
  ];
  const files: NcmecFileMeta[] =
    fileEntries.length > 0
      ? fileEntries.map(parseXmlFileEntry)
      : []; // No files in tip (text-only report)

  // Section-equivalent fields
  const incidentDesc =
    xmlText(xmlString, "IncidentDescription") ??
    xmlText(xmlString, "Description") ??
    xmlText(xmlString, "ContentDescription") ??
    "";

  const relatedTipNumbers = xmlAll(xmlString, "RelatedReport")
    .map((r) => xmlText(r, "TiplineNumber") ?? "")
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
        xmlText(xmlString, "IncidentDateTime") ??
        xmlText(xmlString, "DateOfIncident") ??
        undefined,
      subject_email:
        xmlText(xmlString, "SubjectEmail") ??
        xmlText(xmlString, "EmailAddress") ??
        undefined,
      subject_username:
        xmlText(xmlString, "SubjectUsername") ??
        xmlText(xmlString, "Username") ??
        undefined,
      subject_ip:
        xmlText(xmlString, "SubjectIpAddress") ??
        xmlText(xmlString, "IpAddress") ??
        undefined,
      files,
    },
    section_b: {
      country:
        xmlText(xmlString, "IpCountry") ??
        xmlText(xmlString, "GeolocationCountry") ??
        undefined,
      city:
        xmlText(xmlString, "IpCity") ??
        xmlText(xmlString, "GeolocationCity") ??
        undefined,
      region:
        xmlText(xmlString, "IpState") ??
        xmlText(xmlString, "GeolocationRegion") ??
        undefined,
      isp: xmlText(xmlString, "Isp") ?? xmlText(xmlString, "IspName") ?? undefined,
      ip_geolocation:
        xmlText(xmlString, "Geolocation") ??
        xmlText(xmlString, "GeoData") ??
        undefined,
    },
    section_c: {
      additional_info:
        xmlText(xmlString, "AdditionalInformation") ??
        xmlText(xmlString, "Notes") ??
        undefined,
      related_tip_numbers: relatedTipNumbers,
      notes: xmlText(xmlString, "InvestigatorNotes") ?? undefined,
    },
  };
}
