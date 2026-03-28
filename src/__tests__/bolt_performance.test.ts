
import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import type { CyberTip, TipFile } from "../models/index.js";

// Force in-memory mode for all tests
process.env["DB_MODE"] = "memory";

const { upsertTip, getTipStats } = await import("../db/tips.js");

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

describe("getTipStats Performance", () => {
  it("returns correct tier counts", async () => {
    await upsertTip(makeTip({ priority: { score: 90, tier: "IMMEDIATE", scoring_factors: [], routing_unit: "", recommended_action: "", supervisor_alert: true, victim_crisis_alert: true } }));
    await upsertTip(makeTip({ priority: { score: 70, tier: "URGENT",    scoring_factors: [], routing_unit: "", recommended_action: "", supervisor_alert: false, victim_crisis_alert: false } }));

    const stats = await getTipStats();
    expect(stats.by_tier["IMMEDIATE"]).toBeGreaterThanOrEqual(1);
    expect(stats.by_tier["URGENT"]).toBeGreaterThanOrEqual(1);
    expect(stats.total).toBeGreaterThanOrEqual(2);
  });

  it("crisis_alerts count matches tips with victim_crisis_alert=true", async () => {
    await upsertTip(makeTip({
      priority: { score: 97, tier: "IMMEDIATE", scoring_factors: [], routing_unit: "Supervisor", recommended_action: "", supervisor_alert: true, victim_crisis_alert: true },
    }));
    const stats = await getTipStats();
    expect(stats.crisis_alerts).toBeGreaterThanOrEqual(1);
  });

  it("blocked count matches BLOCKED status tips", async () => {
    await upsertTip(makeTip({ status: "BLOCKED" }));
    const stats = await getTipStats();
    expect(stats.blocked).toBeGreaterThanOrEqual(1);
  });

  it("processes large number of tips efficiently", async () => {
    // Benchmark test
    const COUNT = 10000;
    const tips: CyberTip[] = [];
    for (let i = 0; i < COUNT; i++) {
        const tier = ["IMMEDIATE", "URGENT", "STANDARD", "MONITOR", "PAUSED"][i % 5];
        const crisis = i % 10 === 0; // 10% crisis
        const blocked = i % 20 === 0; // 5% blocked

        tips.push(makeTip({
            status: blocked ? "BLOCKED" : "triaged",
            priority: {
                score: 50,
                tier: tier,
                scoring_factors: [],
                routing_unit: "Test",
                recommended_action: "Test",
                supervisor_alert: false,
                victim_crisis_alert: crisis
            }
        }));
    }

    // Batch load tips (bypass upsertTip for speed in test setup)
    // We can't access memStore directly but we can use upsertTip concurrently?
    // Actually, let's just use upsertTip in parallel promises
    await Promise.all(tips.map(t => upsertTip(t)));

    const start = performance.now();
    const stats = await getTipStats();
    const end = performance.now();

    console.log(`[BENCHMARK] getTipStats with ${COUNT} tips: ${(end - start).toFixed(2)}ms`);

    expect(stats.total).toBeGreaterThanOrEqual(COUNT);
    // Rough check
    expect(stats.by_tier["IMMEDIATE"]).toBeGreaterThanOrEqual(COUNT / 5);
  }, 30000); // 30s timeout
});
