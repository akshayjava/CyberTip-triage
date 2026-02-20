import { z } from "zod";

export const AgentNameSchema = z.enum([
  "IntakeAgent",
  "LegalGateAgent",
  "ExtractionAgent",
  "HashOsintAgent",
  "ClassifierAgent",
  "LinkerAgent",
  "PriorityAgent",
  "Orchestrator",
  "HumanReview",
]);
export type AgentName = z.infer<typeof AgentNameSchema>;

export const AuditEntrySchema = z.object({
  entry_id: z.string().uuid(),
  tip_id: z.string().uuid(),
  agent: AgentNameSchema,
  timestamp: z.string().datetime(),
  duration_ms: z.number().int().nonnegative().optional(),
  status: z.enum(["success", "agent_error", "human_override", "skipped"]),
  summary: z.string().min(1),
  model_used: z.string().optional(),
  tokens_used: z.number().int().nonnegative().optional(),
  error_detail: z.string().optional(),
  human_actor: z.string().optional(),
  previous_value: z.unknown().optional(),
  new_value: z.unknown().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
