import { runTool, type ToolResult } from "../types.js";

export interface DeconflictionResult {
  match_found: boolean;
  agency_name?: string;
  case_number?: string;
  contact_investigator?: string;
  overlap_type?: "same_subject" | "same_victim" | "same_ip" | "same_hash" | "same_username";
  active_investigation: boolean;
  coordination_recommended: boolean;
  notes?: string;
}

// Known conflict values for stub testing
// Any value containing "deconflict_match" triggers a conflict
async function checkDeconflictionStub(
  identifierType: string,
  value: string,
  jurisdiction: string
): Promise<DeconflictionResult> {
  await new Promise(r => setTimeout(r, 25));

  const hasConflict = value.includes("deconflict_match") || value === "stub_known_subject";

  if (hasConflict) {
    return {
      match_found: true,
      agency_name: "Neighboring County Sheriff's Office",
      case_number: "SC-2024-18732",
      contact_investigator: "Det. Jane Smith — 555-0100",
      overlap_type: "same_subject",
      active_investigation: true,
      coordination_recommended: true,
      notes:
        "Active investigation opened 30 days ago. Do NOT contact subject or issue " +
        "preservation requests without coordinating with Det. Smith first.",
    };
  }

  return {
    match_found: false,
    active_investigation: false,
    coordination_recommended: false,
  };
}

async function checkDeconflictionReal(
  identifierType: string,
  value: string,
  jurisdiction: string
): Promise<DeconflictionResult> {
  // TODO: Integrate with agency's de-confliction system.
  // Common systems: RISSafe (RISS.net), HighWay (HIDTA), DEA HIDTA
  // Each requires separate LE registration and API credentials.
  throw new Error(
    "De-confliction real implementation not configured. " +
    "Register with your regional de-confliction system (RISSafe, HighWay, or HIDTA)."
  );
}

export async function checkDeconfliction(
  identifierType: string,
  value: string,
  jurisdiction: string
): Promise<ToolResult<DeconflictionResult>> {
  const fn = process.env["TOOL_MODE"] === "real" ? checkDeconflictionReal : checkDeconflictionStub;
  return runTool(() => fn(identifierType, value, jurisdiction));
}
