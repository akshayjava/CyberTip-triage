
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { mountTier3Routes } from "../api/tier3_routes.js";
import { upsertTip } from "../db/tips.js";
import { CyberTip } from "../models/tip.js";

// Mock tip data matching CyberTip interface
const mockCanonicalTip: CyberTip = {
  tip_id: "canonical-1",
  received_at: "2023-01-01T12:00:00.000Z",
  source: "NCMEC_API",
  status: "triaged",
  is_bundled: true,
  bundled_incident_count: 5,
  files: [],
  preservation_requests: [],
  audit_trail: [],
  ncmec_urgent_flag: false,
  raw_body: "body",
  normalized_body: "normalized body",
  reporter: { esp_name: "Test ESP", reporting_person: "John Doe", email: "john@example.com" },
  jurisdiction_of_tip: { inferred_country: "US", inferred_state: "CA", confidence: 0.9 },
};

const mockDuplicateTip: CyberTip = {
  tip_id: "duplicate-1",
  received_at: "2023-01-01T12:05:00.000Z",
  source: "NCMEC_API",
  status: "duplicate",
  is_bundled: false,
  links: {
    duplicate_of: "canonical-1",
    related_tip_ids: ["canonical-1"],
    matching_subject_ids: [],
    open_case_numbers: [],
    deconfliction_matches: [],
    cluster_flags: [],
    mlat_required: false,
    link_confidence: 1.0,
    link_reasoning: "Same hash"
  },
  files: [
    {
      file_id: "file-1",
      media_type: "image",
      esp_viewed: false,
      esp_viewed_missing: false,
      publicly_available: false,
      warrant_required: true,
      warrant_status: "not_needed",
      file_access_blocked: true,
      ncmec_hash_match: true,
      project_vic_match: false,
      iwf_match: false,
      interpol_icse_match: false,
      aig_csam_suspected: false
    }
  ],
  preservation_requests: [],
  audit_trail: [],
  ncmec_urgent_flag: false,
  raw_body: "duplicate body",
  normalized_body: "normalized duplicate body",
  reporter: { esp_name: "Test ESP", reporting_person: "Jane Doe", email: "jane@example.com" },
  jurisdiction_of_tip: { inferred_country: "US", inferred_state: "CA", confidence: 0.9 },
};

function buildTestApp() {
  const app = express();
  app.use(express.json());
  mountTier3Routes(app);
  return app;
}

const app = buildTestApp();

describe("Tier 3 Routes", () => {
  beforeAll(async () => {
    process.env["DB_MODE"] = "memory";
    await upsertTip(mockCanonicalTip);
    await upsertTip(mockDuplicateTip);
  });

  describe("GET /api/bundles/:id", () => {
    it("returns canonical tip with duplicates absorbed", async () => {
      const res = await request(app).get("/api/bundles/canonical-1");
      expect(res.status).toBe(200);
      expect(res.body.canonical.tip_id).toBe("canonical-1");
      expect(res.body.duplicate_count).toBe(1);
      expect(res.body.duplicates_absorbed).toHaveLength(1);
      expect(res.body.duplicates_absorbed[0].tip_id).toBe("duplicate-1");
      // Verify properties accessed via 'any'
      expect(res.body.duplicates_absorbed[0].received_at).toBe(mockDuplicateTip.received_at);
      expect(res.body.duplicates_absorbed[0].source).toBe(mockDuplicateTip.source);
    });

    it("returns 404 for unknown tip", async () => {
      const res = await request(app).get("/api/bundles/unknown-id");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/hash/stats", () => {
    it("returns hash stats", async () => {
      const res = await request(app).get("/api/hash/stats");
      expect(res.status).toBe(200);
      // Since default received_at is old, recent tips might be empty unless we adjust date
      // Or we can just check structure
      expect(res.body).toHaveProperty("hash_matches");
      expect(res.body.tips_analyzed).toBeDefined();
    });
  });
});
