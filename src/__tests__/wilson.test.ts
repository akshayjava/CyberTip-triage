import { describe, it, expect } from "vitest";
import {
  computeWarrantRequired,
  computeFileAccessBlocked,
  buildLegalNote,
  buildLegalStatus,
  getCircuitInfo,
  assertFileAccessible,
  WilsonBlockedError,
} from "../compliance/wilson.js";
import type { TipFile } from "../models/index.js";
import { randomUUID } from "crypto";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFile(overrides: Partial<TipFile>): TipFile {
  return {
    file_id: randomUUID(),
    media_type: "image",
    esp_viewed: false,
    esp_viewed_missing: false,
    publicly_available: false,
    warrant_required: false,
    warrant_status: "not_needed",
    file_access_blocked: false,
    ncmec_hash_match: false,
    project_vic_match: false,
    iwf_match: false,
    interpol_icse_match: false,
    aig_csam_suspected: false,
    ...overrides,
  };
}

// ── computeWarrantRequired ────────────────────────────────────────────────────

describe("computeWarrantRequired", () => {
  it("ESP viewed = true: no warrant required", () => {
    expect(
      computeWarrantRequired({
        esp_viewed: true,
        esp_viewed_missing: false,
        publicly_available: false,
      })
    ).toBe(false);
  });

  it("ESP viewed = false, not public: warrant required", () => {
    expect(
      computeWarrantRequired({
        esp_viewed: false,
        esp_viewed_missing: false,
        publicly_available: false,
      })
    ).toBe(true);
  });

  it("ESP viewed flag missing: treated as false (conservative) — warrant required", () => {
    expect(
      computeWarrantRequired({
        esp_viewed: false,
        esp_viewed_missing: true,
        publicly_available: false,
      })
    ).toBe(true);
  });

  it("ESP viewed = true but missing flag set: conservative — warrant required", () => {
    // If esp_viewed_missing=true, the flag is unreliable regardless of its value
    expect(
      computeWarrantRequired({
        esp_viewed: true,
        esp_viewed_missing: true,
        publicly_available: false,
      })
    ).toBe(true);
  });

  it("ESP viewed = false, publicly available: still conservative — warrant required", () => {
    // Publicly available files are borderline; we default conservative
    expect(
      computeWarrantRequired({
        esp_viewed: false,
        esp_viewed_missing: false,
        publicly_available: true,
      })
    ).toBe(true);
  });
});

// ── computeFileAccessBlocked ──────────────────────────────────────────────────

describe("computeFileAccessBlocked", () => {
  it("ESP viewed = true: not blocked", () => {
    expect(
      computeFileAccessBlocked({
        esp_viewed: true,
        esp_viewed_missing: false,
        publicly_available: false,
        warrant_status: "not_needed",
      })
    ).toBe(false);
  });

  it("Warrant required, no warrant: blocked", () => {
    expect(
      computeFileAccessBlocked({
        esp_viewed: false,
        esp_viewed_missing: false,
        publicly_available: false,
        warrant_status: "pending_application",
      })
    ).toBe(true);
  });

  it("Warrant required, warrant applied but not granted: still blocked", () => {
    expect(
      computeFileAccessBlocked({
        esp_viewed: false,
        esp_viewed_missing: false,
        publicly_available: false,
        warrant_status: "applied",
      })
    ).toBe(true);
  });

  it("Warrant required, warrant granted: unblocked", () => {
    expect(
      computeFileAccessBlocked({
        esp_viewed: false,
        esp_viewed_missing: false,
        publicly_available: false,
        warrant_status: "granted",
      })
    ).toBe(false);
  });

  it("Warrant required, warrant denied: still blocked", () => {
    expect(
      computeFileAccessBlocked({
        esp_viewed: false,
        esp_viewed_missing: false,
        publicly_available: false,
        warrant_status: "denied",
      })
    ).toBe(true);
  });
});

// ── assertFileAccessible ──────────────────────────────────────────────────────

describe("assertFileAccessible", () => {
  it("Accessible file: does not throw", () => {
    const file = makeFile({ file_access_blocked: false, warrant_required: false });
    expect(() => assertFileAccessible(file)).not.toThrow();
  });

  it("Blocked file: throws WilsonBlockedError", () => {
    const file = makeFile({
      file_access_blocked: true,
      warrant_required: true,
      warrant_status: "pending_application",
    });
    expect(() => assertFileAccessible(file)).toThrow(WilsonBlockedError);
  });

  it("WilsonBlockedError contains file_id", () => {
    const file = makeFile({
      file_id: "aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb",
      file_access_blocked: true,
      warrant_required: true,
      warrant_status: "pending_application",
    });
    try {
      assertFileAccessible(file);
    } catch (err) {
      expect(err).toBeInstanceOf(WilsonBlockedError);
      expect((err as WilsonBlockedError).file_id).toBe(file.file_id);
    }
  });
});

// ── getCircuitInfo ────────────────────────────────────────────────────────────

describe("getCircuitInfo", () => {
  it("California = 9th Circuit, binding", () => {
    const info = getCircuitInfo("CA");
    expect(info.name).toBe("9th Circuit");
    expect(info.binding).toBe(true);
  });

  it("Washington state = 9th Circuit, binding", () => {
    expect(getCircuitInfo("WA").binding).toBe(true);
  });

  it("Unknown state = not binding, recommends attorney consult", () => {
    const info = getCircuitInfo("TX");
    expect(info.binding).toBe(false);
    expect(info.note).toContain("US Attorney");
  });
});

// ── buildLegalNote ────────────────────────────────────────────────────────────

describe("buildLegalNote", () => {
  it("All files accessible: note mentions accessible count", () => {
    const files = [
      makeFile({ esp_viewed: true, file_access_blocked: false, warrant_required: false }),
      makeFile({ esp_viewed: true, file_access_blocked: false, warrant_required: false }),
    ];
    const note = buildLegalNote(files, "CA");
    expect(note).toContain("2 file(s) are accessible");
  });

  it("Mixed files: mentions both accessible and blocked", () => {
    const files = [
      makeFile({ esp_viewed: true, file_access_blocked: false, warrant_required: false }),
      makeFile({
        esp_viewed: false,
        file_access_blocked: true,
        warrant_required: true,
        warrant_status: "pending_application",
      }),
    ];
    const note = buildLegalNote(files, "CA");
    expect(note).toContain("1 file(s) are accessible");
    expect(note).toContain("1 file(s) are BLOCKED");
    expect(note).toContain("Wilson");
  });

  it("Denied warrant: mentions denial", () => {
    const files = [
      makeFile({
        file_access_blocked: true,
        warrant_required: true,
        warrant_status: "denied",
      }),
    ];
    const note = buildLegalNote(files);
    expect(note).toContain("DENIED");
  });
});

// ── buildLegalStatus ──────────────────────────────────────────────────────────

describe("buildLegalStatus", () => {
  it("All warrants granted: all_warrants_resolved = true", () => {
    const files = [
      makeFile({
        warrant_required: true,
        warrant_status: "granted",
        file_access_blocked: false,
      }),
    ];
    const status = buildLegalStatus(files, "CA");
    expect(status.all_warrants_resolved).toBe(true);
    expect(status.any_files_accessible).toBe(true);
  });

  it("Pending warrant: all_warrants_resolved = false", () => {
    const files = [
      makeFile({
        warrant_required: true,
        warrant_status: "pending_application",
        file_access_blocked: true,
      }),
    ];
    const status = buildLegalStatus(files, "WA");
    expect(status.all_warrants_resolved).toBe(false);
    expect(status.any_files_accessible).toBe(false);
    expect(status.files_requiring_warrant).toHaveLength(1);
  });

  it("No warrants needed: any_files_accessible = true", () => {
    const files = [
      makeFile({
        esp_viewed: true,
        warrant_required: false,
        file_access_blocked: false,
      }),
    ];
    const status = buildLegalStatus(files);
    expect(status.files_requiring_warrant).toHaveLength(0);
    expect(status.any_files_accessible).toBe(true);
    expect(status.all_warrants_resolved).toBe(true);
  });

  it("9th Circuit noted when CA jurisdiction", () => {
    const status = buildLegalStatus([], "CA");
    expect(status.relevant_circuit).toBe("9th Circuit");
  });

  it("exigent_circumstances_claimed defaults to false", () => {
    const status = buildLegalStatus([]);
    expect(status.exigent_circumstances_claimed).toBe(false);
  });
});
