import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  openWarrantApplication,
  recordWarrantGrant,
  recordWarrantDenial,
  submitWarrantToDA,
  getWarrantApplications,
  buildAffidavitDraft,
  clearApplicationStore,
  type WarrantApplication
} from "../tools/legal/warrant_workflow.js";
import { updateFileWarrant, upsertTip, getTipById } from "../db/tips.js";

// Ensure DB_MODE is memory (default is not postgres, so it's memory)
process.env.DB_MODE = "memory";

describe("Warrant Workflow", () => {
  const mockTip = {
    tip_id: "tip-001",
    received_at: "2023-01-01T00:00:00Z",
    ncmec_tip_number: "12345",
    classification: { offense_category: "CSAM" },
    extracted: {
      subjects: [{ name: "John Doe" }],
      digital_artifacts: [{ type: "email", value: "test@example.com" }]
    },
    files: [
      { file_id: "file-1", file_access_blocked: true, media_type: "image/jpeg" },
      { file_id: "file-2", file_access_blocked: false, media_type: "image/png" },
      { file_id: "file-3", file_access_blocked: true, media_type: "video/mp4" }
    ],
    preservation_requests: [],
    audit_trail: []
  } as any;

  beforeEach(async () => {
    clearApplicationStore();
    // Setup in-memory DB by upserting the tip
    await upsertTip(mockTip);
  });

  describe("openWarrantApplication", () => {
    it("creates a new application for blocked files", async () => {
      const app = await openWarrantApplication(mockTip, "officer-123");

      expect(app).toBeDefined();
      expect(app.tip_id).toBe("tip-001");
      expect(app.status).toBe("draft");
      expect(app.created_by).toBe("officer-123");
      expect(app.application_id).toBeDefined();

      // Should only include blocked files
      expect(app.file_ids).toHaveLength(2);
      expect(app.file_ids).toContain("file-1");
      expect(app.file_ids).toContain("file-3");
      expect(app.file_ids).not.toContain("file-2");
    });

    it("generates an affidavit draft", async () => {
      const app = await openWarrantApplication(mockTip, "officer-123");
      expect(app.affidavit_draft).toContain("AFFIDAVIT IN SUPPORT OF APPLICATION");
      expect(app.affidavit_draft).toContain("test@example.com");
      expect(app.affidavit_draft).toContain("John Doe");
    });

    it("stores the application", async () => {
      const app = await openWarrantApplication(mockTip, "officer-123");
      const storedApps = await getWarrantApplications("tip-001");
      expect(storedApps).toHaveLength(1);
      expect(storedApps[0]?.application_id).toBe(app.application_id);
    });
  });

  describe("submitWarrantToDA", () => {
    it("updates status to pending_da_review", async () => {
      const app = await openWarrantApplication(mockTip, "officer-123");

      await submitWarrantToDA(app.application_id, "DA Harvey Dent");

      const updatedApps = await getWarrantApplications("tip-001");
      const updatedApp = updatedApps[0];

      expect(updatedApp?.status).toBe("pending_da_review");
      expect(updatedApp?.da_name).toBe("DA Harvey Dent");
      expect(updatedApp?.submitted_at).toBeDefined();
    });
  });

  describe("recordWarrantGrant", () => {
    it("updates status and unblocks files", async () => {
      const app = await openWarrantApplication(mockTip, "officer-123");

      await recordWarrantGrant(
        app.application_id,
        "W-2023-001",
        "Judge Dredd",
        "supervisor-456"
      );

      const updatedApps = await getWarrantApplications("tip-001");
      const updatedApp = updatedApps[0];

      expect(updatedApp?.status).toBe("granted");
      expect(updatedApp?.warrant_number).toBe("W-2023-001");
      expect(updatedApp?.granting_judge).toBe("Judge Dredd");
      expect(updatedApp?.approved_by).toBe("supervisor-456");
      expect(updatedApp?.decided_at).toBeDefined();

      // Verify file unblocked in DB
      const tip = await getTipById("tip-001");
      const file1 = tip?.files.find((f: any) => f.file_id === "file-1");
      const file3 = tip?.files.find((f: any) => f.file_id === "file-3");

      expect(file1?.file_access_blocked).toBe(false);
      expect(file1?.warrant_status).toBe("granted");
      expect(file1?.warrant_number).toBe("W-2023-001");
      expect(file1?.warrant_granted_by).toBe("Judge Dredd");

      expect(file3?.file_access_blocked).toBe(false);
      expect(file3?.warrant_status).toBe("granted");
    });

    it("returns null if application not found", async () => {
      const result = await recordWarrantGrant("non-existent-id", "W-1", "Judge", "Sup");
      expect(result).toBeNull();
    });
  });

  describe("recordWarrantDenial", () => {
    it("updates status to denied", async () => {
      const app = await openWarrantApplication(mockTip, "officer-123");

      await recordWarrantDenial(app.application_id, "Insufficient probable cause");

      const updatedApps = await getWarrantApplications("tip-001");
      const updatedApp = updatedApps[0];

      expect(updatedApp?.status).toBe("denied");
      expect(updatedApp?.denial_reason).toBe("Insufficient probable cause");
      expect(updatedApp?.decided_at).toBeDefined();

      // Should NOT unblock files in DB
      const tip = await getTipById("tip-001");
      const file1 = tip?.files.find((f: any) => f.file_id === "file-1");

      expect(file1?.file_access_blocked).toBe(true);
      expect(file1?.warrant_status).not.toBe("granted");
    });

    it("returns null if application not found", async () => {
      const result = await recordWarrantDenial("non-existent-id", "Reason");
      expect(result).toBeNull();
    });
  });

  describe("getWarrantApplications", () => {
    it("returns applications only for the specific tip", async () => {
      await openWarrantApplication(mockTip, "officer-1");

      const otherTip = { ...mockTip, tip_id: "tip-002" };
      await upsertTip(otherTip); // Add other tip to DB if needed
      await openWarrantApplication(otherTip, "officer-2");

      const apps1 = await getWarrantApplications("tip-001");
      const apps2 = await getWarrantApplications("tip-002");

      expect(apps1).toHaveLength(1);
      expect(apps1[0]?.tip_id).toBe("tip-001");

      expect(apps2).toHaveLength(1);
      expect(apps2[0]?.tip_id).toBe("tip-002");
    });
  });

  describe("buildAffidavitDraft", () => {
    it("includes key elements in the affidavit", () => {
      const draft = buildAffidavitDraft(mockTip);

      expect(draft).toContain("18 U.S.C. § 2703(a)");
      expect(draft).toContain("CSAM");
      expect(draft).toContain("test@example.com");
      expect(draft).toContain("John Doe");
      expect(draft).toContain("file-1");
      expect(draft).toContain("file-3");
      // Should list blocked files count
      expect(draft).toContain("2 files currently blocked");
    });
  });
});
