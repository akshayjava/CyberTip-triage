import { z } from "zod";
import { PreservationRequestSchema } from "./preservation.js";

export const PriorityTierSchema = z.enum([
  "IMMEDIATE",
  "URGENT",
  "STANDARD",
  "MONITOR",
  "PAUSED", // De-confliction conflict — awaiting supervisor coordination
]);
export type PriorityTier = z.infer<typeof PriorityTierSchema>;

export const ScoringFactorSchema = z.object({
  factor: z.string().min(1),
  applied: z.boolean(),
  contribution: z.number(),
  rationale: z.string().min(1),
});
export type ScoringFactor = z.infer<typeof ScoringFactorSchema>;

export const PriorityScoreSchema = z.object({
  score: z.number().min(0).max(100),
  tier: PriorityTierSchema,
  queue_position: z.number().int().positive().optional(),
  scoring_factors: z.array(ScoringFactorSchema),

  routing_unit: z.string().min(1),
  routing_international_notes: z.string().optional(),
  recommended_action: z.string().max(200),

  supervisor_alert: z.boolean(),
  supervisor_alert_reason: z.string().optional(),
  victim_crisis_alert: z.boolean(),
  victim_crisis_alert_text: z.string().optional(),

  // Preservation requests generated during priority scoring
  preservation_requests: z.array(PreservationRequestSchema).optional(),

  assigned_to: z.string().optional(),
});
export type PriorityScore = z.infer<typeof PriorityScoreSchema>;
