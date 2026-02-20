/**
 * Preservation Letter Generator
 *
 * TIER 2.1 FEATURE — Generates 18 U.S.C. § 2703(f) preservation letters
 * pre-populated from extracted tip data. Replaces 20–30 min manual drafting.
 *
 * Flow:
 *   1. Priority Agent auto-generates preservation request stubs
 *   2. This module builds a formatted letter from the stub
 *   3. Supervisor reviews and approves via POST /api/preservation/:id/approve
 *   4. On approval: letter is emailed to ESP legal; status → "issued"
 *
 * REPORT Act 2024 compliance:
 *   - All letters request 365-day retention minimum (REPORT_ACT_MIN_DAYS)
 *   - IMMEDIATE tier letters include expedited 10-day response deadline
 *   - Letter template references 18 U.S.C. § 2258A(h) as amended
 *
 * Letter template sources:
 *   - Based on NCMEC model preservation request language
 *   - Adapted for REPORT Act 2024 statutory updates
 *   - Budapest Convention language for international ESPs
 *
 * This file supplements generate_preservation_request.ts (which creates
 * the PreservationRequest record). This module generates the final
 * human-readable letter body as a formatted string (PDF rendered via
 * Puppeteer in a future Tier 2.1+ task).
 */

import { REPORT_ACT_MIN_DAYS } from "./esp_retention.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LetterAgencyInfo {
  agency_name: string;
  unit_name: string;
  requesting_officer: string;
  badge_number: string;
  phone: string;
  email: string;
  address: string;
  case_number?: string;
}

export interface LetterInput {
  request_id: string;
  esp_name: string;
  esp_legal_email?: string;
  account_identifiers: string[];         // Emails, IPs, usernames, phone numbers
  tip_id: string;
  priority_tier: "IMMEDIATE" | "URGENT" | "STANDARD" | "MONITOR";
  jurisdiction: string;                  // "US" | ISO country code
  agency: LetterAgencyInfo;
  additional_context?: string;           // Optional investigator notes (non-PII)
}

export interface GeneratedLetter {
  request_id: string;
  letter_text: string;
  response_deadline: string;             // ISO 8601 date
  retention_days: number;               // 365 minimum per REPORT Act
  legal_basis: string;
  requires_supervisor_approval: boolean;
}

// ── ESP legal contacts (common platforms) ─────────────────────────────────────

const ESP_LEGAL_CONTACTS: Record<string, string> = {
  "Meta/Facebook":   "facebook.com/records",
  "Meta/Instagram":  "instagram.com/records",
  "Google":          "google.com/legalrequests",
  "YouTube":         "support.google.com/legal",
  "Apple":           "apple.com/legal/privacy/law-enforcement",
  "Microsoft":       "legal.microsoft.com",
  "Snapchat":        "snap.com/en-US/terms/law-enforcement",
  "TikTok":          "tiktok.com/legal/law-enforcement",
  "Twitter/X":       "legal.x.com",
  "Discord":         "discord.com/safety/360044149591",
  "Kik":             "legal.kik.com",
};

// ── Letter builder ────────────────────────────────────────────────────────────

/**
 * Generate a formatted 18 U.S.C. § 2703(f) preservation letter.
 *
 * TIER 2.1 — Complete implementation. Activated once:
 *   - POST /api/preservation/generate route is wired
 *   - Supervisor approval endpoint is wired
 *   - nodemailer delivery to ESP is configured
 */
export function generatePreservationLetter(input: LetterInput): GeneratedLetter {
  const isUS =
    input.jurisdiction === "US" ||
    (input.jurisdiction.length === 2 && /^[A-Z]{2}$/.test(input.jurisdiction) &&
     ["US", "CA"].includes(input.jurisdiction));

  const legalBasis = isUS
    ? "18 U.S.C. § 2703(f) and 18 U.S.C. § 2258A(h) (REPORT Act, Pub. L. 118-58)"
    : "Budapest Convention on Cybercrime, Article 16 (ETS No. 185)";

  // Response deadline: 10 days for IMMEDIATE, 30 days for others
  const deadlineDays = input.priority_tier === "IMMEDIATE" ? 10 : 30;
  const deadlineDate = new Date();
  deadlineDate.setDate(deadlineDate.getDate() + deadlineDays);
  const deadline = deadlineDate.toISOString().split("T")[0] ?? deadlineDate.toISOString().slice(0, 10);

  const espContact =
    input.esp_legal_email ??
    ESP_LEGAL_CONTACTS[input.esp_name] ??
    "[ESP LEGAL COMPLIANCE — contact information required]";

  const accountList = input.account_identifiers
    .map((id, i) => `  ${i + 1}. ${id}`)
    .join("\n");

  const letterText = `
${input.agency.agency_name}
${input.agency.unit_name}
${input.agency.address}

${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}

TO:   ${input.esp_name}
      Legal/Law Enforcement Compliance
      ${espContact}

RE:   Evidence Preservation Request — Request ID ${input.request_id}
      ${input.agency.case_number ? `Agency Case Number: ${input.agency.case_number}` : ""}
      Priority: ${input.priority_tier}

      THIS IS A PRESERVATION REQUEST — NOT A DEMAND FOR DISCLOSURE

Pursuant to ${legalBasis}, the ${input.agency.agency_name}, ${input.agency.unit_name},
hereby requests that ${input.esp_name} IMMEDIATELY PRESERVE AND MAINTAIN all records
and information in your possession, custody, or control associated with the following
account(s) and/or identifier(s):

${accountList}

This preservation request applies to all records, including but not limited to:

  1. Account registration information (name, email address, telephone number, physical
     address, date of birth, account creation date, account status)
  2. IP address logs, login history, and access records for the past 365 days
  3. All content uploaded, stored, transmitted, or received via the account(s)
  4. All private or direct messages, communications, or other content
  5. Payment and billing information, including credit card or PayPal records
  6. Device identifiers (IMEI, MAC address, hardware serial numbers)
  7. Any additional accounts or identifiers associated with or linked to the above
  8. Any other records or information that may be relevant to a law enforcement investigation

RETENTION PERIOD: You are requested to preserve these records for a period of not less
than ${REPORT_ACT_MIN_DAYS} days from the date of this letter, in accordance with
18 U.S.C. § 2258A(h) as amended by the Strengthening Transparency and Obligation to
Report Abuse (REPORT) Act, Pub. L. 118-58 (signed May 7, 2024).

IMPORTANT: This preservation request does NOT authorize, require, or request the
disclosure of any preserved records. All preserved records must remain confidential.
A separate and distinct legal process — such as a subpoena, court order, or search
warrant — will be served upon you prior to any required disclosure.

${input.priority_tier === "IMMEDIATE" ? `
⚠ EXPEDITED REQUEST: Due to the time-sensitive nature of this matter (Priority:
IMMEDIATE), please confirm receipt of this preservation request within 24 hours
and complete preservation within 48 hours. A response is requested by ${deadline}.
` : `
Please confirm receipt of this preservation request by ${deadline}.
`}

Questions regarding this request should be directed to:

  ${input.agency.requesting_officer}
  Badge No.: ${input.agency.badge_number}
  ${input.agency.unit_name}, ${input.agency.agency_name}
  Phone: ${input.agency.phone}
  Email: ${input.agency.email}

${input.additional_context ? `\nAdditional context for your compliance team:\n${input.additional_context}\n` : ""}

${"-".repeat(70)}
DRAFT — This letter requires supervisor review and approval before transmission.
Internal Reference: ${input.request_id} | Tip: ${input.tip_id}
Legal Basis: ${legalBasis}
${"-".repeat(70)}
`.trim();

  return {
    request_id: input.request_id,
    letter_text: letterText,
    response_deadline: deadline,
    retention_days: REPORT_ACT_MIN_DAYS,
    legal_basis: legalBasis,
    requires_supervisor_approval: true,
  };
}

/**
 * Returns the best available ESP legal contact for a given ESP name.
 * Falls back to a placeholder if ESP is not in the known-contacts list.
 */
export function getESPLegalContact(espName: string): string {
  return ESP_LEGAL_CONTACTS[espName] ?? "[ESP legal contact — verify before sending]";
}
