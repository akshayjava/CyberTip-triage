
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Anthropic
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// Import agents after mock
const { runIntakeAgent } = await import("../agents/intake.js");

function makeApiResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

describe("Intake Agent - JSON Parsing", () => {
  beforeEach(() => {
    process.env["NODE_ENV"] = "test";
    process.env["DB_MODE"] = "memory";
    mockCreate.mockReset();
  });

  it("correctly parses JSON input with bundled incidents", async () => {
    mockCreate.mockResolvedValueOnce(
      makeApiResponse("Normalized description")
    );

    const rawJson = JSON.stringify({
      description: "Test description",
      urgent: false,
      incident_count: 5,
      priority: 0,
      reporter: "Test ESP"
    });

    const result = await runIntakeAgent({
      source: "PORTAL",
      raw_content: rawJson,
      content_type: "json",
      received_at: new Date().toISOString(),
    });

    expect(result.is_bundled).toBe(true);
    expect(result.bundled_incident_count).toBe(5);
    expect(result.ncmec_urgent_flag).toBe(false);
    expect(result.reporter.esp_name).toBe("Test ESP");
  });

  it("handles single incident correctly", async () => {
    mockCreate.mockResolvedValueOnce(
      makeApiResponse("Normalized description")
    );

    const rawJson = JSON.stringify({
      description: "Test description",
      urgent: false,
      incident_count: 1,
      priority: 0
    });

    const result = await runIntakeAgent({
      source: "PORTAL",
      raw_content: rawJson,
      content_type: "json",
      received_at: new Date().toISOString(),
    });

    expect(result.is_bundled).toBe(false);
    expect(result.bundled_incident_count).toBe(1);
  });
});
