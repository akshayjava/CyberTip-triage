import { z } from "zod";

export const ReporterTypeSchema = z.enum([
  "NCMEC",
  "ESP",
  "member_public",
  "law_enforcement",
  "inter_agency",
  "other",
]);
export type ReporterType = z.infer<typeof ReporterTypeSchema>;

export const ReporterSchema = z.object({
  type: ReporterTypeSchema,
  name: z.string().optional(),
  email: z.string().email().optional(),
  ip: z.string().optional(),
  esp_name: z.string().optional(),
  agency_name: z.string().optional(),
  originating_country: z.string().length(2).optional(),
});
export type Reporter = z.infer<typeof ReporterSchema>;
