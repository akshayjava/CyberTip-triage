import { z } from "zod";

export const PreservationStatusSchema = z.enum([
  "draft",
  "issued",
  "confirmed",
  "fulfilled",
  "expired",
]);
export type PreservationStatus = z.infer<typeof PreservationStatusSchema>;

export const PreservationRequestSchema = z.object({
  request_id: z.string().uuid(),
  tip_id: z.string().uuid(),
  esp_name: z.string().min(1),
  account_identifiers: z.array(z.string()).min(1),
  legal_basis: z.string().min(1),
  jurisdiction: z.string().min(1),
  issued_at: z.string().datetime().optional(),
  deadline_for_esp_response: z.string().date().optional(),
  esp_retention_window_days: z.number().int().positive().optional(),
  status: PreservationStatusSchema,
  auto_generated: z.boolean(),
  approved_by: z.string().optional(),
  letter_text: z.string().optional(),
});
export type PreservationRequest = z.infer<typeof PreservationRequestSchema>;
