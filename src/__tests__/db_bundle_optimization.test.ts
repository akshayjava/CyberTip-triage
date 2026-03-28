/**
 * DB Bundle Optimization Tests
 *
 * Verifies that the `listTips` function correctly filters by `is_bundled`.
 * This is a performance optimization to avoid fetching all tips when checking for duplicates.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { CyberTip } from "../models/index.js";

// Force in-memory mode for all tests
process.env["DB_MODE"] = "memory";

// Dynamic import after env set
const { upsertTip, listTips } = await import("../db/tips.js");

function makeTip(overrides: Partial<CyberTip> = {}): CyberTip {
  const tipId = randomUUID();
  return {
    tip_id:              tipId,
    source:              "NCMEC_IDS",
    received_at:         new Date().toISOString(),
    raw_body:            "Test tip content.",
    normalized_body:     "Test tip content.",
    status:              "triaged",
    is_bundled:          false,
    ncmec_urgent_flag:   false,
    files:               [],
    preservation_requests: [],
    audit_trail:         [],
    reporter:            { type: "ESP", esp_name: "Meta/Facebook" },
    jurisdiction_of_tip: {
      primary: "US_federal",
      countries_involved: ["US"],
      interpol_referral_indicated: false,
      europol_referral_indicated: false,
    },
    priority: {
      score:              72,
      tier:               "URGENT",
      scoring_factors:    [],
      routing_unit:       "ICAC Task Force",
      recommended_action: "Assign within 24 hours.",
      supervisor_alert:   false,
      victim_crisis_alert: false,
    },
    ...overrides,
  };
}

describe("listTips bundle optimization", () => {
  beforeEach(async () => {
    // Clear implicit state if possible, or just add new unique tips
    // Since memStore is module-level, we just add new tips and expect filtering to work

    // Add 2 bundled tips
    await upsertTip(makeTip({ is_bundled: true, status: "triaged" }));
    await upsertTip(makeTip({ is_bundled: true, status: "duplicate" }));

    // Add 2 non-bundled tips
    await upsertTip(makeTip({ is_bundled: false }));
    await upsertTip(makeTip({ is_bundled: false }));
  });

  it("returns only bundled tips when is_bundled=true", async () => {
    const { tips } = await listTips({ is_bundled: true });

    // Should have at least the 2 we added
    expect(tips.length).toBeGreaterThanOrEqual(2);

    for (const t of tips) {
      expect(t.is_bundled).toBe(true);
    }
  });

  it("returns only non-bundled tips when is_bundled=false", async () => {
    const { tips } = await listTips({ is_bundled: false });

    // Should have at least the 2 we added
    expect(tips.length).toBeGreaterThanOrEqual(2);

    for (const t of tips) {
      expect(t.is_bundled).toBe(false);
    }
  });
});
