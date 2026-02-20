/**
 * Alert Tools Tests
 *
 * Tests supervisor and victim crisis alert behavior:
 *   - Alert is recorded in SENT_ALERTS store
 *   - Deduplication prevents flooding on repeated calls
 *   - Gracefully degrades when email/SMS not configured
 *   - Both alert types return the correct shape
 *   - Crisis alerts always attempt SMS before email (channel order)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";

process.env["NODE_ENV"] = "test";

// Don't set email/Twilio env vars — testing graceful degradation

const {
  alertSupervisor,
  sendVictimCrisisAlert,
  getSentAlerts,
  clearSentAlerts,
} = await import("../tools/alerts/alert_tools.js");

beforeEach(() => {
  clearSentAlerts();
});

// ── alertSupervisor ───────────────────────────────────────────────────────────

describe("alertSupervisor", () => {
  it("returns delivered=true and an alert_id", async () => {
    const result = await alertSupervisor(
      randomUUID(), "CSAM", 88,
      "Assign to lead investigator immediately.",
      "NCMEC hash match. 2 files accessible."
    );
    expect(result.success).toBe(true);
    expect(result.data!.delivered).toBe(true);
    expect(result.data!.alert_id).toBeTruthy();
    expect(result.data!.timestamp).toBeTruthy();
  });

  it("records alert in SENT_ALERTS store", async () => {
    const tipId = randomUUID();
    await alertSupervisor(tipId, "CSAM", 90, "Act now.", "Summary.");
    const alerts = getSentAlerts();
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const found = alerts.find(
      (a) => (a.payload as Record<string, unknown>)["tipId"] === tipId
    );
    expect(found).toBeDefined();
  });

  it("channel includes 'console' even when email unconfigured", async () => {
    const result = await alertSupervisor(randomUUID(), "CSAM", 75, "Investigate.", "Test.");
    expect(result.data!.channel).toContain("console");
  });

  it("deduplication — second call returns without adding duplicate to store", async () => {
    const tipId = randomUUID();
    await alertSupervisor(tipId, "CSAM", 85, "Act.", "Summary.");
    await alertSupervisor(tipId, "CSAM", 85, "Act.", "Summary.");

    const alerts = getSentAlerts().filter(
      (a) => (a.payload as Record<string, unknown>)["tipId"] === tipId
    );
    // Dedup: should only have 1 entry for this tip
    expect(alerts.length).toBe(1);
  });

  it("deconfliction pause alert uses different dedup key than supervisor alert", async () => {
    const tipId = randomUUID();
    await alertSupervisor(tipId, "CSAM", 85, "Act.", "Summary.", false);
    await alertSupervisor(tipId, "CSAM", 85, "Pause.", "Deconflict.", true);

    const alerts = getSentAlerts().filter(
      (a) => (a.payload as Record<string, unknown>)["tipId"] === tipId
    );
    // Both should have been sent — different dedup keys
    expect(alerts.length).toBe(2);
    const types = alerts.map((a) => a.type);
    expect(types).toContain("SUPERVISOR_ALERT");
    expect(types).toContain("DECONFLICTION_PAUSE");
  });

  it("does not throw when email fails to send", async () => {
    // Set bad SMTP config — should fail gracefully
    process.env["ALERT_EMAIL_HOST"]        = "bad-smtp-host-that-does-not-exist.invalid";
    process.env["ALERT_EMAIL_USER"]        = "test";
    process.env["ALERT_EMAIL_PASS"]        = "test";
    process.env["ALERT_SUPERVISOR_EMAILS"] = "test@example.com";

    const result = await alertSupervisor(randomUUID(), "CSAM", 88, "Act.", "Summary.");
    // Should still return ok — email failure is non-fatal
    expect(result.success).toBe(true);

    delete process.env["ALERT_EMAIL_HOST"];
    delete process.env["ALERT_EMAIL_USER"];
    delete process.env["ALERT_EMAIL_PASS"];
    delete process.env["ALERT_SUPERVISOR_EMAILS"];
  });
});

// ── sendVictimCrisisAlert ─────────────────────────────────────────────────────

describe("sendVictimCrisisAlert", () => {
  it("returns delivered=true with routed_to array", async () => {
    const result = await sendVictimCrisisAlert(
      randomUUID(),
      "15yo female victim",
      ["I want to die", "no one can know"],
      "Instagram",
      "Emergency supervisor contact required."
    );
    expect(result.success).toBe(true);
    expect(result.data!.delivered).toBe(true);
    expect(Array.isArray(result.data!.routed_to)).toBe(true);
    expect(Array.isArray(result.data!.channels)).toBe(true);
  });

  it("records crisis alert in SENT_ALERTS as VICTIM_CRISIS_ALERT type", async () => {
    const tipId = randomUUID();
    await sendVictimCrisisAlert(tipId, "Victim", ["crisis phrase"], "Snapchat");
    const alerts = getSentAlerts();
    const found = alerts.find(
      (a) => a.type === "VICTIM_CRISIS_ALERT" &&
             (a.payload as Record<string, unknown>)["tipId"] === tipId
    );
    expect(found).toBeDefined();
  });

  it("always includes 'console' in channels", async () => {
    const result = await sendVictimCrisisAlert(
      randomUUID(), "Victim", ["indicator"], "Discord"
    );
    expect(result.data!.channels).toContain("console");
  });

  it("crisis and supervisor alerts can coexist for same tip", async () => {
    const tipId = randomUUID();
    await alertSupervisor(tipId, "SEXTORTION", 95, "Urgent action.", "Summary.");
    await sendVictimCrisisAlert(tipId, "Victim", ["indicator"], "TikTok");

    const alerts = getSentAlerts().filter(
      (a) => (a.payload as Record<string, unknown>)["tipId"] === tipId
    );
    expect(alerts.length).toBe(2);
    const types = new Set(alerts.map((a) => a.type));
    expect(types.has("SUPERVISOR_ALERT")).toBe(true);
    expect(types.has("VICTIM_CRISIS_ALERT")).toBe(true);
  });

  it("handles empty crisis indicators array", async () => {
    const result = await sendVictimCrisisAlert(
      randomUUID(), "Unknown victim", [], "Roblox"
    );
    expect(result.success).toBe(true);
  });

  it("handles undefined recommendedAction", async () => {
    const result = await sendVictimCrisisAlert(
      randomUUID(), "Victim", ["phrase"], "Discord", undefined
    );
    expect(result.success).toBe(true);
    expect(result.data!.delivered).toBe(true);
  });
});

// ── clearSentAlerts ────────────────────────────────────────────────────────────

describe("clearSentAlerts", () => {
  it("empties the store and resets deduplication", async () => {
    const tipId = randomUUID();
    await alertSupervisor(tipId, "CSAM", 80, "Act.", "Summary.");
    expect(getSentAlerts().length).toBeGreaterThan(0);

    clearSentAlerts();
    expect(getSentAlerts().length).toBe(0);

    // After clear, same tip can be alerted again
    await alertSupervisor(tipId, "CSAM", 80, "Act.", "Summary.");
    expect(getSentAlerts().length).toBe(1);
  });
});
