import { runTool, type ToolResult } from "../types.js";
import { randomUUID } from "crypto";
import { getRetentionDeadline } from "./esp_retention.js";
import type { PreservationRequest } from "../../models/index.js";

export interface PreservationRequestInput {
  espName: string;
  accountIdentifiers: string[];
  jurisdiction: string;
  tipId: string;
  retentionDeadline?: string;
}

function buildLetterText(
  espName: string,
  accountIdentifiers: string[],
  jurisdiction: string,
  requestId: string
): string {
  const isUS = jurisdiction === "US" || jurisdiction.length === 2 && jurisdiction === jurisdiction.toUpperCase() && /^[A-Z]{2}$/.test(jurisdiction);
  const legalBasis = isUS
    ? "18 U.S.C. § 2703(f)"
    : "Budapest Convention on Cybercrime, Article 16";

  return `
EVIDENCE PRESERVATION REQUEST
Request ID: ${requestId}
Date: ${new Date().toISOString().split("T")[0]}

To: ${espName} Legal/Law Enforcement Compliance Team

Pursuant to ${legalBasis}, you are hereby requested to preserve all records
and information associated with the following account(s):

${accountIdentifiers.map((id, i) => `  ${i + 1}. ${id}`).join("\n")}

You are requested to preserve all records including but not limited to:
- Account registration information (name, email, phone, IP addresses used)
- Login/access logs for the past 180 days
- All content uploaded, shared, or transmitted
- All communications (to the extent available)
- Payment and billing information
- Device identifiers (IMEI, MAC addresses, etc.)

This preservation request does NOT authorize disclosure of the preserved records.
A separate legal process (subpoena, court order, or search warrant) will be
served for disclosure.

Please preserve these records for 90 days from the date of this request.
Please confirm receipt by responding to [AGENCY EMAIL].

[DRAFT — Requires investigator review and approval before sending]
[Reference: ${legalBasis}]
`.trim();
}

async function generatePreservationRequestStub(
  input: PreservationRequestInput
): Promise<PreservationRequest> {
  await new Promise(r => setTimeout(r, 10));

  const requestId = randomUUID();
  const deadline = input.retentionDeadline
    ?? getRetentionDeadline(input.espName, new Date().toISOString());

  const isUS = input.jurisdiction === "US" ||
    (input.jurisdiction.length === 2 && /^[A-Z]{2}$/.test(input.jurisdiction));

  return {
    request_id: requestId,
    tip_id: input.tipId,
    esp_name: input.espName,
    account_identifiers: input.accountIdentifiers,
    legal_basis: isUS ? "18 U.S.C. § 2703(f)" : "Budapest Convention Article 16",
    jurisdiction: input.jurisdiction,
    deadline_for_esp_response: deadline,
    status: "draft",
    auto_generated: true,
    letter_text: buildLetterText(
      input.espName,
      input.accountIdentifiers,
      input.jurisdiction,
      requestId
    ),
  };
}

async function generatePreservationRequestReal(
  input: PreservationRequestInput
): Promise<PreservationRequest> {
  // Real implementation would use agency letterhead template
  // and route through case management system
  return generatePreservationRequestStub(input);
}

export async function generatePreservationRequest(
  input: PreservationRequestInput
): Promise<ToolResult<PreservationRequest>> {
  const fn = process.env["TOOL_MODE"] === "real"
    ? generatePreservationRequestReal
    : generatePreservationRequestStub;
  return runTool(() => fn(input));
}
