import { z } from "zod";
import { ReporterSchema } from "./reporter.js";
import { ExtractedEntitiesSchema } from "./entities.js";
import { ClassificationSchema, JurisdictionProfileSchema } from "./classification.js";
import { TipLinksSchema } from "./links.js";
import { PriorityScoreSchema } from "./priority.js";
import { HashMatchResultsSchema } from "./hash.js";
import { PreservationRequestSchema } from "./preservation.js";
import { AuditEntrySchema } from "./audit.js";

export const TipSourceSchema = z.enum([
  "NCMEC_IDS",
  "NCMEC_API",
  "ESP_direct",
  "email",
  "vpn_portal",
  "inter_agency",
  "public_web_form",
]);
export type TipSource = z.infer<typeof TipSourceSchema>;

export const TipStatusSchema = z.enum([
  "pending",
  "triaged",
  "assigned",
  "in_investigation",
  "closed",
  "duplicate",
  "referred_out",
  "BLOCKED", // Legal Gate hard block — do not process
]);
export type TipStatus = z.infer<typeof TipStatusSchema>;

export const WarrantStatusSchema = z.enum([
  "not_needed",
  "pending_application",
  "applied",
  "granted",
  "denied",
]);
export type WarrantStatus = z.infer<typeof WarrantStatusSchema>;

export const TipFileSchema = z.object({
  file_id: z.string().uuid(),
  filename: z.string().optional(),
  file_size_bytes: z.number().int().positive().optional(),
  media_type: z.enum(["image", "video", "document", "other"]),

  // Hashes — all that are available
  hash_md5: z.string().optional(),
  hash_sha1: z.string().optional(),
  hash_sha256: z.string().optional(),
  photodna_hash: z.string().optional(),

  // ─── WILSON RULING COMPLIANCE — CRITICAL ─────────────────────────────────
  // See compliance/COMPLIANCE.md Section 1.
  // If esp_viewed=false and publicly_available=false, file_access_blocked MUST be true.
  esp_viewed: z.boolean(),
  esp_viewed_missing: z.boolean(), // True when Section A flag was absent from report
  esp_categorized_as: z.string().optional(), // ESP's label, e.g. Google "A1"
  publicly_available: z.boolean(),
  warrant_required: z.boolean(),
  warrant_status: WarrantStatusSchema,
  warrant_number: z.string().optional(),
  warrant_granted_by: z.string().optional(),
  file_access_blocked: z.boolean(), // Enforced: true until warrant granted (if required)
  // ─────────────────────────────────────────────────────────────────────────

  // Hash match results (populated by Hash & OSINT Agent)
  ncmec_hash_match: z.boolean(),
  project_vic_match: z.boolean(),
  iwf_match: z.boolean(),
  interpol_icse_match: z.boolean(),
  aig_csam_suspected: z.boolean(),
  aig_detection_confidence: z.number().min(0).max(1).optional(),
  aig_detection_method: z.string().optional(),
});
export type TipFile = z.infer<typeof TipFileSchema>;

export const LegalStatusSchema = z.object({
  files_requiring_warrant: z.array(z.string().uuid()),
  all_warrants_resolved: z.boolean(),
  any_files_accessible: z.boolean(),
  legal_note: z.string().min(1),
  relevant_circuit: z.string().optional(),
  exigent_circumstances_claimed: z.boolean(),
  exigent_circumstances_authorized_by: z.string().optional(),
  exigent_circumstances_logged_at: z.string().datetime().optional(),
});
export type LegalStatus = z.infer<typeof LegalStatusSchema>;

export const CyberTipSchema = z.object({
  tip_id: z.string().uuid(),
  ncmec_tip_number: z.string().optional(),
  ids_case_number: z.string().optional(),
  source: TipSourceSchema,
  received_at: z.string().datetime(),
  raw_body: z.string(),
  normalized_body: z.string(),
  jurisdiction_of_tip: JurisdictionProfileSchema,
  reporter: ReporterSchema,
  files: z.array(TipFileSchema),
  is_bundled: z.boolean(),
  bundled_incident_count: z.number().int().positive().optional(),
  ncmec_urgent_flag: z.boolean(),

  // Agent outputs — undefined until that agent runs
  legal_status: LegalStatusSchema.optional(),
  extracted: ExtractedEntitiesSchema.optional(),
  hash_matches: HashMatchResultsSchema.optional(),
  classification: ClassificationSchema.optional(),
  links: TipLinksSchema.optional(),
  priority: PriorityScoreSchema.optional(),

  preservation_requests: z.array(PreservationRequestSchema),
  status: TipStatusSchema,
  audit_trail: z.array(AuditEntrySchema),
});
export type CyberTip = z.infer<typeof CyberTipSchema>;

// ── Partial type for updates ─────────────────────────────────────────────────
// Used when an agent updates a specific field without re-validating the whole tip
export const PartialCyberTipSchema = CyberTipSchema.partial().required({
  tip_id: true,
});
export type PartialCyberTip = z.infer<typeof PartialCyberTipSchema>;
