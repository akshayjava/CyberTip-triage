import { z } from "zod";

export const ClusterTypeSchema = z.enum([
  "same_school",
  "same_platform",
  "same_group",
  "same_geographic_area",
  "violent_online_group",
]);
export type ClusterType = z.infer<typeof ClusterTypeSchema>;

export const DeconflictionMatchSchema = z.object({
  agency_name: z.string().min(1),
  case_number: z.string().min(1),
  contact_investigator: z.string().optional(),
  overlap_type: z.enum([
    "same_subject",
    "same_victim",
    "same_ip",
    "same_hash",
    "same_username",
  ]),
  coordination_recommended: z.boolean(),
  active_investigation: z.boolean(),
});
export type DeconflictionMatch = z.infer<typeof DeconflictionMatchSchema>;

export const ClusterFlagSchema = z.object({
  cluster_type: ClusterTypeSchema,
  tip_count: z.number().int().positive(),
  time_window_days: z.number().int().positive(),
  description: z.string().min(1),
  cluster_id: z.string().uuid().optional(),
});
export type ClusterFlag = z.infer<typeof ClusterFlagSchema>;

export const TipLinksSchema = z.object({
  duplicate_of: z.string().uuid().optional(),
  related_tip_ids: z.array(z.string().uuid()),
  matching_subject_ids: z.array(z.string().uuid()),
  open_case_numbers: z.array(z.string()),
  deconfliction_matches: z.array(DeconflictionMatchSchema),
  cluster_flags: z.array(ClusterFlagSchema),
  mlat_required: z.boolean(),
  link_confidence: z.number().min(0).max(1),
  link_reasoning: z.string().min(1),
  new_info_on_duplicate: z.string().optional(),
});
export type TipLinks = z.infer<typeof TipLinksSchema>;
