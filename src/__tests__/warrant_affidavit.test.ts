import { describe, it, expect } from "vitest";
import { generateWarrantAffidavit, type WarrantAffidavitInput } from "../tools/legal/warrant_affidavit.js";
import type { CyberTip, TipFile } from "../models/index.js";

// Helper to create a partial CyberTip for testing
function createMockTip(overrides: Partial<CyberTip> = {}): CyberTip {
  return {
    tip_id: "tip-12345678",
    ncmec_tip_number: "12345678",
    source: "NCMEC_API",
    received_at: new Date().toISOString(),
    raw_body: "",
    normalized_body: "",
    jurisdiction_of_tip: { primary: "US_federal" },
    reporter: { reporting_person: "Unknown" },
    files: [],
    is_bundled: false,
    ncmec_urgent_flag: false,
    status: "pending",
    preservation_requests: [],
    audit_trail: [],
    classification: {
      offense_category: "CSAM",
      severity: "HIGH",
      esp_name: "TestPlatform",
    },
    extracted: {
      platforms: ["TestPlatform"],
      account_ids: ["user123"],
      ip_addresses: ["1.2.3.4"],
      victim_age_range: "14-15",
    },
    ...overrides,
  } as CyberTip;
}

// Helper to create mock TipFiles
function createMockFile(overrides: Partial<TipFile> = {}): TipFile {
  return {
    file_id: "file-uuid-1",
    media_type: "image",
    esp_viewed: false,
    esp_viewed_missing: false,
    publicly_available: false,
    warrant_required: true,
    warrant_status: "not_needed",
    file_access_blocked: true,
    ncmec_hash_match: false,
    project_vic_match: false,
    iwf_match: false,
    interpol_icse_match: false,
    aig_csam_suspected: false,
    hash_sha256: "abcdef1234567890",
    ...overrides,
  } as TipFile;
}

describe("generateWarrantAffidavit", () => {
  const defaultInput: Omit<WarrantAffidavitInput, "tip"> = {
    requesting_officer: "Det. John Doe",
    badge_number: "12345",
    unit: "Cyber Crimes Unit",
    blocked_files: [],
  };

  it("Happy Path: Generates affidavit for CSAM tip with full details", () => {
    const tip = createMockTip();
    const blockedFiles = [createMockFile()];

    const result = generateWarrantAffidavit({
      ...defaultInput,
      tip,
      blocked_files: blockedFiles,
    });

    // Tracking Number Format: WARRANT-YYYYMMDD-TIPID
    expect(result.tracking_number).toMatch(/^WARRANT-\d{8}-TIP-1234$/);

    // Target Accounts
    expect(result.target_accounts).toContain("TestPlatform");
    expect(result.target_accounts).toContain("user123");

    // Statutes for CSAM
    expect(result.applicable_statutes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("18 U.S.C. § 2252"),
        expect.stringContaining("18 U.S.C. § 2703"), // Always present
      ])
    );

    // Affidavit Text content
    expect(result.affidavit_text).toContain("Det. John Doe");
    expect(result.affidavit_text).toContain("Badge No. 12345");
    expect(result.affidavit_text).toContain("United States v. Wilson");
    expect(result.affidavit_text).toContain("SHA-256: abcdef1234567890"); // Hash from blocked file
    expect(result.affidavit_text).toContain("1.2.3.4"); // IP address
  });

  it("Different Offense Categories: SEXTORTION", () => {
    const tip = createMockTip({
      classification: { offense_category: "SEXTORTION" } as any
    });

    const result = generateWarrantAffidavit({ ...defaultInput, tip });

    expect(result.applicable_statutes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("18 U.S.C. § 875(d)"),
      ])
    );
  });

  it("Different Offense Categories: ONLINE_ENTICEMENT", () => {
    const tip = createMockTip({
      classification: { offense_category: "ONLINE_ENTICEMENT" } as any
    });

    const result = generateWarrantAffidavit({ ...defaultInput, tip });

    expect(result.applicable_statutes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("18 U.S.C. § 2422(b)"),
      ])
    );
  });

  it("Different Offense Categories: CYBER_EXPLOITATION", () => {
    const tip = createMockTip({
      classification: { offense_category: "CYBER_EXPLOITATION" } as any
    });

    const result = generateWarrantAffidavit({ ...defaultInput, tip });

    expect(result.applicable_statutes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("18 U.S.C. § 2261A"),
      ])
    );
  });

  it("Different Offense Categories: Unknown falls back to CFAA", () => {
    const tip = createMockTip({
      classification: { offense_category: "UNKNOWN_CATEGORY" } as any
    });

    const result = generateWarrantAffidavit({ ...defaultInput, tip });

    expect(result.applicable_statutes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("18 U.S.C. § 1030"),
      ])
    );
  });

  it("No Extracted Data: Handles missing entities gracefully", () => {
    const tip = createMockTip({ extracted: undefined });

    const result = generateWarrantAffidavit({ ...defaultInput, tip });

    expect(result.target_accounts).toHaveLength(0);
    expect(result.affidavit_text).toContain("[Account identifiers to be confirmed by investigator]");
  });

  it("No Blocked Files: Probable cause does not list hashes", () => {
    const tip = createMockTip();
    // blocked_files is empty in defaultInput

    const result = generateWarrantAffidavit({ ...defaultInput, tip });

    expect(result.affidavit_text).not.toContain("SHA-256:");
    expect(result.affidavit_text).not.toContain("identified by cryptographic hash value");
  });

  it("Custom Jurisdiction: Respects override", () => {
    const tip = createMockTip();

    const result = generateWarrantAffidavit({
      ...defaultInput,
      tip,
      court_jurisdiction: "STATE_OF_CALIFORNIA",
    });

    expect(result.affidavit_text).toContain("IN THE STATE OF CALIFORNIA COURT");
  });
});
