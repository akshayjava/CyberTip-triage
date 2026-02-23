import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkDeconfliction } from "../check_deconfliction.js";

// Mock global fetch
const originalFetch = global.fetch;

describe("checkDeconfliction", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // vi.resetModules(); // Not needed as getProvider reads env every time
    process.env = { ...originalEnv };
    global.fetch = vi.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should use stub provider by default", async () => {
    // Ensure no real config
    delete process.env.TOOL_MODE;
    delete process.env.DECONFLICTION_API_URL;
    delete process.env.DECONFLICTION_API_KEY;

    // Call
    const result = await checkDeconfliction("email", "test@example.com", "CA");

    // Check
    expect(result.success).toBe(true);
    expect(result.data?.match_found).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should return match for known stub subject", async () => {
    delete process.env.TOOL_MODE;
    delete process.env.DECONFLICTION_API_URL;
    delete process.env.DECONFLICTION_API_KEY;

    const result = await checkDeconfliction("email", "stub_known_subject", "CA");

    expect(result.success).toBe(true);
    expect(result.data?.match_found).toBe(true);
    expect(result.data?.overlap_type).toBe("same_subject");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should fail if TOOL_MODE=real but missing config", async () => {
    process.env.TOOL_MODE = "real";
    delete process.env.DECONFLICTION_API_URL;
    delete process.env.DECONFLICTION_API_KEY;

    const result = await checkDeconfliction("email", "test@example.com", "CA");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/requires DECONFLICTION_API_URL/);
  });

  it("should use HTTP provider if configured", async () => {
    process.env.DECONFLICTION_API_URL = "https://api.example.com/check";
    process.env.DECONFLICTION_API_KEY = "test-key";

    const mockResponse = {
      match_found: true,
      agency_name: "Test Agency",
      active_investigation: true,
      coordination_recommended: true
    };

    // Use mocked implementation
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const result = await checkDeconfliction("email", "test@example.com", "CA");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.example.com/check",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer test-key"
        }),
        body: JSON.stringify({
          identifierType: "email",
          value: "test@example.com",
          jurisdiction: "CA"
        })
      })
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockResponse);
  });
});
