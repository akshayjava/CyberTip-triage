import { z } from "zod";

// ── Supported digital forensics platforms ────────────────────────────────────
// Griffeye Analyze DI is listed first — it is the dominant ICAC triage tool,
// integrates with Project VIC hashes, and is used by the majority of ICAC task
// forces for bulk media review of CyberTips.

export const ForensicsPlatformSchema = z.enum([
  "GRIFFEYE",   // Griffeye Analyze DI — Project VIC JSON + CSV case import
  "AXIOM",      // Magnet AXIOM / Magnet REVIEW — JSON case manifest
  "FTK",        // AccessData FTK / FTK Imager — case import XML
  "CELLEBRITE", // Cellebrite UFED / Inspector — UFDR-style handoff package
  "ENCASE",     // OpenText EnCase — case package + EnScript-ready CSV
  "GENERIC",    // Generic JSON bundle — any tool that accepts structured input
]);
export type ForensicsPlatform = z.infer<typeof ForensicsPlatformSchema>;

// ── Per-file handoff record ───────────────────────────────────────────────────
// Only files where file_access_blocked === false are ever included in a handoff.
// Wilson compliance is enforced at the coordinator level before this schema is
// populated.

export const ForensicsFileRecordSchema = z.object({
  file_id: z.string().uuid(),
  filename: z.string().optional(),
  file_size_bytes: z.number().int().positive().optional(),
  media_type: z.enum(["image", "video", "document", "other"]),

  // All available hashes — forensics tools ingest whichever they support
  hash_md5: z.string().optional(),
  hash_sha1: z.string().optional(),
  hash_sha256: z.string().optional(),
  photodna_hash: z.string().optional(),

  // Watch-list verdicts — already known before analyst opens any file
  ncmec_hash_match: z.boolean(),
  project_vic_match: z.boolean(),
  iwf_match: z.boolean(),
  interpol_icse_match: z.boolean(),
  aig_csam_suspected: z.boolean(),
  aig_detection_confidence: z.number().min(0).max(1).optional(),

  // Legal clearance — coordinator hard-blocks if false
  warrant_status: z.enum(["not_needed", "applied", "granted"]),
  warrant_number: z.string().optional(),
});
export type ForensicsFileRecord = z.infer<typeof ForensicsFileRecordSchema>;

// ── Tip-level context included with every handoff ────────────────────────────

export const ForensicsTipContextSchema = z.object({
  tip_id: z.string().uuid(),
  ncmec_tip_number: z.string().optional(),
  ids_case_number: z.string().optional(),
  source: z.string(),
  received_at: z.string().datetime(),
  esp_name: z.string().optional(),

  // Triage outputs
  offense_category: z.string(),
  secondary_categories: z.array(z.string()),
  severity_us_icac: z.string(), // P1_CRITICAL … P4_LOW
  severity_iwf: z.string().optional(), // A / B / C — used by Griffeye categories
  priority_score: z.number().min(0).max(100),
  priority_tier: z.string(),
  routing_unit: z.string(),
  recommended_action: z.string(),

  // Subjects & victims (no raw CSAM content — only metadata)
  subject_count: z.number().int(),
  subjects_summary: z.array(z.object({
    subject_id: z.string().uuid(),
    name: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    accounts: z.array(z.string()),
    country: z.string().length(2).optional(),
    dob: z.string().optional(),
  })),
  victim_count: z.number().int(),
  victim_age_ranges: z.array(z.string()),
  ongoing_abuse_indicated: z.boolean(),

  // Network indicators
  ip_addresses: z.array(z.string()),
  urls: z.array(z.string()),
  domains: z.array(z.string()),
  usernames: z.array(z.string()),
  dark_web_urls: z.array(z.string()),
  crypto_addresses: z.array(z.string()),

  // Legal
  applicable_statutes: z.array(z.string()),
  warrant_required: z.boolean(),
  preservation_deadline: z.string().optional(),

  // Files cleared for forensic review
  files: z.array(ForensicsFileRecordSchema),
  total_file_count: z.number().int(),
  accessible_file_count: z.number().int(), // warrant-cleared subset
});
export type ForensicsTipContext = z.infer<typeof ForensicsTipContextSchema>;

// ── Handoff record — persisted to forensics_handoffs table ───────────────────

export const ForensicsHandoffStatusSchema = z.enum([
  "pending",    // Generated, not yet opened in forensics tool
  "delivered",  // Package downloaded / webhook acknowledged
  "imported",   // Investigator confirmed import into forensics tool
  "completed",  // Forensics review complete, findings returned
]);
export type ForensicsHandoffStatus = z.infer<typeof ForensicsHandoffStatusSchema>;

export const ForensicsHandoffSchema = z.object({
  handoff_id: z.string().uuid(),
  tip_id: z.string().uuid(),
  platform: ForensicsPlatformSchema,
  generated_at: z.string().datetime(),
  generated_by: z.string(), // officer badge / investigator_id
  status: ForensicsHandoffStatusSchema,
  delivered_at: z.string().datetime().optional(),
  imported_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional(),
  notes: z.string().optional(),

  // Counts at time of handoff (files may change if more warrants granted later)
  files_included: z.number().int(),
  files_blocked_wilson: z.number().int(), // files excluded due to Wilson/warrant

  // The export payload — format varies by platform
  export_format: z.string(), // "project_vic_json" | "axiom_json" | "ftk_xml" | etc.
  export_size_bytes: z.number().int().optional(),
});
export type ForensicsHandoff = z.infer<typeof ForensicsHandoffSchema>;

// ── Project VIC hash set format (used by Griffeye, NCMEC, IWF) ───────────────
// Spec: https://projectvic.org/technical-documentation

export interface ProjectVicHash {
  MD5?: string;
  SHA1?: string;
  PhotoDNA?: string;
  Filesize?: number;
}

export interface ProjectVicHashSet {
  HashSetID: string;       // UUID — maps to tip_id
  HashSetName: string;     // e.g. "NCMEC CyberTip 12345678"
  Category: 1 | 2 | 3;    // IWF: 1=A (most severe), 2=B, 3=C
  MediaType: "Image" | "Video" | "Other";
  IsActive: boolean;
  CreatedDate: string;     // ISO 8601
  Hashes: ProjectVicHash[];
}

export interface ProjectVicExport {
  VictimListVersion: "2.1";
  ExportDate: string;
  ExportedBy: string;
  HashSets: ProjectVicHashSet[];
}

// ── Griffeye CSV case import row ──────────────────────────────────────────────
// Griffeye Analyze DI can import case metadata from CSV for batch setup.

export interface GriffeyCaseRow {
  CaseNumber: string;
  CaseDescription: string;
  OffenseCategory: string;
  IWFCategory: string;
  NCMECTipNumber: string;
  ESPName: string;
  ReceivedDate: string;
  PriorityScore: string;
  PriorityTier: string;
  SubjectCount: string;
  VictimAgeRanges: string;
  OngoingAbuse: string;
  ApplicableStatutes: string;
  HashMatchNCMEC: string;
  HashMatchProjectVIC: string;
  HashMatchIWF: string;
  AIGCSAMSuspected: string;
  WarrantRequired: string;
  RoutingUnit: string;
  RecommendedAction: string;
}
