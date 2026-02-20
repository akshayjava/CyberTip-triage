import { runTool, type ToolResult } from "../types.js";
import { randomUUID } from "crypto";

export interface InterpolReferralResult {
  referral_id: string;
  status: "draft" | "pending_approval";
  countries_involved: string[];
  urgency: "urgent" | "standard";
  routing_notes: string;
  next_step: string;
}

async function routeInterpolReferralStub(
  tipId: string,
  countriesInvolved: string[],
  urgency: "urgent" | "standard",
  summary?: string
): Promise<InterpolReferralResult> {
  await new Promise(r => setTimeout(r, 10));

  return {
    referral_id: `INTERPOL-DRAFT-${randomUUID().slice(0, 8).toUpperCase()}`,
    status: "draft",
    countries_involved: countriesInvolved,
    urgency,
    routing_notes:
      `Tip involves ${countriesInvolved.length} foreign jurisdiction(s): ${countriesInvolved.join(", ")}. ` +
      `Referral drafted for Interpol NCB routing via NCMEC international liaison.`,
    next_step:
      "Supervisor must review and approve before submission. " +
      "Route through NCMEC international portal or direct Interpol NCB contact.",
  };
}

export async function routeInterpolReferral(
  tipId: string,
  countriesInvolved: string[],
  urgency: "urgent" | "standard",
  summary?: string
): Promise<ToolResult<InterpolReferralResult>> {
  return runTool(() => routeInterpolReferralStub(tipId, countriesInvolved, urgency, summary));
}
