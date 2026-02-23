import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkDeconfliction } from "../tools/deconfliction/check_deconfliction.js";

describe("checkDeconfliction Tool", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Stub Mode (Default)", () => {
    beforeEach(() => {
      // Ensure TOOL_MODE is not "real"
      process.env.TOOL_MODE = "stub";
    });

    it("returns match for 'stub_known_subject'", async () => {
      const result = await checkDeconfliction("name", "stub_known_subject", "CA");

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        match_found: true,
        agency_name: "Neighboring County Sheriff's Office",
        case_number: "SC-2024-18732",
        contact_investigator: "Det. Jane Smith — 555-0100",
        overlap_type: "same_subject",
        active_investigation: true,
        coordination_recommended: true,
        notes: "Active investigation opened 30 days ago. Do NOT contact subject or issue preservation requests without coordinating with Det. Smith first.",
      });
    });

    it("returns match for value containing 'deconflict_match'", async () => {
      const result = await checkDeconfliction("email", "suspect_deconflict_match_123@example.com", "NY");

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        match_found: true,
        active_investigation: true,
        coordination_recommended: true,
      });
      // Verify key fields are present
      expect(result.data?.agency_name).toBe("Neighboring County Sheriff's Office");
    });

    it("returns no match for other values", async () => {
      const result = await checkDeconfliction("phone", "555-0000", "TX");

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        match_found: false,
        active_investigation: false,
        coordination_recommended: false,
      });
    });
  });

  describe("Real Mode", () => {
    beforeEach(() => {
      process.env.TOOL_MODE = "real";
    });

    it("returns error result when not configured", async () => {
      const result = await checkDeconfliction("name", "John Doe", "CA");

      expect(result.success).toBe(false);
      expect(result.error).toContain("De-confliction real implementation not configured");
      expect(result.error).toContain("Register with your regional de-confliction system");
    });
  });
});
