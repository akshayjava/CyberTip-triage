/**
 * DB Repository Tests
 *
 * Tests the tip repository (src/db/tips.ts) against the in-memory backend.
 * All operations that need to work identically in Postgres are tested here
 * so regressions surface before a live DB is required.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { CyberTip, TipFile } from "../models/index.js";

// Force in-memory mode for all tests
process.env["DB_MODE"] = "memory";

// Dynamic import after env set
const { upsertTip, getTipById, listTips, updateFileWarrant, issuePreservationRequest, getTipStats } =
  await import("../db/tips.js");

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeFile(overrides: Partial<TipFile> = {}): TipFile {
  return {
    file_id:              randomUUID(),
    media_type:           "image",
    esp_viewed:           true,
    esp_viewed_missing:   false,
    publicly_available:   false,
    warrant_required:     false,
    warrant_status:       "not_needed",
    file_access_blocked:  false,
    ncmec_hash_match:     false,
    project_vic_match:    false,
    iwf_match:            false,
    interpol_icse_match:  false,
    aig_csam_suspected:   false,
    ...overrides,
  };
}

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
    files:               [makeFile()],
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

// ── upsertTip ─────────────────────────────────────────────────────────────────

describe("upsertTip + getTipById", () => {
  it("persists and retrieves a tip by ID", async () => {
    const tip = makeTip();
    await upsertTip(tip);
    const retrieved = await getTipById(tip.tip_id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.tip_id).toBe(tip.tip_id);
  });

  it("returns null for unknown tip ID", async () => {
    const result = await getTipById(randomUUID());
    expect(result).toBeNull();
  });

  it("upsert is idempotent — second write updates, doesn't duplicate", async () => {
    const tip = makeTip();
    await upsertTip(tip);
    await upsertTip({ ...tip, status: "assigned" });
    const retrieved = await getTipById(tip.tip_id);
    expect(retrieved!.status).toBe("assigned");
  });

  it("preserves all files after upsert", async () => {
    const files = [makeFile(), makeFile(), makeFile()];
    const tip   = makeTip({ files });
    await upsertTip(tip);
    const retrieved = await getTipById(tip.tip_id);
    expect(retrieved!.files).toHaveLength(3);
  });

  it("updates files on re-upsert", async () => {
    const file = makeFile({ esp_viewed: true, warrant_status: "not_needed" });
    const tip  = makeTip({ files: [file] });
    await upsertTip(tip);

    const updatedFile = { ...file, warrant_status: "granted" as const, file_access_blocked: false };
    await upsertTip({ ...tip, files: [updatedFile] });

    const retrieved = await getTipById(tip.tip_id);
    expect(retrieved!.files[0]!.warrant_status).toBe("granted");
  });

  it("stores JSONB fields (priority, classification) intact", async () => {
    const tip = makeTip({
      classification: {
        offense_category:             "CSAM",
        secondary_categories:         [],
        aig_csam_flag:                false,
        sextortion_victim_in_crisis:  false,
        e2ee_data_gap:                false,
        severity:                     { us_icac: "P1_CRITICAL" },
        jurisdiction:                 {
          primary: "US_federal",
          countries_involved: ["US"],
          interpol_referral_indicated: false,
          europol_referral_indicated:  false,
        },
        mlat_likely_required:  false,
        applicable_statutes:   ["18 U.S.C. § 2252A"],
        confidence:            0.91,
        reasoning:             "Hash match confirmed.",
      },
    });

    await upsertTip(tip);
    const r = await getTipById(tip.tip_id);
    expect(r!.classification!.offense_category).toBe("CSAM");
    expect(r!.classification!.severity.us_icac).toBe("P1_CRITICAL");
  });
});

// ── listTips ──────────────────────────────────────────────────────────────────

describe("listTips", () => {
  beforeEach(async () => {
    // Seed a variety of tips — use distinct tip IDs each run
    await upsertTip(makeTip({ priority: { score: 95, tier: "IMMEDIATE", scoring_factors: [], routing_unit: "Supervisor", recommended_action: "", supervisor_alert: true, victim_crisis_alert: true } }));
    await upsertTip(makeTip({ priority: { score: 75, tier: "URGENT",    scoring_factors: [], routing_unit: "ICAC Task Force", recommended_action: "", supervisor_alert: false, victim_crisis_alert: false } }));
    await upsertTip(makeTip({ priority: { score: 45, tier: "STANDARD",  scoring_factors: [], routing_unit: "ICAC Task Force", recommended_action: "", supervisor_alert: false, victim_crisis_alert: false } }));
    await upsertTip(makeTip({ status: "BLOCKED" }));
  });

  it("returns all tips", async () => {
    const { tips, total } = await listTips();
    expect(tips.length).toBeGreaterThanOrEqual(4);
    expect(total).toBeGreaterThanOrEqual(4);
  });

  it("filters by tier", async () => {
    const { tips } = await listTips({ tier: "IMMEDIATE" });
    expect(tips.length).toBeGreaterThanOrEqual(1);
    for (const t of tips) expect(t.priority?.tier).toBe("IMMEDIATE");
  });

  it("IMMEDIATE tips come before URGENT in unfiltered list", async () => {
    const { tips } = await listTips();
    const tiers = tips.map((t) => t.priority?.tier).filter(Boolean);
    const immediateIdx = tiers.findIndex((t) => t === "IMMEDIATE");
    const urgentIdx    = tiers.findIndex((t) => t === "URGENT");
    if (immediateIdx !== -1 && urgentIdx !== -1) {
      expect(immediateIdx).toBeLessThan(urgentIdx);
    }
  });

  it("pagination works — limit and offset", async () => {
    const page1 = await listTips({ limit: 2, offset: 0 });
    const page2 = await listTips({ limit: 2, offset: 2 });
    const ids1  = page1.tips.map((t) => t.tip_id);
    const ids2  = page2.tips.map((t) => t.tip_id);
    // No overlap between pages
    expect(ids1.filter((id) => ids2.includes(id))).toHaveLength(0);
  });

  it("crisis_only filter returns only crisis tips", async () => {
    const { tips } = await listTips({ crisis_only: true });
    for (const t of tips) {
      expect(t.priority?.victim_crisis_alert).toBe(true);
    }
  });

  it("total reflects unfiltered count, not page size", async () => {
    const { total } = await listTips({ limit: 1 });
    expect(total).toBeGreaterThanOrEqual(4);
  });
});

// ── updateFileWarrant ─────────────────────────────────────────────────────────

describe("updateFileWarrant", () => {
  it("updates warrant_status and unblocks file on 'granted'", async () => {
    const file = makeFile({ warrant_required: true, warrant_status: "applied", file_access_blocked: true });
    const tip  = makeTip({ files: [file] });
    await upsertTip(tip);

    const updated = await updateFileWarrant(tip.tip_id, file.file_id, "granted", "WA-2024-001", "Judge Smith");
    expect(updated).not.toBeNull();
    expect(updated!.warrant_status).toBe("granted");
    expect(updated!.file_access_blocked).toBe(false);
    expect(updated!.warrant_number).toBe("WA-2024-001");
  });

  it("keeps file blocked when warrant is denied", async () => {
    const file = makeFile({ warrant_required: true, warrant_status: "applied", file_access_blocked: true });
    const tip  = makeTip({ files: [file] });
    await upsertTip(tip);

    const updated = await updateFileWarrant(tip.tip_id, file.file_id, "denied");
    expect(updated!.file_access_blocked).toBe(true);
    expect(updated!.warrant_status).toBe("denied");
  });

  it("returns null for unknown file ID", async () => {
    const tip = makeTip();
    await upsertTip(tip);
    const result = await updateFileWarrant(tip.tip_id, randomUUID(), "granted");
    expect(result).toBeNull();
  });

  it("returns null for unknown tip ID", async () => {
    const result = await updateFileWarrant(randomUUID(), randomUUID(), "granted");
    expect(result).toBeNull();
  });
});

// ── issuePreservationRequest ──────────────────────────────────────────────────

describe("issuePreservationRequest", () => {
  it("marks a preservation request as issued", async () => {
    const requestId = randomUUID();
    const tip = makeTip({
      preservation_requests: [{
        request_id:                requestId,
        esp_name:                  "Meta/Facebook",
        account_identifiers:       ["user@example.com"],
        legal_basis:               "18 U.S.C. § 2703(f)",
        jurisdiction:              "US",
        status:                    "draft",
        auto_generated:            true,
        esp_retention_window_days: 365,
      }],
    });
    await upsertTip(tip);

    const ok = await issuePreservationRequest(requestId, "Det. Jones");
    expect(ok).toBe(true);
  });

  it("returns false for unknown request ID", async () => {
    const ok = await issuePreservationRequest(randomUUID());
    expect(ok).toBe(false);
  });
});

// ── getTipStats ───────────────────────────────────────────────────────────────

describe("getTipStats", () => {
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
});
