/**
 * Preservation Letter PDF Generator
 *
 * Generates a formatted 18 U.S.C. § 2703(f) / REPORT Act 2024 preservation
 * request letter as a PDF using pdf-lib (pure JavaScript, no native deps).
 *
 * The generated PDF is print-ready and watermarked with:
 *   "LAW ENFORCEMENT SENSITIVE — FOR OFFICIAL USE ONLY"
 *
 * Usage:
 *   const bytes = await generatePreservationLetterPDF(request, agencyInfo);
 *   res.setHeader("Content-Type", "application/pdf");
 *   res.send(Buffer.from(bytes));
 */

// pdf-lib CJS entry — works in both CJS and ESM via dynamic import
const pdfLibPath = new URL(
  "../../../node_modules/pdf-lib/cjs/index.js",
  import.meta.url
).pathname;

import type { PreservationRequest } from "../../models/index.js";

export interface AgencyInfo {
  name: string;
  address: string;
  city_state_zip: string;
  phone: string;
  email: string;              // Legal process contact
  officer_name: string;
  badge_number: string;
  supervisor_badge?: string;  // Set when approved
}

export interface LetterPDFResult {
  bytes: Uint8Array;
  page_count: number;
}

// ── PDF layout constants ─────────────────────────────────────────────────────

const PAGE_WIDTH  = 612;   // US Letter points
const PAGE_HEIGHT = 792;
const MARGIN      = 72;    // 1 inch
const BODY_WIDTH  = PAGE_WIDTH - 2 * MARGIN;

const COLORS = {
  black:     { r: 0,    g: 0,    b: 0    },
  dark_gray: { r: 0.2,  g: 0.2,  b: 0.2  },
  mid_gray:  { r: 0.5,  g: 0.5,  b: 0.5  },
  red:       { r: 0.7,  g: 0,    b: 0    },
  header_bg: { r: 0.1,  g: 0.2,  b: 0.4  },
};

// ── Text wrapping ────────────────────────────────────────────────────────────

function wrapText(text: string, maxWidth: number, font: unknown, size: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    // Approximate width: average char width ~= size * 0.5 for Helvetica
    if (test.length * size * 0.5 > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ── Main PDF generator ───────────────────────────────────────────────────────

export async function generatePreservationLetterPDF(
  request: PreservationRequest,
  agency: AgencyInfo
): Promise<LetterPDFResult> {
  // Dynamic import of pdf-lib (works in ESM projects)
  const pdfLib = await import(pdfLibPath) as {
    PDFDocument: { create(): Promise<unknown> };
    StandardFonts: Record<string, string>;
    rgb: (r: number, g: number, b: number) => unknown;
  };

  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const doc = await (PDFDocument as any).create();

  // Embed fonts
  const fontBold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  let y = PAGE_HEIGHT - MARGIN;

  // Helper: draw text line and advance cursor
  function drawLine(
    text: string,
    opts: {
      size?: number;
      font?: unknown;
      color?: { r: number; g: number; b: number };
      x?: number;
      indent?: number;
    } = {}
  ): void {
    const size   = opts.size   ?? 10;
    const font   = opts.font   ?? fontRegular;
    const color  = opts.color  ?? COLORS.black;
    const x      = opts.x ?? MARGIN + (opts.indent ?? 0);

    (page as any).drawText(text, {
      x,
      y,
      size,
      font,
      color: (rgb as any)(color.r, color.g, color.b),
    });
    y -= size * 1.4;
  }

  function drawWrappedParagraph(
    text: string,
    opts: {
      size?: number;
      font?: unknown;
      color?: { r: number; g: number; b: number };
      indent?: number;
    } = {}
  ): void {
    const size = opts.size ?? 10;
    const lines = wrapText(text, BODY_WIDTH - (opts.indent ?? 0), opts.font ?? fontRegular, size);
    for (const line of lines) {
      drawLine(line, { ...opts, size });
    }
  }

  function skip(pts = 8): void { y -= pts; }

  // ── Header band ────────────────────────────────────────────────────────────

  (page as any).drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 60,
    width: PAGE_WIDTH,
    height: 60,
    color: (rgb as any)(COLORS.header_bg.r, COLORS.header_bg.g, COLORS.header_bg.b),
  });

  (page as any).drawText("LAW ENFORCEMENT SENSITIVE — FOR OFFICIAL USE ONLY", {
    x: MARGIN,
    y: PAGE_HEIGHT - 22,
    size: 8,
    font: fontBold,
    color: (rgb as any)(1, 1, 0.8), // cream white
  });
  (page as any).drawText("18 U.S.C. § 2703(f) EVIDENCE PRESERVATION REQUEST", {
    x: MARGIN,
    y: PAGE_HEIGHT - 38,
    size: 11,
    font: fontBold,
    color: (rgb as any)(1, 1, 1),
  });
  (page as any).drawText(`REPORT Act 2024 (Pub. L. 118-58) — 365-Day Minimum Retention Required`, {
    x: MARGIN,
    y: PAGE_HEIGHT - 52,
    size: 8,
    font: fontOblique,
    color: (rgb as any)(0.85, 0.85, 1),
  });

  y = PAGE_HEIGHT - 80;

  // ── Request metadata ───────────────────────────────────────────────────────

  skip(4);
  drawLine(`Request ID: ${request.request_id}`, { size: 9, color: COLORS.mid_gray });
  drawLine(`Date Issued: ${new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })}`,
    { size: 9, color: COLORS.mid_gray });
  drawLine(`Legal Basis: ${request.legal_basis}`, { size: 9, color: COLORS.mid_gray });
  drawLine(`Jurisdiction: ${request.jurisdiction}`, { size: 9, color: COLORS.mid_gray });
  skip(8);

  // Divider
  (page as any).drawLine({
    start: { x: MARGIN, y },
    end:   { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: (rgb as any)(0.7, 0.7, 0.7),
  });
  skip(12);

  // ── Addressing block ───────────────────────────────────────────────────────

  drawLine(`To: ${request.esp_name}`, { size: 10, font: fontBold });
  drawLine("Legal / Law Enforcement Compliance Team", { size: 10, color: COLORS.dark_gray });
  skip(6);

  // ── Salutation ─────────────────────────────────────────────────────────────

  drawLine("Dear Legal Compliance Officer,", { size: 10 });
  skip(6);

  // ── Body paragraphs ────────────────────────────────────────────────────────

  drawWrappedParagraph(
    `Pursuant to ${request.legal_basis} and in compliance with the Strengthening Transparency ` +
    `and Obligation to Report Abuse (REPORT) Act of 2024 (Pub. L. 118-58, 18 U.S.C. § 2258A(h)), ` +
    `you are hereby requested to immediately preserve all records and information associated with ` +
    `the account(s) identified below. Federal law requires electronic service providers to retain ` +
    `tip report content for a minimum of 365 days from the date of any NCMEC CyberTipline submission.`
  );
  skip(8);

  // ── Account identifiers block ──────────────────────────────────────────────

  drawLine("ACCOUNTS SUBJECT TO THIS PRESERVATION REQUEST:", { size: 10, font: fontBold });
  skip(4);

  (page as any).drawRectangle({
    x: MARGIN,
    y: y - request.account_identifiers.length * 16 - 8,
    width: BODY_WIDTH,
    height: request.account_identifiers.length * 16 + 16,
    color: (rgb as any)(0.96, 0.96, 0.98),
    borderColor: (rgb as any)(0.7, 0.7, 0.8),
    borderWidth: 0.5,
  });
  y -= 4;
  for (let i = 0; i < request.account_identifiers.length; i++) {
    drawLine(`${i + 1}.  ${request.account_identifiers[i]}`,
      { size: 10, font: fontRegular, indent: 12 });
  }
  skip(12);

  // ── Scope ──────────────────────────────────────────────────────────────────

  drawLine("SCOPE OF PRESERVATION:", { size: 10, font: fontBold });
  skip(4);

  const scopeItems = [
    "Account registration information (name, email, phone, IP addresses used at registration)",
    "All IP access logs and session records for the past 180 days",
    "All content uploaded, shared, transmitted, or received",
    "All communications including direct messages, group messages, and metadata",
    "Payment and billing records, including associated payment instruments",
    "Device identifiers associated with the account (IMEI, MAC address, device fingerprints)",
    "Any account-linked third-party authentication (OAuth, SSO) records",
    "All data that would be subject to a search warrant or court order",
  ];

  for (const item of scopeItems) {
    const lines = wrapText(`•  ${item}`, BODY_WIDTH - 8, fontRegular, 9);
    for (const line of lines) {
      drawLine(line, { size: 9, indent: 8 });
    }
    skip(2);
  }
  skip(8);

  // ── Duration and disclosure notice ─────────────────────────────────────────

  const retentionDays = request.esp_retention_window_days ?? 365;
  const deadline = request.deadline_for_esp_response
    ? new Date(request.deadline_for_esp_response).toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })
    : `${retentionDays} days from the date of this request`;

  drawWrappedParagraph(
    `You are requested to preserve the above records for a minimum of ${retentionDays} days ` +
    `from the date of this request. The REPORT Act 2024 mandates a minimum 365-day preservation ` +
    `window for NCMEC CyberTipline report content regardless of platform retention policies.`
  );
  skip(6);

  drawWrappedParagraph(
    "THIS PRESERVATION REQUEST DOES NOT AUTHORIZE DISCLOSURE. A separate legal process " +
    "(subpoena, search warrant, or court order) will be served prior to any disclosure request. " +
    "You may not disclose to any account holder that their information has been preserved."
  );
  skip(6);

  drawWrappedParagraph(
    `Please confirm receipt of this preservation request by responding to ${agency.email} ` +
    `within 72 hours. Reference Request ID ${request.request_id} in all correspondence.`
  );
  skip(16);

  // ── Signature block ────────────────────────────────────────────────────────

  drawLine("Respectfully submitted,", { size: 10 });
  skip(20);
  drawLine(agency.officer_name, { size: 10, font: fontBold });
  drawLine(`Badge No. ${agency.badge_number}`, { size: 10 });
  drawLine(agency.name, { size: 10 });
  drawLine(agency.address, { size: 10, color: COLORS.dark_gray });
  drawLine(agency.city_state_zip, { size: 10, color: COLORS.dark_gray });
  drawLine(`Phone: ${agency.phone}  |  Email: ${agency.email}`, { size: 9, color: COLORS.dark_gray });

  if (request.approved_by) {
    skip(8);
    drawLine(`Supervisor Approval: Badge No. ${request.approved_by}`, { size: 9, font: fontOblique });
    drawLine(`Approved: ${new Date().toISOString()}`, { size: 9, color: COLORS.mid_gray });
  }

  // ── Divider + DRAFT/APPROVED watermark ────────────────────────────────────

  skip(12);
  (page as any).drawLine({
    start: { x: MARGIN, y },
    end:   { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: (rgb as any)(0.7, 0.7, 0.7),
  });
  skip(8);

  const statusLabel = request.status === "issued"
    ? "APPROVED AND ISSUED — AUTHORIZED FOR TRANSMISSION"
    : "DRAFT — REQUIRES SUPERVISOR APPROVAL BEFORE TRANSMISSION";
  const labelColor = request.status === "issued" ? COLORS.header_bg : COLORS.red;

  drawLine(statusLabel, {
    size: 8,
    font: fontBold,
    color: labelColor,
  });

  // ── Footer on every page ───────────────────────────────────────────────────

  (page as any).drawText(
    "This document contains law enforcement sensitive information. Distribution restricted to authorized personnel only.",
    { x: MARGIN, y: 28, size: 7, font: fontOblique, color: (rgb as any)(0.5, 0.5, 0.5) }
  );
  (page as any).drawText(
    `Request ID: ${request.request_id}  |  Generated: ${new Date().toISOString()}`,
    { x: MARGIN, y: 18, size: 7, font: fontRegular, color: (rgb as any)(0.6, 0.6, 0.6) }
  );

  const bytes = await doc.save();
  return { bytes, page_count: doc.getPageCount() };
}
