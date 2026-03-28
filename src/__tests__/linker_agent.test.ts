import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runLinkerAgent } from "../agents/linker.js";
import { getLLMProvider } from "../llm/index.js";
import { appendAuditEntry } from "../compliance/audit.js";
import { CyberTip } from "../models/tip.js";
import { TipLinks } from "../models/links.js";
import { randomUUID } from "crypto";

// Mock dependencies
vi.mock("../llm/index.js", () => ({
  getLLMProvider: vi.fn(),
}));

vi.mock("../compliance/audit.js", () => ({
  appendAuditEntry: vi.fn(),
}));

// Helper to create a mock tip
function makeTip(overrides: Partial<CyberTip> = {}): CyberTip {
  return {
    tip_id: randomUUID(),
    source: "NCMEC_IDS",
    received_at: new Date().toISOString(),
    raw_body: "test body",
    normalized_body: "test body normalized",
    jurisdiction_of_tip: {
      primary: "US_federal",
      countries_involved: ["US"],
      interpol_referral_indicated: false,
      europol_referral_indicated: false,
    },
    reporter: { type: "ESP", esp_name: "Test" },
    files: [],
    is_bundled: false,
    ncmec_urgent_flag: false,
    preservation_requests: [],
    status: "triaged",
    audit_trail: [],
    extracted: {
      subjects: [{ name: "John Doe", accounts: [] }],
      ip_addresses: [],
      email_addresses: [],
      usernames: [],
      file_hashes: [],
      victims: [],
      urls: [],
      domains: [],
      phone_numbers: [],
      device_identifiers: [],
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
    },
    ...overrides,
  } as CyberTip;
}

describe("Linker Agent", () => {
  const mockRunAgent = vi.fn();
  const mockGetModelName = vi.fn().mockReturnValue("mock-model");

  beforeEach(() => {
    vi.resetAllMocks();
    (getLLMProvider as any).mockReturnValue({
      runAgent: mockRunAgent,
      getModelName: mockGetModelName,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should successfully link a tip and return TipLinks", async () => {
    const mockLinks: TipLinks = {
      related_tip_ids: [randomUUID()],
      matching_subject_ids: [randomUUID()],
      open_case_numbers: ["CASE-123"],
      deconfliction_matches: [],
      cluster_flags: [],
      mlat_required: false,
      link_confidence: 0.9,
      link_reasoning: "Test reasoning",
    };

    mockRunAgent.mockResolvedValueOnce(JSON.stringify(mockLinks));

    const tip = makeTip();
    const result = await runLinkerAgent(tip);

    expect(result).toEqual(mockLinks);
    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    expect(appendAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      status: "success",
      agent: "LinkerAgent",
    }));
  });

  it("should handle JSON wrapped in markdown code blocks", async () => {
    const mockLinks: TipLinks = {
      related_tip_ids: [],
      matching_subject_ids: [],
      open_case_numbers: [],
      deconfliction_matches: [],
      cluster_flags: [],
      mlat_required: false,
      link_confidence: 0.8,
      link_reasoning: "Reasoning",
    };

    const response = "```json\n" + JSON.stringify(mockLinks) + "\n```";
    mockRunAgent.mockResolvedValueOnce(response);

    const tip = makeTip();
    const result = await runLinkerAgent(tip);

    expect(result).toEqual(mockLinks);
  });

  it("should retry on error and eventually succeed", async () => {
    const mockLinks: TipLinks = {
      related_tip_ids: [],
      matching_subject_ids: [],
      open_case_numbers: [],
      deconfliction_matches: [],
      cluster_flags: [],
      mlat_required: false,
      link_confidence: 0.8,
      link_reasoning: "Reasoning",
    };

    mockRunAgent
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(JSON.stringify(mockLinks));

    const tip = makeTip();

    // Start the promise but don't await yet
    const promise = runLinkerAgent(tip);

    // Fast-forward timers to skip the retry delay
    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result).toEqual(mockLinks);
    expect(mockRunAgent).toHaveBeenCalledTimes(2);
  });

  it("should return empty links and log error after max retries", async () => {
    mockRunAgent.mockRejectedValue(new Error("Persistent error"));

    const tip = makeTip();
    const promise = runLinkerAgent(tip);

    // Fast forward all retries
    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result.link_reasoning).toContain("Linker agent error");
    expect(mockRunAgent).toHaveBeenCalledTimes(3);
    expect(appendAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      status: "agent_error",
      agent: "LinkerAgent",
    }));
  });

  it("should flag deconfliction matches in audit log", async () => {
    const mockLinks: TipLinks = {
      related_tip_ids: [],
      matching_subject_ids: [],
      open_case_numbers: [],
      deconfliction_matches: [{
        agency_name: "FBI",
        case_number: "123",
        overlap_type: "same_subject",
        coordination_recommended: true,
        active_investigation: true,
        contact_investigator: "Agent Smith"
      }],
      cluster_flags: [],
      mlat_required: false,
      link_confidence: 0.9,
      link_reasoning: "Conflict found",
    };

    mockRunAgent.mockResolvedValueOnce(JSON.stringify(mockLinks));

    const tip = makeTip();
    await runLinkerAgent(tip);

    expect(appendAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.stringContaining("ACTIVE CONFLICT FOUND"),
    }));
  });
});
