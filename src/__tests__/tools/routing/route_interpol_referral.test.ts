import { describe, it, expect } from "vitest";
import { routeInterpolReferral } from "../../../tools/routing/route_interpol_referral.js";

describe("routeInterpolReferral", () => {
  const tipId = "tip-123";
  const countries = ["Germany", "France"];
  const summary = "A summary of the tip.";

  it("should generate a valid referral for urgent cases", async () => {
    const result = await routeInterpolReferral(tipId, countries, "urgent", summary);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.referral_id).toMatch(/^INTERPOL-DRAFT-[A-Z0-9]{8}$/);
    expect(result.data?.status).toBe("draft");
    expect(result.data?.countries_involved).toEqual(countries);
    expect(result.data?.urgency).toBe("urgent");
    expect(result.data?.routing_notes).toContain("Germany, France");
    expect(result.data?.next_step).toBeDefined();
    expect(result.latency_ms).toBeGreaterThan(0);
  });

  it("should generate a valid referral for standard cases", async () => {
    const result = await routeInterpolReferral(tipId, ["Japan"], "standard");

    expect(result.success).toBe(true);
    expect(result.data?.urgency).toBe("standard");
    expect(result.data?.countries_involved).toEqual(["Japan"]);
    expect(result.data?.routing_notes).toContain("Japan");
  });

  it("should handle empty country list", async () => {
    const result = await routeInterpolReferral(tipId, [], "standard");

    expect(result.success).toBe(true);
    expect(result.data?.countries_involved).toEqual([]);
    expect(result.data?.routing_notes).toContain("Tip involves 0 foreign jurisdiction(s)");
  });
});
