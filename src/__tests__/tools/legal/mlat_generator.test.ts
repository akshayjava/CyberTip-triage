
import { describe, it, expect } from "vitest";
import { generateMLATRequest, tipNeedsMLAT } from "../../../tools/legal/mlat_generator.js";
import type { CyberTip, TipFile, PreservationRequest, AuditEntry } from "../../../models/index.js";

// Helper to create a minimal valid CyberTip for testing
function createMockTip(overrides: Partial<CyberTip> = {}): CyberTip {
  const defaultTip: CyberTip = {
    tip_id: "test-tip-123",
    ncmec_tip_number: "1234567",
    source: "NCMEC_API",
    received_at: new Date().toISOString(),
    raw_body: "Test raw body",
    normalized_body: "Test normalized body",
    jurisdiction_of_tip: {
      source_country: "US",
      countries_involved: ["US"],
      likely_jurisdiction: "US",
    },
    reporter: {
      reporting_person: "Test Reporter",
      reporting_organization: "Test Org",
      contact_email: "reporter@example.com",
    },
    files: [] as TipFile[],
    is_bundled: false,
    ncmec_urgent_flag: false,
    preservation_requests: [] as PreservationRequest[],
    status: "pending",
    audit_trail: [] as AuditEntry[],
    extracted: {
      subjects: [],
      account_ids: [],
      emails: [],
      ip_addresses: [],
    },
    classification: {
      offense_category: "CSAM",
      severity: {
        overall: "P2_HIGH",
        us_icac: "P2_HIGH",
        platform: "P2_HIGH",
      },
      confidence: 0.9,
    },
  };
  return { ...defaultTip, ...overrides };
}

describe("MLAT Generator", () => {
  describe("generateMLATRequest", () => {
    it("generates CLOUD Act request for UK (GB)", () => {
      const tip = createMockTip({
        jurisdiction_of_tip: {
          source_country: "US",
          countries_involved: ["GB"],
          likely_jurisdiction: "GB",
        },
      });

      const results = generateMLATRequest(tip);
      expect(results).toHaveLength(1);
      const result = results[0];

      expect(result?.subject_country).toBe("GB");
      expect(result?.recommended_mechanism).toBe("cloud_act");
      expect(result?.mechanism_rationale).toContain("CLOUD Act");
      expect(result?.estimated_timeline).toContain("weeks"); // Faster than MLAT
    });

    it("generates Budapest Convention request for Germany (DE)", () => {
      const tip = createMockTip({
        extracted: {
          subjects: [{ name: "Hans", country: "DE" }],
          account_ids: [],
          emails: [],
          ip_addresses: [],
        },
      });

      const results = generateMLATRequest(tip);
      expect(results).toHaveLength(1);
      const result = results[0];

      expect(result?.subject_country).toBe("DE");
      expect(result?.recommended_mechanism).toBe("mlat"); // Budapest is still MLAT but prioritized
      expect(result?.mechanism_rationale).toContain("Budapest Convention");
      expect(result?.preservation_draft).toContain("Article 16");
    });

    it("generates standard MLAT request for Mexico (MX)", () => {
      const tip = createMockTip({
        extracted: {
          subject_country: "MX",
          subjects: [],
          account_ids: [],
          emails: [],
          ip_addresses: [],
        },
      });

      const results = generateMLATRequest(tip);
      expect(results).toHaveLength(1);
      const result = results[0];

      expect(result?.subject_country).toBe("MX");
      expect(result?.recommended_mechanism).toBe("mlat");
      expect(result?.mechanism_rationale).toContain("bilateral MLAT");
    });

    it("generates Letters Rogatory recommendation for Nigeria (NG)", () => {
      const tip = createMockTip({
        jurisdiction_of_tip: {
          source_country: "US",
          countries_involved: ["NG"],
          likely_jurisdiction: "NG",
        },
      });

      const results = generateMLATRequest(tip);
      expect(results).toHaveLength(1);
      const result = results[0];

      expect(result?.subject_country).toBe("NG");
      expect(result?.recommended_mechanism).toBe("letters_rogatory");
      expect(result?.mechanism_rationale).toContain("Letters rogatory");
      expect(result?.estimated_timeline).toContain("months");
    });

    it("defaults to generic international template (XX) if no country detected", () => {
      const tip = createMockTip({
        jurisdiction_of_tip: {
          source_country: "US",
          countries_involved: ["US"], // Only US
          likely_jurisdiction: "US",
        },
        extracted: {
          subjects: [],
          account_ids: [],
          emails: [],
          ip_addresses: [],
        },
      });

      const results = generateMLATRequest(tip);
      expect(results).toHaveLength(1);
      const result = results[0];

      expect(result?.subject_country).toBe("XX");
      expect(result?.request_draft).toContain("Country XX");
    });

    it("handles multiple subject countries", () => {
      const tip = createMockTip({
        jurisdiction_of_tip: {
          source_country: "US",
          countries_involved: ["CA", "JP"],
          likely_jurisdiction: "International",
        },
      });

      const results = generateMLATRequest(tip);
      expect(results).toHaveLength(2);

      const countries = results.map(r => r.subject_country).sort();
      expect(countries).toEqual(["CA", "JP"]);
    });

    it("includes extracted accounts in the draft", () => {
      const tip = createMockTip({
        jurisdiction_of_tip: {
            source_country: "US",
            countries_involved: ["GB"],
            likely_jurisdiction: "GB",
        },
        extracted: {
          subjects: [],
          account_ids: ["acc123"],
          emails: ["suspect@example.com"],
          ip_addresses: ["1.2.3.4"],
        },
      });

      const results = generateMLATRequest(tip);
      const draft = results[0]?.request_draft || "";

      expect(draft).toContain("acc123");
      expect(draft).toContain("suspect@example.com");
      expect(draft).toContain("1.2.3.4");
    });

    it("includes urgent flag language when ncmec_urgent_flag is true", () => {
      const tip = createMockTip({
        jurisdiction_of_tip: {
            source_country: "US",
            countries_involved: ["GB"],
            likely_jurisdiction: "GB",
        },
        ncmec_urgent_flag: true,
      });

      const results = generateMLATRequest(tip);
      const draft = results[0]?.request_draft || "";

      expect(draft).toContain("URGENT");
      expect(draft).toContain("ongoing danger");
    });
  });

  describe("tipNeedsMLAT", () => {
    it("returns true if foreign country involved in jurisdiction", () => {
      const tip = createMockTip({
        jurisdiction_of_tip: {
          source_country: "US",
          countries_involved: ["FR"],
          likely_jurisdiction: "FR",
        },
      });
      expect(tipNeedsMLAT(tip)).toBe(true);
    });

    it("returns true if extracted subject has foreign country", () => {
      const tip = createMockTip({
        extracted: {
          subjects: [{ name: "Test", country: "BR" }],
          account_ids: [],
          emails: [],
          ip_addresses: [],
        },
      });
      expect(tipNeedsMLAT(tip)).toBe(true);
    });

    it("returns false if only US involved", () => {
      const tip = createMockTip({
        jurisdiction_of_tip: {
          source_country: "US",
          countries_involved: ["US"],
          likely_jurisdiction: "US",
        },
      });
      expect(tipNeedsMLAT(tip)).toBe(false);
    });
  });
});
