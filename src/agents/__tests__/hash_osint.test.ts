import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runHashOsintAgent } from "../hash_osint.js";
import { appendAuditEntry } from "../../compliance/audit.js";
import { getLLMProvider } from "../../llm/index.js";
import { randomUUID } from "crypto";
import type { CyberTip, TipFile, HashMatchResults } from "../../models/index.js";

// Mock dependencies
vi.mock("../../compliance/audit.js", () => ({
  appendAuditEntry: vi.fn(),
}));

vi.mock("../../llm/index.js", () => ({
  getLLMProvider: vi.fn(),
}));

// Mock Data Builders
function makeFile(overrides: Partial<TipFile> = {}): TipFile {
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

function makeTip(overrides: Partial<CyberTip> = {}): CyberTip {
  return {
    tip_id: randomUUID(),
    source: "NCMEC_IDS",
    received_at: new Date().toISOString(),
    raw_body: "Test tip body",
    normalized_body: "Test normalized tip body",
    jurisdiction_of_tip: {
      primary: "US_state",
      countries_involved: ["US"],
      interpol_referral_indicated: false,
      europol_referral_indicated: false,
    },
    reporter: { type: "NCMEC" },
    files: [],
    extracted: {
      ip_addresses: [],
      email_addresses: [],
      phone_numbers: [],
      urls: [],
      usernames: [],
    },
    is_bundled: false,
    ncmec_urgent_flag: false,
    preservation_requests: [],
    status: "pending",
    audit_trail: [],
    ...overrides,
  };
}

const mockRunAgent = vi.fn();
const mockGetModelName = vi.fn().mockReturnValue("mock-model");

// Setup
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  (getLLMProvider as any).mockReturnValue({
    runAgent: mockRunAgent,
    getModelName: mockGetModelName,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Hash & OSINT Agent", () => {
  it("should return early with empty results if no hashes, IPs, or emails", async () => {
    const tip = makeTip();
    const result = await runHashOsintAgent(tip);

    expect(mockRunAgent).not.toHaveBeenCalled();
    expect(result.any_match).toBe(false);
    expect(result.per_file_results).toHaveLength(0);
    expect(appendAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining("No hashes or identifiers"),
        status: "success",
      })
    );
  });

  it("should process hashes and return matched results", async () => {
    const file1 = makeFile({ hash_md5: "md5hash1", file_id: "file1" });
    const tip = makeTip({ files: [file1] });

    const mockResponse: HashMatchResults = {
      any_match: true,
      match_sources: ["NCMEC"],
      known_series: "Test Series",
      victim_identified_previously: false,
      victim_country: null,
      aig_csam_detected: false,
      aig_detection_method: null,
      osint_findings: [],
      dark_web_indicators: [],
      per_file_results: [
        {
          file_id: "file1",
          ncmec_match: true,
          project_vic_match: false,
          iwf_match: false,
          interpol_icse_match: false,
          local_match: false,
          aig_suspected: false,
        },
      ],
    };

    mockRunAgent.mockResolvedValue(JSON.stringify(mockResponse));

    const result = await runHashOsintAgent(tip);

    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    expect(result.any_match).toBe(true);
    expect(result.per_file_results).toHaveLength(1);
    expect(result.per_file_results[0].file_id).toBe("file1");
    expect(result.per_file_results[0].ncmec_match).toBe(true);

    expect(appendAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        summary: expect.stringContaining("Hash check complete"),
      })
    );
  });

  it("should retry up to 3 times on failure", async () => {
    const file1 = makeFile({ hash_md5: "md5hash1" });
    const tip = makeTip({ files: [file1] });

    mockRunAgent
      .mockRejectedValueOnce(new Error("Fail 1"))
      .mockRejectedValueOnce(new Error("Fail 2"))
      .mockResolvedValue(
        JSON.stringify({
          any_match: false,
          match_sources: [],
          per_file_results: [],
          osint_findings: [],
          dark_web_indicators: [],
        })
      );

    const promise = runHashOsintAgent(tip);

    // Advance time to trigger retries
    // 1st retry: 2000ms
    // 2nd retry: 4000ms
    await vi.advanceTimersByTimeAsync(10000);

    await promise;
    expect(mockRunAgent).toHaveBeenCalledTimes(3);
  });

  it("should return empty results and log error after 3 failed attempts", async () => {
    const file1 = makeFile({ hash_md5: "md5hash1" });
    const tip = makeTip({ files: [file1] });

    mockRunAgent.mockRejectedValue(new Error("Persistent Failure"));

    const promise = runHashOsintAgent(tip);
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(mockRunAgent).toHaveBeenCalledTimes(3);
    expect(result.any_match).toBe(false);
    expect(appendAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "agent_error",
        summary: expect.stringContaining("failed after 3 attempts"),
      })
    );
  });

  it("should map per-file results even if agent returns incomplete list", async () => {
    const file1 = makeFile({ hash_md5: "md5hash1", file_id: "file1" });
    const file2 = makeFile({ hash_md5: "md5hash2", file_id: "file2" });
    const tip = makeTip({ files: [file1, file2] });

    const mockResponse = {
      any_match: true,
      match_sources: ["NCMEC"],
      per_file_results: [
        {
          file_id: "file1",
          ncmec_match: true,
        },
      ],
      osint_findings: [],
      dark_web_indicators: [],
    };

    mockRunAgent.mockResolvedValue(JSON.stringify(mockResponse));

    const result = await runHashOsintAgent(tip);

    expect(result.per_file_results).toHaveLength(2);
    const f1Result = result.per_file_results.find((r) => r.file_id === "file1");
    const f2Result = result.per_file_results.find((r) => r.file_id === "file2");

    expect(f1Result?.ncmec_match).toBe(true);
    expect(f2Result?.ncmec_match).toBe(false); // Default false for missing result
  });

  it("should handle JSON parsing errors by retrying", async () => {
    const file1 = makeFile({ hash_md5: "md5hash1" });
    const tip = makeTip({ files: [file1] });

    mockRunAgent
      .mockResolvedValueOnce("INVALID JSON")
      .mockResolvedValue(
        JSON.stringify({
            any_match: false,
            match_sources: [],
            per_file_results: [],
            osint_findings: [],
            dark_web_indicators: [],
        })
      );

    const promise = runHashOsintAgent(tip);
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    expect(mockRunAgent).toHaveBeenCalledTimes(2);
  });
});
