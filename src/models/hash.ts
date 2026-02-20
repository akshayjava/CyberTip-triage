import { z } from "zod";

export const HashMatchSourceSchema = z.enum([
  "NCMEC",
  "Project_VIC",
  "IWF",
  "Interpol_ICSE",
  "local_agency",
]);
export type HashMatchSource = z.infer<typeof HashMatchSourceSchema>;

export const OsintFindingSchema = z.object({
  entity_type: z.enum(["ip", "email", "username", "domain", "crypto", "phone"]),
  entity_value: z.string(),
  finding: z.string(),
  source: z.string(),
  confidence: z.number().min(0).max(1),
  is_tor_exit_node: z.boolean().optional(),
  is_known_vpn: z.boolean().optional(),
  geolocation: z.string().optional(),
  isp: z.string().optional(),
});
export type OsintFinding = z.infer<typeof OsintFindingSchema>;

export const DarkWebIndicatorSchema = z.object({
  indicator_type: z.enum([
    "onion_url",
    "i2p_address",
    "dark_web_forum",
    "tor_exit_ip",
  ]),
  value: z.string(),
  context: z.string(),
});
export type DarkWebIndicator = z.infer<typeof DarkWebIndicatorSchema>;

export const PerFileHashResultSchema = z.object({
  file_id: z.string().uuid(),
  ncmec_match: z.boolean(),
  project_vic_match: z.boolean(),
  iwf_match: z.boolean(),
  interpol_icse_match: z.boolean(),
  local_match: z.boolean(),
  aig_suspected: z.boolean(),
  series_name: z.string().optional(),
});
export type PerFileHashResult = z.infer<typeof PerFileHashResultSchema>;

export const HashMatchResultsSchema = z.object({
  any_match: z.boolean(),
  match_sources: z.array(HashMatchSourceSchema),
  known_series: z.string().optional(),
  victim_identified_previously: z.boolean(),
  victim_country: z.string().length(2).optional(),
  aig_csam_detected: z.boolean(),
  aig_detection_method: z.string().optional(),
  osint_findings: z.array(OsintFindingSchema),
  dark_web_indicators: z.array(DarkWebIndicatorSchema),
  per_file_results: z.array(PerFileHashResultSchema),
});
export type HashMatchResults = z.infer<typeof HashMatchResultsSchema>;
