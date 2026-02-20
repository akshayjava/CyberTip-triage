/**
 * Legal Compliance Tests — Statutes, Circuit Map, 2024 Laws
 */

import { describe, it, expect } from "vitest";
import {
  STATUTES,
  CIRCUIT_PRECEDENT_MAP,
  STOP_CSAM_ACT_2024,
  REPORT_ACT_2024,
  getCircuitPrecedent,
  circuitRequiresWarrant,
  getApplicableStatutes,
  REPORTING_OBLIGATIONS,
  INTERNATIONAL_FRAMEWORKS,
} from "../../compliance/statutes.js";

// ── Statute completeness ──────────────────────────────────────────────────────

describe("Statute definitions", () => {
  it("all statutes have citation, title, summary, and relevance", () => {
    for (const [key, statute] of Object.entries(STATUTES)) {
      expect(statute.citation, `${key} missing citation`).toBeTruthy();
      expect(statute.title, `${key} missing title`).toBeTruthy();
      expect(statute.summary, `${key} missing summary`).toBeTruthy();
      expect(statute.relevance, `${key} missing relevance`).toBeInstanceOf(Array);
      expect(statute.relevance.length, `${key} has empty relevance`).toBeGreaterThan(0);
    }
  });

  it("18 U.S.C. § 1466A covers AI-generated CSAM", () => {
    const statute = STATUTES["18_USC_1466A"]!;
    expect(statute.notes).toMatch(/AI-generated/i);
    expect(statute.relevance).toContain("CSAM");
  });

  it("18 U.S.C. § 2258A notes REPORT Act 2024 changes", () => {
    const statute = STATUTES["18_USC_2258A"]!;
    expect(statute.notes).toMatch(/REPORT Act/i);
    expect(statute.notes).toMatch(/2024/);
    expect(statute.notes).toMatch(/apparent/i);
  });

  it("18 U.S.C. § 2703(f) is present for preservation", () => {
    const statute = STATUTES["18_USC_2703F"]!;
    expect(statute.citation).toContain("2703(f)");
    expect(statute.summary).toMatch(/preserve/i);
  });

  it("18 U.S.C. § 2251 (production) is present with STOP CSAM notes", () => {
    const statute = STATUTES["18_USC_2251"]!;
    expect(statute.notes).toMatch(/STOP CSAM/i);
  });
});

// ── Circuit precedent map ─────────────────────────────────────────────────────

describe("Circuit precedent map", () => {
  it("covers all 50 states + DC", () => {
    const ALL_STATES = [
      "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
      "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
      "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
      "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
      "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
    ];
    for (const state of ALL_STATES) {
      const precedent = getCircuitPrecedent(state);
      expect(precedent, `Missing precedent for ${state}`).toBeTruthy();
      expect(precedent.circuit, `${state} has no circuit name`).toBeTruthy();
    }
  });

  it("all 9th Circuit states have Wilson as binding", () => {
    const ninthStates = ["AK", "AZ", "CA", "HI", "ID", "MT", "NV", "OR", "WA"];
    for (const state of ninthStates) {
      const precedent = getCircuitPrecedent(state);
      expect(precedent.circuit).toBe("9th Circuit");
      expect(precedent.rule).toBe("requires_warrant");
      expect(precedent.binding_case).toContain("Wilson");
    }
  });

  it("circuitRequiresWarrant is true for all 9th Circuit states", () => {
    const ninthStates = ["CA", "WA", "OR", "AZ", "NV", "ID", "MT", "AK", "HI"];
    for (const state of ninthStates) {
      expect(circuitRequiresWarrant(state)).toBe(true);
    }
  });

  it("circuitRequiresWarrant is true for undecided circuits (conservative)", () => {
    const undecidedStates = ["TX", "NY", "FL", "PA", "OH", "NC", "MI"];
    for (const state of undecidedStates) {
      // Conservative default: unknown = treat as requiring warrant
      expect(circuitRequiresWarrant(state)).toBe(true);
    }
  });

  it("7th Circuit (IL) is only non-warrant circuit (Reczek)", () => {
    const seventhStates = ["IL", "IN", "WI"];
    for (const state of seventhStates) {
      const precedent = getCircuitPrecedent(state);
      expect(precedent.circuit).toBe("7th Circuit");
      expect(precedent.rule).toBe("no_warrant_needed");
    }
  });

  it("no duplicate states across circuits", () => {
    const allStates: string[] = [];
    for (const circuit of CIRCUIT_PRECEDENT_MAP) {
      for (const state of circuit.states) {
        expect(allStates, `State ${state} appears in multiple circuits`).not.toContain(state);
        allStates.push(state);
      }
    }
  });

  it("each circuit has last_updated field for audit trail", () => {
    for (const circuit of CIRCUIT_PRECEDENT_MAP) {
      expect(circuit.last_updated, `${circuit.circuit} missing last_updated`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/
      );
    }
  });
});

// ── STOP CSAM Act 2024 ────────────────────────────────────────────────────────

describe("STOP CSAM Act 2024 compliance", () => {
  it("has Pub. L. 118-64 citation", () => {
    expect(STOP_CSAM_ACT_2024.citation).toContain("118-64");
  });

  it("covers AIG-CSAM (§ 3)", () => {
    const aigSection = STOP_CSAM_ACT_2024.key_provisions.find(
      (p: any) => p.section === "§ 3"
    );
    expect(aigSection).toBeTruthy();
    expect(aigSection!.summary).toMatch(/AI-generated/i);
    expect(aigSection!.icac_relevance).toMatch(/§ 1466A/);
  });

  it("covers sextortion mandatory minimums (§ 6)", () => {
    const sextortionSection = STOP_CSAM_ACT_2024.key_provisions.find(
      (p: any) => p.section === "§ 6"
    );
    expect(sextortionSection).toBeTruthy();
    expect(sextortionSection!.summary).toMatch(/15 years/);
    expect(sextortionSection!.summary).toMatch(/self-harm/);
  });

  it("covers civil cause of action (§ 2)", () => {
    const civilSection = STOP_CSAM_ACT_2024.key_provisions.find(
      (p: any) => p.section === "§ 2"
    );
    expect(civilSection).toBeTruthy();
    expect(civilSection!.summary).toMatch(/civil/i);
  });

  it("covers expanded NCMEC reporting (§ 4)", () => {
    const reportingSection = STOP_CSAM_ACT_2024.key_provisions.find(
      (p: any) => p.section === "§ 4"
    );
    expect(reportingSection).toBeTruthy();
    expect(reportingSection!.summary).toMatch(/reasonably apparent/i);
    expect(reportingSection!.summary).toMatch(/AI.ML/i);
  });
});

// ── REPORT Act 2024 ───────────────────────────────────────────────────────────

describe("REPORT Act 2024 compliance", () => {
  it("has correct citation", () => {
    expect(REPORT_ACT_2024.citation).toContain("117-176");
  });

  it("notes 72-hour reporting timeline", () => {
    const has72Hr = REPORT_ACT_2024.key_changes.some((c: any) => c.includes("72 hours"));
    expect(has72Hr).toBe(true);
  });

  it("notes 'apparent' CSAM requirement", () => {
    const hasApparent = REPORT_ACT_2024.key_changes.some((c: any) =>
      c.toLowerCase().includes("apparent")
    );
    expect(hasApparent).toBe(true);
  });

  it("notes sextortion reporting now required", () => {
    const hasSextortion = REPORT_ACT_2024.key_changes.some((c: any) =>
      c.toLowerCase().includes("sextortion")
    );
    expect(hasSextortion).toBe(true);
  });
});

// ── Statute lookup ────────────────────────────────────────────────────────────

describe("getApplicableStatutes", () => {
  it("CSAM always includes § 2252A and § 2256", () => {
    const statutes = getApplicableStatutes("CSAM", false, false);
    expect(statutes).toContain("18 U.S.C. § 2252A");
    expect(statutes).toContain("18 U.S.C. § 2256");
  });

  it("AIG-CSAM adds § 1466A", () => {
    const statutes = getApplicableStatutes("CSAM", false, true);
    expect(statutes).toContain("18 U.S.C. § 1466A");
  });

  it("CHILD_GROOMING includes § 2422(b)", () => {
    const statutes = getApplicableStatutes("CHILD_GROOMING", true, false);
    expect(statutes).toContain("18 U.S.C. § 2422(b)");
  });

  it("SEXTORTION with minor includes production statute", () => {
    const statutes = getApplicableStatutes("SEXTORTION", true, false);
    expect(statutes).toContain("18 U.S.C. § 2252A");
    expect(statutes).toContain("18 U.S.C. § 2251");
  });

  it("CHILD_SEX_TRAFFICKING includes § 1591", () => {
    const statutes = getApplicableStatutes("CHILD_SEX_TRAFFICKING", true, false);
    expect(statutes).toContain("18 U.S.C. § 1591");
  });
});

// ── Reporting obligations ─────────────────────────────────────────────────────

describe("Reporting obligation constants", () => {
  it("NCMEC reporting window is 72 hours per REPORT Act 2024", () => {
    expect(REPORTING_OBLIGATIONS.NCMEC_REPORT_WINDOW_HOURS).toBe(72);
  });

  it("preservation initial window is 90 days per § 2703(f)", () => {
    expect(REPORTING_OBLIGATIONS.ESP_PRESERVATION_INITIAL_DAYS).toBe(90);
  });

  it("preservation renewal is also 90 days", () => {
    expect(REPORTING_OBLIGATIONS.ESP_PRESERVATION_RENEWAL_DAYS).toBe(90);
  });
});

// ── International framework coverage ─────────────────────────────────────────

describe("International compliance frameworks", () => {
  it("Budapest Convention is documented as in-force", () => {
    expect(INTERNATIONAL_FRAMEWORKS.BUDAPEST_CONVENTION.status).toBe("in_force");
  });

  it("CLOUD Act bilateral agreements are documented", () => {
    expect(INTERNATIONAL_FRAMEWORKS.CLOUD_ACT.summary).toMatch(/UK/);
    expect(INTERNATIONAL_FRAMEWORKS.CLOUD_ACT.summary).toMatch(/Australia/);
  });

  it("EU CSAR status reflects 2025 reality (pending)", () => {
    expect(INTERNATIONAL_FRAMEWORKS.EU_CSAR.status).toContain("pending");
  });

  it("MLAT notes emergency 24-72 hour option", () => {
    expect(INTERNATIONAL_FRAMEWORKS.MLAT.summary).toMatch(/24.72 hours/);
  });
});
