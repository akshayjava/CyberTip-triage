import { DeconflictionProvider, DeconflictionResult } from "../types.js";

/**
 * Stub implementation for development and testing.
 * Known conflict values: "deconflict_match" or "stub_known_subject"
 */
export class StubDeconflictionProvider implements DeconflictionProvider {
  async check(identifierType: string, value: string, jurisdiction: string): Promise<DeconflictionResult> {
    await new Promise((resolve) => setTimeout(resolve, 25));

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
}
