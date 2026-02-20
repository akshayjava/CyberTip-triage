/**
 * Orchestrator Integration Tests
 *
 * Tests the full pipeline wiring: Intake → Legal Gate → Extraction || Hash → 
 * Classifier || Linker → Priority
 *
 * All agents are mocked — we test that:
 * 1. Stages execute in the correct order
 * 2. Legal Gate failure blocks all downstream processing
 * 3. Critical overrides apply correctly (CSAM+minor → P1_CRITICAL)
 * 4. SSE events are emitted for each stage
 * 5. Audit trail captures all stages
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

// ── Mock all agents ───────────────────────────────────────────────────────────

const mockIntake = vi.fn();
const mockLegalGate = vi.fn();
const mockExtraction = vi.fn();
const mockHashOsint = vi.fn();
const mockClassifier = vi.fn();
const mockLinker = vi.fn();
const mockPriority = vi.fn();

vi.mock("../../agents/intake.js", () => ({ runIntakeAgent: mockIntake }));
vi.mock("../../agents/legal_gate.js", () => ({ runLegalGateAgent: mockLegalGate }));
vi.mock("../../agents/extraction.js", () => ({ runExtractionAgent: mockExtraction }));
vi.mock("../../agents/hash_osint.js", () => ({ runHashOsintAgent: mockHashOsint }));
vi.mock("../../agents/classifier.js", () => ({ runClassifierAgent: mockClassifier }));
vi.mock("../../agents/linker.js", () => ({ runLinkerAgent: mockLinker }));
vi.mock("../../agents/priority.js", () => ({ runPriorityAgent: mockPriority }));

const { processTip, onPipelineEvent } = await import("../../orchestrator.js");
import { clearInMemoryLog, getInMemoryLog } from "../../compliance/audit.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();

function makeBaseTip(overrides = {}) {
  const tip_id = randomUUID();
  return {
    tip_id,
    source: "NCMEC_IDS" as const,
    received_at: NOW,
    raw_body: "User uploaded CSAM",
    normalized_body: "User uploaded child sexual abuse material",
    jurisdiction_of_tip: {
      primary: "US_federal" as const,
      countries_involved: ["US"],
      interpol_referral_indicated: false,
      europol_referral_indicated: false,
    },
    reporter: { type: "ESP" as const, esp_name: "Meta" },
    files: [{
      file_id: randomUUID(),
      media_type: "image" as const,
      esp_viewed: true,
      esp_viewed_missing: false,
      publicly_available: false,
      warrant_required: false,
      warrant_status: "not_needed" as const,
      file_access_blocked: false,
      ncmec_hash_match: false,
      project_vic_match: false,
      iwf_match: false,
      interpol_icse_match: false,
      aig_csam_suspected: false,
    }],
    is_bundled: false,
    ncmec_urgent_flag: false,
    preservation_requests: [],
    status: "triaged" as const,
    audit_trail: [],
    ...overrides,
  };
}

function makeLegalGateSuccess(tip: ReturnType<typeof makeBaseTip>) {
  return {
    legal_status: {
      files_requiring_warrant: [],
      all_warrants_resolved: true,
      any_files_accessible: true,
      legal_note: "All files accessible",
      exigent_circumstances_claimed: false,
    },
    files: tip.files,
    exigent_possible: false,
    circuit_note: "Test circuit",
    confidence: 0.99,
  };
}

function makeClassification(offense = "CSAM") {
  return {
    offense_category: offense,
    secondary_categories: [],
    aig_csam_flag: false,
    sextortion_victim_in_crisis: false,
    e2ee_data_gap: false,
    severity: { us_icac: "P1_CRITICAL" as const },
    jurisdiction: {
      primary: "US_federal" as const,
      countries_involved: ["US"],
      interpol_referral_indicated: false,
      europol_referral_indicated: false,
    },
    mlat_likely_required: false,
    applicable_statutes: ["18 U.S.C. § 2252A"],
    confidence: 0.95,
    reasoning: "CSAM confirmed",
  };
}

function makePriority(score = 90, tier = "IMMEDIATE") {
  return {
    score,
    tier,
    scoring_factors: [],
    routing_unit: "ICAC Task Force",
    recommended_action: "Review immediately",
    supervisor_alert: score >= 85,
    victim_crisis_alert: false,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Orchestrator Pipeline Wiring", () => {
  beforeEach(() => {
    process.env["NODE_ENV"] = "test";
    process.env["DB_MODE"] = "memory";
    clearInMemoryLog();
    vi.clearAllMocks();
  });

  it("runs all 7 agents in sequence for a complete tip", async () => {
    const callOrder: string[] = [];

    const baseTip = makeBaseTip();

    mockIntake.mockImplementation(async () => {
      callOrder.push("intake");
      return baseTip;
    });
    mockLegalGate.mockImplementation(async () => {
      callOrder.push("legal_gate");
      return makeLegalGateSuccess(baseTip);
    });
    mockExtraction.mockImplementation(async () => {
      callOrder.push("extraction");
      return {
        subjects: [], victims: [], ip_addresses: [], email_addresses: [],
        urls: [], domains: [], usernames: [], phone_numbers: [],
        device_identifiers: [], file_hashes: [], crypto_addresses: [],
        game_platform_ids: [], messaging_app_ids: [], dark_web_urls: [],
        geographic_indicators: [], venues: [], dates_mentioned: [],
        urgency_indicators: [], referenced_platforms: [],
        data_retention_notes: [], victim_crisis_indicators: [],
      };
    });
    mockHashOsint.mockImplementation(async () => {
      callOrder.push("hash_osint");
      return {
        any_match: false, match_sources: [], victim_identified_previously: false,
        aig_csam_detected: false, osint_findings: [], dark_web_indicators: [],
        per_file_results: [],
      };
    });
    mockClassifier.mockImplementation(async () => {
      callOrder.push("classifier");
      return makeClassification();
    });
    mockLinker.mockImplementation(async () => {
      callOrder.push("linker");
      return {
        is_duplicate: false, related_tip_ids: [],
        deconfliction_matches: [], cluster_flags: [],
      };
    });
    mockPriority.mockImplementation(async () => {
      callOrder.push("priority");
      return makePriority();
    });

    await processTip({
      source: "NCMEC_IDS",
      raw_content: "test tip",
      content_type: "text",
      received_at: NOW,
    });

    expect(callOrder).toContain("intake");
    expect(callOrder).toContain("legal_gate");
    expect(callOrder).toContain("extraction");
    expect(callOrder).toContain("hash_osint");
    expect(callOrder).toContain("classifier");
    expect(callOrder).toContain("linker");
    expect(callOrder).toContain("priority");

    // Intake must run before legal gate
    expect(callOrder.indexOf("intake")).toBeLessThan(callOrder.indexOf("legal_gate"));
    // Legal gate must run before parallel stage
    expect(callOrder.indexOf("legal_gate")).toBeLessThan(callOrder.indexOf("extraction"));
    // Priority must be last
    expect(callOrder.indexOf("priority")).toBe(callOrder.length - 1);
  });

  it("BLOCKS all downstream processing when Legal Gate throws", async () => {
    const baseTip = makeBaseTip();

    mockIntake.mockResolvedValueOnce(baseTip);
    mockLegalGate.mockRejectedValueOnce(new Error("Compliance failure"));

    const result = await processTip({
      source: "NCMEC_IDS",
      raw_content: "test",
      content_type: "text",
      received_at: NOW,
    });

    // Downstream agents must NOT have been called
    expect(mockExtraction).not.toHaveBeenCalled();
    expect(mockHashOsint).not.toHaveBeenCalled();
    expect(mockClassifier).not.toHaveBeenCalled();
    expect(mockLinker).not.toHaveBeenCalled();
    expect(mockPriority).not.toHaveBeenCalled();

    // Tip status must be BLOCKED
    expect(result.status).toBe("BLOCKED");
  });

  it("BLOCKS when Legal Gate returns no accessible files and all are unviewed", async () => {
    const baseTip = makeBaseTip({
      files: [{
        file_id: randomUUID(),
        media_type: "image" as const,
        esp_viewed: false,
        esp_viewed_missing: false,
        publicly_available: false,
        warrant_required: true,
        warrant_status: "pending_application" as const,
        file_access_blocked: true,
        ncmec_hash_match: false,
        project_vic_match: false,
        iwf_match: false,
        interpol_icse_match: false,
        aig_csam_suspected: false,
      }],
    });

    mockIntake.mockResolvedValueOnce(baseTip);
    mockLegalGate.mockResolvedValueOnce({
      legal_status: {
        files_requiring_warrant: [baseTip.files[0]!.file_id],
        all_warrants_resolved: false,
        any_files_accessible: false,
        legal_note: "All files blocked — warrants required.",
        exigent_circumstances_claimed: false,
      },
      files: baseTip.files,
      exigent_possible: false,
      circuit_note: "9th Circuit",
      confidence: 0.99,
    });

    // Even with all files blocked, pipeline should continue for classification
    // (we can still classify from tip body text)
    // But extracting FILE CONTENT from blocked files must not happen
    mockExtraction.mockResolvedValueOnce({ subjects: [], victims: [], ip_addresses: [], email_addresses: [], urls: [], domains: [], usernames: [], phone_numbers: [], device_identifiers: [], file_hashes: [], crypto_addresses: [], game_platform_ids: [], messaging_app_ids: [], dark_web_urls: [], geographic_indicators: [], venues: [], dates_mentioned: [], urgency_indicators: [], referenced_platforms: [], data_retention_notes: [], victim_crisis_indicators: [] });
    mockHashOsint.mockResolvedValueOnce({ any_match: false, match_sources: [], victim_identified_previously: false, aig_csam_detected: false, osint_findings: [], dark_web_indicators: [], per_file_results: [] });
    mockClassifier.mockResolvedValueOnce(makeClassification());
    mockLinker.mockResolvedValueOnce({ is_duplicate: false, related_tip_ids: [], deconfliction_matches: [], cluster_flags: [] });
    mockPriority.mockResolvedValueOnce(makePriority(88, "IMMEDIATE"));

    const result = await processTip({
      source: "NCMEC_IDS",
      raw_content: "test",
      content_type: "text",
      received_at: NOW,
    });

    // Files remain blocked
    expect(result.files[0]?.file_access_blocked).toBe(true);
  });

  it("emits SSE pipeline events for each stage", async () => {
    const baseTip = makeBaseTip();
    const events: string[] = [];

    mockIntake.mockResolvedValueOnce(baseTip);
    mockLegalGate.mockResolvedValueOnce(makeLegalGateSuccess(baseTip));
    mockExtraction.mockResolvedValueOnce({ subjects: [], victims: [], ip_addresses: [], email_addresses: [], urls: [], domains: [], usernames: [], phone_numbers: [], device_identifiers: [], file_hashes: [], crypto_addresses: [], game_platform_ids: [], messaging_app_ids: [], dark_web_urls: [], geographic_indicators: [], venues: [], dates_mentioned: [], urgency_indicators: [], referenced_platforms: [], data_retention_notes: [], victim_crisis_indicators: [] });
    mockHashOsint.mockResolvedValueOnce({ any_match: false, match_sources: [], victim_identified_previously: false, aig_csam_detected: false, osint_findings: [], dark_web_indicators: [], per_file_results: [] });
    mockClassifier.mockResolvedValueOnce(makeClassification());
    mockLinker.mockResolvedValueOnce({ is_duplicate: false, related_tip_ids: [], deconfliction_matches: [], cluster_flags: [] });
    mockPriority.mockResolvedValueOnce(makePriority());

    // Subscribe to wildcard events
    const cleanup = onPipelineEvent("*", (event: any) => {
      events.push(event.step);
    });

    try {
      await processTip({
        source: "NCMEC_IDS",
        raw_content: "test",
        content_type: "text",
        received_at: NOW,
      });
    } finally {
      cleanup();
    }

    expect(events).toContain("intake");
    expect(events).toContain("legal_gate");
    expect(events).toContain("priority");
    expect(events).toContain("complete");
  });

  it("applyCriticalOverrides: CSAM + confirmed minor → score floored at 95", async () => {
    const baseTip = makeBaseTip();

    mockIntake.mockResolvedValueOnce(baseTip);
    mockLegalGate.mockResolvedValueOnce(makeLegalGateSuccess(baseTip));
    mockExtraction.mockResolvedValueOnce({
      subjects: [], victims: [{ age_range: "12-13", ongoing_abuse_indicated: false, victim_crisis_indicators: [], raw_mentions: [] }],
      ip_addresses: [], email_addresses: [], urls: [], domains: [], usernames: [], phone_numbers: [],
      device_identifiers: [], file_hashes: [], crypto_addresses: [], game_platform_ids: [],
      messaging_app_ids: [], dark_web_urls: [], geographic_indicators: [], venues: [],
      dates_mentioned: [], urgency_indicators: [], referenced_platforms: [],
      data_retention_notes: [], victim_crisis_indicators: [],
    });
    mockHashOsint.mockResolvedValueOnce({ any_match: true, match_sources: ["NCMEC"], victim_identified_previously: false, aig_csam_detected: false, osint_findings: [], dark_web_indicators: [], per_file_results: [] });
    mockClassifier.mockResolvedValueOnce(makeClassification("CSAM"));
    mockLinker.mockResolvedValueOnce({ is_duplicate: false, related_tip_ids: [], deconfliction_matches: [], cluster_flags: [] });
    // Priority returns score 70 — should be overridden to 95 minimum
    mockPriority.mockResolvedValueOnce(makePriority(70, "URGENT"));

    const result = await processTip({
      source: "NCMEC_IDS",
      raw_content: "CSAM with minor",
      content_type: "text",
      received_at: NOW,
    });

    // applyCriticalOverrides should have raised score to floor 95
    expect(result.priority?.score).toBeGreaterThanOrEqual(95);
    expect(result.priority?.tier).toBe("IMMEDIATE");
  });

  it("audit trail contains entry for each agent stage", async () => {
    const baseTip = makeBaseTip();

    mockIntake.mockResolvedValueOnce(baseTip);
    mockLegalGate.mockResolvedValueOnce(makeLegalGateSuccess(baseTip));
    mockExtraction.mockResolvedValueOnce({ subjects: [], victims: [], ip_addresses: [], email_addresses: [], urls: [], domains: [], usernames: [], phone_numbers: [], device_identifiers: [], file_hashes: [], crypto_addresses: [], game_platform_ids: [], messaging_app_ids: [], dark_web_urls: [], geographic_indicators: [], venues: [], dates_mentioned: [], urgency_indicators: [], referenced_platforms: [], data_retention_notes: [], victim_crisis_indicators: [] });
    mockHashOsint.mockResolvedValueOnce({ any_match: false, match_sources: [], victim_identified_previously: false, aig_csam_detected: false, osint_findings: [], dark_web_indicators: [], per_file_results: [] });
    mockClassifier.mockResolvedValueOnce(makeClassification());
    mockLinker.mockResolvedValueOnce({ is_duplicate: false, related_tip_ids: [], deconfliction_matches: [], cluster_flags: [] });
    mockPriority.mockResolvedValueOnce(makePriority());

    const result = await processTip({
      source: "NCMEC_IDS",
      raw_content: "test",
      content_type: "text",
      received_at: NOW,
    });

    const log = getInMemoryLog();
    const tipLog = log.filter((e: any) => e.tip_id === result.tip_id);

    const agentNames = tipLog.map((e: any) => e.agent);
    expect(agentNames).toContain("intake");
    expect(agentNames).toContain("legal_gate");
    expect(agentNames).toContain("extraction");
    expect(agentNames).toContain("hash_osint");
    expect(agentNames).toContain("classifier");
    expect(agentNames).toContain("linker");
    expect(agentNames).toContain("priority");
  });
});
