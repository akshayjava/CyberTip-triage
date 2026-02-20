import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import {
  TipFileSchema,
  CyberTipSchema,
  LegalStatusSchema,
  ClassificationSchema,
  ExtractedEntitiesSchema,
  PriorityScoreSchema,
  AuditEntrySchema,
  PreservationRequestSchema,
} from "../models/index.js";

const NOW = new Date().toISOString();
const UUID = randomUUID();

// ── TipFile ───────────────────────────────────────────────────────────────────

describe("TipFileSchema", () => {
  const validFile = {
    file_id: UUID,
    media_type: "image",
    esp_viewed: false,
    esp_viewed_missing: false,
    publicly_available: false,
    warrant_required: true,
    warrant_status: "pending_application",
    file_access_blocked: true,
    ncmec_hash_match: false,
    project_vic_match: false,
    iwf_match: false,
    interpol_icse_match: false,
    aig_csam_suspected: false,
  };

  it("Valid file passes", () => {
    expect(() => TipFileSchema.parse(validFile)).not.toThrow();
  });

  it("Missing file_id fails", () => {
    const { file_id: _, ...noId } = validFile;
    expect(() => TipFileSchema.parse(noId)).toThrow();
  });

  it("Invalid media_type fails", () => {
    expect(() =>
      TipFileSchema.parse({ ...validFile, media_type: "audio" })
    ).toThrow();
  });

  it("Invalid warrant_status fails", () => {
    expect(() =>
      TipFileSchema.parse({ ...validFile, warrant_status: "maybe" })
    ).toThrow();
  });

  it("AIG confidence out of range fails", () => {
    expect(() =>
      TipFileSchema.parse({ ...validFile, aig_detection_confidence: 1.5 })
    ).toThrow();
  });
});

// ── LegalStatus ───────────────────────────────────────────────────────────────

describe("LegalStatusSchema", () => {
  const validStatus = {
    files_requiring_warrant: [UUID],
    all_warrants_resolved: false,
    any_files_accessible: false,
    legal_note: "File is blocked pending warrant.",
    exigent_circumstances_claimed: false,
  };

  it("Valid status passes", () => {
    expect(() => LegalStatusSchema.parse(validStatus)).not.toThrow();
  });

  it("Empty legal_note fails", () => {
    expect(() =>
      LegalStatusSchema.parse({ ...validStatus, legal_note: "" })
    ).toThrow();
  });
});

// ── Classification ────────────────────────────────────────────────────────────

describe("ClassificationSchema", () => {
  const validClassification = {
    offense_category: "CSAM",
    secondary_categories: [],
    aig_csam_flag: false,
    sextortion_victim_in_crisis: false,
    e2ee_data_gap: false,
    severity: { us_icac: "P1_CRITICAL" },
    jurisdiction: {
      primary: "US_federal",
      countries_involved: ["US"],
      interpol_referral_indicated: false,
      europol_referral_indicated: false,
    },
    mlat_likely_required: false,
    applicable_statutes: ["18 U.S.C. § 2256"],
    confidence: 0.95,
    reasoning: "Hash match confirmed in NCMEC database.",
  };

  it("Valid classification passes", () => {
    expect(() => ClassificationSchema.parse(validClassification)).not.toThrow();
  });

  it("Confidence > 1 fails", () => {
    expect(() =>
      ClassificationSchema.parse({ ...validClassification, confidence: 1.1 })
    ).toThrow();
  });

  it("Invalid offense category fails", () => {
    expect(() =>
      ClassificationSchema.parse({
        ...validClassification,
        offense_category: "MURDER",
      })
    ).toThrow();
  });

  it("Country code longer than 2 chars fails", () => {
    expect(() =>
      ClassificationSchema.parse({
        ...validClassification,
        jurisdiction: {
          ...validClassification.jurisdiction,
          countries_involved: ["USA"], // Should be "US"
        },
      })
    ).toThrow();
  });
});

// ── PreservationRequest ────────────────────────────────────────────────────────

describe("PreservationRequestSchema", () => {
  const validRequest = {
    request_id: UUID,
    tip_id: UUID,
    esp_name: "Meta/Instagram",
    account_identifiers: ["user@example.com"],
    legal_basis: "18 U.S.C. § 2703(f)",
    jurisdiction: "US",
    status: "draft",
    auto_generated: true,
  };

  it("Valid request passes", () => {
    expect(() => PreservationRequestSchema.parse(validRequest)).not.toThrow();
  });

  it("Empty account_identifiers fails", () => {
    expect(() =>
      PreservationRequestSchema.parse({ ...validRequest, account_identifiers: [] })
    ).toThrow();
  });
});

// ── AuditEntry ────────────────────────────────────────────────────────────────

describe("AuditEntrySchema", () => {
  const validEntry = {
    entry_id: UUID,
    tip_id: UUID,
    agent: "LegalGateAgent",
    timestamp: NOW,
    status: "success",
    summary: "Legal gate complete. 2 files blocked.",
  };

  it("Valid entry passes", () => {
    expect(() => AuditEntrySchema.parse(validEntry)).not.toThrow();
  });

  it("Invalid agent name fails", () => {
    expect(() =>
      AuditEntrySchema.parse({ ...validEntry, agent: "RandomAgent" })
    ).toThrow();
  });

  it("Empty summary fails", () => {
    expect(() =>
      AuditEntrySchema.parse({ ...validEntry, summary: "" })
    ).toThrow();
  });
});
