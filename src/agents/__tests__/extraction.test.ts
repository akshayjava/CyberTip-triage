/**
 * Extraction Agent Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runExtractionAgent } from "../extraction.js";
import { getLLMProvider } from "../../llm/index.js";
import { appendAuditEntry } from "../../compliance/audit.js";
import { randomUUID } from "crypto";
import type { CyberTip, ExtractedEntities, Subject } from "../../models/index.js";

// Mock dependencies
vi.mock("../../llm/index.js", () => ({
  getLLMProvider: vi.fn(),
}));

vi.mock("../../compliance/audit.js", () => ({
  appendAuditEntry: vi.fn(),
}));

// Helper to create a valid CyberTip for testing
function makeTip(overrides: Partial<CyberTip> = {}): CyberTip {
  return {
    tip_id: randomUUID(),
    source: "NCMEC_IDS",
    received_at: new Date().toISOString(),
    raw_body: "Test tip body",
    normalized_body: "Test normalized tip body with minimal content.",
    jurisdiction_of_tip: {
      primary: "US_state",
      countries_involved: ["US"],
      interpol_referral_indicated: false,
      europol_referral_indicated: false,
    },
    reporter: { type: "NCMEC" },
    files: [],
    is_bundled: false,
    ncmec_urgent_flag: false,
    preservation_requests: [],
    status: "pending",
    audit_trail: [],
    ...overrides,
  } as CyberTip;
}

// Sample valid extraction output
const mockValidExtraction: ExtractedEntities = {
  subjects: [
    {
      subject_id: randomUUID(),
      name: "John Doe",
      accounts: [],
      known_tip_ids: [],
      raw_mentions: ["John Doe"],
    } as Subject,
  ],
  victims: [],
  ip_addresses: [],
  email_addresses: [],
  urls: [],
  domains: [],
  usernames: [],
  phone_numbers: [{ value: "+15551234567", raw_mention: "555-123-4567" }],
  device_identifiers: [],
  file_hashes: [],
  crypto_addresses: [],
  game_platform_ids: [],
  messaging_app_ids: [],
  dark_web_urls: [],
  geographic_indicators: [],
  venues: [],
  dates_mentioned: [],
  urgency_indicators: [],
  referenced_platforms: [],
  data_retention_notes: [],
  victim_crisis_indicators: [],
};

describe("Extraction Agent", () => {
  const mockRunAgent = vi.fn();
  const mockGetModelName = vi.fn().mockReturnValue("mock-model");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (getLLMProvider as any).mockReturnValue({
      runAgent: mockRunAgent,
      getModelName: mockGetModelName,
      providerName: "mock",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should extract entities successfully (Happy Path)", async () => {
    mockRunAgent.mockResolvedValue(JSON.stringify(mockValidExtraction));

    const tip = makeTip({ normalized_body: "Suspect John Doe call 555-123-4567" });
    const result = await runExtractionAgent(tip);

    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    expect(result.subjects).toHaveLength(1);
    expect(result.subjects[0].name).toBe("John Doe");
    expect(result.phone_numbers).toHaveLength(1);
    expect(result.phone_numbers[0].value).toBe("+15551234567"); // Normalized

    expect(appendAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      status: "success",
      agent: "ExtractionAgent",
    }));
  });

  it("should retry on failure and succeed", async () => {
    mockRunAgent
      .mockRejectedValueOnce(new Error("API Error"))
      .mockResolvedValueOnce(JSON.stringify(mockValidExtraction));

    const tip = makeTip();

    // Start the promise
    const promise = runExtractionAgent(tip);

    // Advance timers to bypass the retry delay
    await vi.advanceTimersByTimeAsync(3000); // 2000ms delay for 1st retry

    const result = await promise;

    expect(mockRunAgent).toHaveBeenCalledTimes(2);
    expect(result.subjects).toHaveLength(1);
    expect(appendAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      status: "success",
    }));
  });

  it("should fail gracefully after max retries", async () => {
    mockRunAgent.mockRejectedValue(new Error("API Error"));

    const tip = makeTip();

    const promise = runExtractionAgent(tip);

    // Advance timers for all retries
    // Retry 1: 2000ms
    // Retry 2: 4000ms
    // Total 6000ms+
    await vi.advanceTimersByTimeAsync(10000);

    const result = await promise;

    expect(mockRunAgent).toHaveBeenCalledTimes(3);
    // Should return empty entities
    expect(result.subjects).toHaveLength(0);
    expect(result.phone_numbers).toHaveLength(0);

    expect(appendAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      status: "agent_error",
      error_detail: "API Error",
    }));
  });

  it("should retry on schema validation failure", async () => {
    // First attempt returns invalid JSON (missing required fields)
    mockRunAgent
      .mockResolvedValueOnce(JSON.stringify({ invalid: "data" }))
      .mockResolvedValueOnce(JSON.stringify(mockValidExtraction));

    const tip = makeTip();

    const promise = runExtractionAgent(tip);

    await vi.advanceTimersByTimeAsync(3000);

    const result = await promise;

    expect(mockRunAgent).toHaveBeenCalledTimes(2);
    expect(result.subjects).toHaveLength(1);
  });

  it("should normalize phone numbers", async () => {
    const rawPhones = [
      { value: "555-123-4567", raw_mention: "555-123-4567" },
      { value: "1-555-987-6543", raw_mention: "1-555-987-6543" },
    ];
    const extractionWithPhones = { ...mockValidExtraction, phone_numbers: rawPhones };

    mockRunAgent.mockResolvedValue(JSON.stringify(extractionWithPhones));

    const tip = makeTip();
    const result = await runExtractionAgent(tip);

    expect(result.phone_numbers).toHaveLength(2);
    expect(result.phone_numbers[0].value).toBe("+15551234567");
    expect(result.phone_numbers[1].value).toBe("+15559876543");
  });

  it("should preserve subject IDs", async () => {
    const validSubject = {
        subject_id: "123e4567-e89b-12d3-a456-426614174000",
        name: "Jane Doe",
        accounts: [],
        known_tip_ids: [],
        raw_mentions: ["Jane Doe"],
    };
     const extractionWithId = {
      ...mockValidExtraction,
      subjects: [validSubject]
    };

    mockRunAgent.mockResolvedValue(JSON.stringify(extractionWithId));
    const tip = makeTip();
    const result = await runExtractionAgent(tip);

    expect(result.subjects[0].subject_id).toBe("123e4567-e89b-12d3-a456-426614174000");
  });
});
