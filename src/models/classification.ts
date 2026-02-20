import { z } from "zod";

export const OffenseCategorySchema = z.enum([
  "CSAM",
  "CHILD_GROOMING",
  "ONLINE_ENTICEMENT",      // REPORT Act (2024): distinct mandatory reporting category
                             // 18 U.S.C. § 2258A — adult communicating with minor for sexual purposes
  "CHILD_SEX_TRAFFICKING",  // REPORT Act (2024): now mandatory reporting
  "CYBER_EXPLOITATION",
  "SEXTORTION",
  "FINANCIAL_FRAUD",
  "RANSOMWARE",
  "NETWORK_INTRUSION",
  "IDENTITY_THEFT",
  "THREATS_HARASSMENT",
  "TERRORISM_EXTREMISM",
  "DRUG_TRAFFICKING",
  "OTHER",
]);
export type OffenseCategory = z.infer<typeof OffenseCategorySchema>;

export const UsIcacSeveritySchema = z.enum([
  "P1_CRITICAL",
  "P2_HIGH",
  "P3_MEDIUM",
  "P4_LOW",
]);
export type UsIcacSeverity = z.infer<typeof UsIcacSeveritySchema>;

export const IwfCategorySchema = z.enum(["A", "B", "C"]);
export type IwfCategory = z.infer<typeof IwfCategorySchema>;

export const MultiSchemeSeveritySchema = z.object({
  us_icac: UsIcacSeveritySchema,
  iwf_category: IwfCategorySchema.optional(),
  interpol_severity: z.enum(["urgent", "standard"]).optional(),
  local_scheme_label: z.string().optional(),
});
export type MultiSchemeSeverity = z.infer<typeof MultiSchemeSeveritySchema>;

export const JurisdictionProfileSchema = z.object({
  primary: z.enum([
    "US_federal",
    "US_state",
    "US_local",
    "EU_member_state",
    "UK",
    "Canada",
    "Australia",
    "international_other",
    "unknown",
  ]),
  countries_involved: z.array(z.string().length(2)),
  us_icac_task_force: z.string().optional(),
  us_jurisdiction_level: z.enum(["federal", "state", "local"]).optional(),
  interpol_referral_indicated: z.boolean(),
  europol_referral_indicated: z.boolean(),
});
export type JurisdictionProfile = z.infer<typeof JurisdictionProfileSchema>;

export const ClassificationSchema = z.object({
  offense_category: OffenseCategorySchema,
  secondary_categories: z.array(OffenseCategorySchema),
  offense_subcategory: z.string().optional(),

  // Critical flags
  aig_csam_flag: z.boolean(),
  sextortion_victim_in_crisis: z.boolean(),
  e2ee_data_gap: z.boolean(),

  severity: MultiSchemeSeveritySchema,
  jurisdiction: JurisdictionProfileSchema,

  mlat_likely_required: z.boolean(),
  applicable_statutes: z.array(z.string()),
  esp_data_retention_deadline: z.string().date().optional(),
  esp_name: z.string().optional(),

  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
});
export type Classification = z.infer<typeof ClassificationSchema>;
