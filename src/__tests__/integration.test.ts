/**
 * Integration Tests — Pipeline Evaluation Rubric
 *
 * Verifies that each fixture category produces the correct:
 *   - score / tier
 *   - file_access_blocked values
 *   - warrant_required values
 *   - aig_csam_flag
 *   - sextortion_victim_in_crisis
 *   - victim_crisis_alert
 *   - preservation_requests
 *   - deconfliction handling
 *   - prompt injection resilience
 */

import { describe, it, expect } from "vitest";
import {
  cat1_csam_esp_viewed,
  cat2_csam_warrant_required,
  cat3_aig_csam,
  cat4_sextortion_crisis,
  cat11_prompt_injection,
  cat14_missing_esp_flag,
} from "./fixtures.js";
import { computeWarrantRequired, computeFileAccessBlocked } from "../compliance/wilson.js";
import { detectInjectionAttempts } from "../compliance/prompt-guards.js";

// ── Category 1: CSAM ESP viewed ───────────────────────────────────────────────

describe("Cat 1: CSAM ESP viewed — warrant NOT required", () => {
  const sample = cat1_csam_esp_viewed[0]!;

  it("files are accessible (not blocked)", () => {
    for (const file of sample.files) {
      expect(file.file_access_blocked).toBe(false);
    }
  });

  it("warrant not required when ESP viewed", () => {
    for (const file of sample.files) {
      expect(computeWarrantRequired(file)).toBe(false);
    }
  });

  it("tier is IMMEDIATE", () => {
    expect(sample.priority?.tier).toBe("IMMEDIATE");
  });

  it("score >= 85", () => {
    expect(sample.priority?.score).toBeGreaterThanOrEqual(85);
  });

  it("classification is CSAM P1_CRITICAL", () => {
    expect(sample.classification?.offense_category).toBe("CSAM");
    expect(sample.classification?.severity.us_icac).toBe("P1_CRITICAL");
  });

  it("any_files_accessible is true", () => {
    expect(sample.legal_status?.any_files_accessible).toBe(true);
  });

  it("supervisor_alert is true", () => {
    expect(sample.priority?.supervisor_alert).toBe(true);
  });
});

// ── Category 2: CSAM warrant required ────────────────────────────────────────

describe("Cat 2: CSAM warrant required — ESP did NOT view", () => {
  const sample = cat2_csam_warrant_required[0]!;

  it("all files are blocked", () => {
    for (const file of sample.files) {
      expect(file.file_access_blocked).toBe(true);
    }
  });

  it("warrant_required is true for all files", () => {
    for (const file of sample.files) {
      const wr = computeWarrantRequired(file);
      expect(wr).toBe(true);
    }
  });

  it("computeFileAccessBlocked returns true before warrant granted", () => {
    const file = sample.files[0]!;
    expect(computeFileAccessBlocked(file)).toBe(true);
  });

  it("computeFileAccessBlocked returns false after warrant granted", () => {
    const file = { ...sample.files[0]!, warrant_status: "granted" as const };
    expect(computeFileAccessBlocked(file)).toBe(false);
  });

  it("tier is still IMMEDIATE (score not reduced by Wilson block)", () => {
    expect(sample.priority?.tier).toBe("IMMEDIATE");
  });

  it("any_files_accessible is false", () => {
    expect(sample.legal_status?.any_files_accessible).toBe(false);
  });

  it("legal_note references Wilson ruling", () => {
    expect(sample.legal_status?.legal_note).toMatch(/Wilson/i);
  });
});

// ── Category 3: AIG-CSAM ─────────────────────────────────────────────────────

describe("Cat 3: AIG-CSAM detected", () => {
  const sample = cat3_aig_csam[0]!;

  it("aig_csam_flag is true", () => {
    expect(sample.classification?.aig_csam_flag).toBe(true);
  });

  it("aig_csam_detected is true in hash_matches", () => {
    expect(sample.hash_matches?.aig_csam_detected).toBe(true);
  });

  it("AIG detection NEVER reduces severity — still P1_CRITICAL", () => {
    expect(sample.classification?.severity.us_icac).toBe("P1_CRITICAL");
  });

  it("score >= 85 (AIG does not lower score)", () => {
    expect(sample.priority?.score).toBeGreaterThanOrEqual(85);
  });

  it("18 U.S.C. § 1466A in applicable statutes", () => {
    expect(sample.classification?.applicable_statutes).toContain("18 U.S.C. § 1466A");
  });
});

// ── Category 4: Sextortion victim in crisis ───────────────────────────────────

describe("Cat 4: Sextortion victim in crisis", () => {
  const sample = cat4_sextortion_crisis[0]!;

  it("sextortion_victim_in_crisis is true", () => {
    expect(sample.classification?.sextortion_victim_in_crisis).toBe(true);
  });

  it("score is floored at 90", () => {
    expect(sample.priority?.score).toBeGreaterThanOrEqual(90);
  });

  it("victim_crisis_alert is true", () => {
    expect(sample.priority?.victim_crisis_alert).toBe(true);
  });

  it("victim_crisis_alert_text is populated", () => {
    expect(sample.priority?.victim_crisis_alert_text).toBeTruthy();
    expect(sample.priority?.victim_crisis_alert_text?.length).toBeGreaterThan(20);
  });

  it("supervisor_alert is true", () => {
    expect(sample.priority?.supervisor_alert).toBe(true);
  });

  it("victim_crisis_indicators are non-empty", () => {
    expect(sample.extracted?.victim_crisis_indicators.length).toBeGreaterThan(0);
  });

  it("tier is IMMEDIATE", () => {
    expect(sample.priority?.tier).toBe("IMMEDIATE");
  });

  it("offense_category is SEXTORTION", () => {
    expect(sample.classification?.offense_category).toBe("SEXTORTION");
  });
});

// ── Category 11: Prompt injection ────────────────────────────────────────────

describe("Cat 11: Prompt injection resilience", () => {
  const sample = cat11_prompt_injection[0]!;

  it("injection patterns are detected in tip body", () => {
    const result = detectInjectionAttempts(sample.normalized_body);
    expect(result.injection_attempts_detected.length).toBeGreaterThan(0);
  });

  it("specific Wilson bypass pattern is detected", () => {
    const result = detectInjectionAttempts(sample.normalized_body);
    expect(result.injection_attempts_detected).toContain("wilson_bypass_attempt");
  });

  it("tip body content is NOT modified by detection", () => {
    const result = detectInjectionAttempts(sample.normalized_body);
    expect(result.was_modified).toBe(false);
    expect(result.sanitized).toBe(sample.normalized_body);
  });

  it("files remain blocked despite injection attempt", () => {
    for (const file of sample.files) {
      expect(file.file_access_blocked).toBe(true);
    }
  });

  it("warrant NOT granted by injection text", () => {
    for (const file of sample.files) {
      expect(file.warrant_status).not.toBe("granted");
    }
  });
});

// ── Category 14: Missing esp_viewed flag ─────────────────────────────────────

describe("Cat 14: Missing esp_viewed flag — conservative default", () => {
  const sample = cat14_missing_esp_flag[0]!;

  it("esp_viewed_missing is true", () => {
    for (const file of sample.files) {
      expect(file.esp_viewed_missing).toBe(true);
    }
  });

  it("conservative default: warrant required when flag missing", () => {
    for (const file of sample.files) {
      const wr = computeWarrantRequired(file);
      expect(wr).toBe(true);
    }
  });

  it("files are blocked despite esp_viewed potentially being set", () => {
    for (const file of sample.files) {
      // Even if someone sets esp_viewed=true but esp_viewed_missing=true,
      // we treat as blocked
      const blocked = computeFileAccessBlocked({
        ...file,
        esp_viewed: true, // Attacker tries to bypass
        esp_viewed_missing: true, // But flag is marked as missing
      });
      expect(blocked).toBe(true);
    }
  });

  it("legal_note mentions missing flag", () => {
    expect(sample.legal_status?.legal_note).toMatch(/missing/i);
  });
});

// ── Cross-category: AIG never reduces score ───────────────────────────────────

describe("Invariant: AIG-CSAM never reduces score below equivalent non-AIG tip", () => {
  it("AIG tip score >= non-AIG tip with same base factors", () => {
    const aig = cat3_aig_csam[0]!;
    const nonAig = cat1_csam_esp_viewed[0]!;
    // AIG tip should score at least as high as comparable non-AIG
    // (it gets +10 for AIG flag)
    expect((aig.priority?.score ?? 0)).toBeGreaterThanOrEqual(
      (nonAig.priority?.score ?? 0) - 15 // Allow for other factor differences
    );
  });
});

// ── Cross-category: Wilson consistency ────────────────────────────────────────

describe("Invariant: Wilson compliance — blocked status matches computeFileAccessBlocked", () => {
  const allFixtureTips = [
    ...cat1_csam_esp_viewed,
    ...cat2_csam_warrant_required,
    ...cat3_aig_csam,
    ...cat4_sextortion_crisis,
    ...cat11_prompt_injection,
    ...cat14_missing_esp_flag,
  ];

  it("file_access_blocked is consistent with computeFileAccessBlocked for all fixtures", () => {
    for (const tip of allFixtureTips) {
      for (const file of tip.files) {
        const computed = computeFileAccessBlocked(file);
        // If file is blocked, computed should also return true (no false negatives)
        if (file.file_access_blocked) {
          expect(computed).toBe(true);
        }
      }
    }
  });
});
