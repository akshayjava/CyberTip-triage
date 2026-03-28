
import { describe, it, expect, beforeEach, afterEach, mock, type Mock } from "bun:test";
import {
  generateOJJDPReport,
  periodToDateRange,
  reportToCSV,
} from "../tools/reporting/ojjdp_export.js";
import { listTips } from "../db/tips.js";

// Mock listTips module
mock.module("../db/tips.js", () => {
  return {
    listTips: mock(),
  };
});

describe("OJJDP Export Tools", () => {
  const originalEnv = process.env.DB_MODE;

  beforeEach(() => {
    process.env.DB_MODE = "memory";
  });

  afterEach(() => {
    process.env.DB_MODE = originalEnv;
  });

  describe("periodToDateRange", () => {
    it("returns correct dates for Q1", () => {
      const { from, to } = periodToDateRange({ year: 2024, quarter: 1 });
      expect(from.getFullYear()).toBe(2024);
      expect(from.getMonth()).toBe(0); // Jan
      expect(from.getDate()).toBe(1);

      expect(to.getFullYear()).toBe(2024);
      expect(to.getMonth()).toBe(2); // Mar
      expect(to.getDate()).toBe(31);
    });

    it("returns correct dates for Q4", () => {
      const { from, to } = periodToDateRange({ year: 2023, quarter: 4 });
      expect(from.getFullYear()).toBe(2023);
      expect(from.getMonth()).toBe(9); // Oct
      expect(from.getDate()).toBe(1);

      expect(to.getFullYear()).toBe(2023);
      expect(to.getMonth()).toBe(11); // Dec
      expect(to.getDate()).toBe(31);
    });
  });

  describe("generateOJJDPReport (Memory Mode)", () => {
    const mockTips = [
      {
        tip_id: "t1",
        received_at: "2024-02-15T10:00:00Z",
        source: "public_web_form",
        classification: { offense_category: "CSAM" },
        priority: { tier: "IMMEDIATE" },
        status: "closed",
        files: [],
        preservation_requests: [],
      },
      {
        tip_id: "t2",
        received_at: "2024-01-20T10:00:00Z",
        source: "ESP_direct",
        classification: { offense_category: "SEXTORTION" },
        priority: { tier: "URGENT" },
        status: "pending",
        extracted: { victim_age_range: "14-16 (minor)" },
        files: [{ warrant_status: "granted" }],
        preservation_requests: [{ status: "confirmed" }],
      },
      {
        tip_id: "t3",
        received_at: "2024-03-10T10:00:00Z",
        source: "NCMEC_IDS",
        classification: { offense_category: "CSAM" },
        priority: { tier: "PAUSED" },
        status: "referred_out",
        files: [{ ncmec_hash_match: true }],
        preservation_requests: [{ status: "issued" }],
      },
      {
        tip_id: "t4",
        received_at: "2024-04-01T10:00:00Z",
        source: "public_web_form",
        classification: { offense_category: "CSAM" },
        status: "pending",
      },
    ];

    it("aggregates metrics correctly for the given period", async () => {
      const listTipsMock = listTips as unknown as Mock<any>;
      listTipsMock.mockResolvedValue({ tips: mockTips });

      const report = await generateOJJDPReport(
        { year: 2024, quarter: 1 },
        "Test Task Force",
        "TF-123"
      );

      expect(report.task_force_name).toBe("Test Task Force");
      expect(report.period).toEqual({ year: 2024, quarter: 1 });
      expect(report.tips_received_total).toBe(3);
      expect(report.tips_by_category.csam).toBe(2);
      expect(report.tips_by_category.sextortion).toBe(1);
      expect(report.tips_from_public).toBe(1);
      expect(report.tips_from_esp_direct).toBe(1);
      expect(report.tips_from_ncmec).toBe(1);
      expect(report.tips_with_hash_match).toBe(1);
      expect(report.tips_involving_minors).toBe(1);
      expect(report.tips_immediate_tier).toBe(1);
      expect(report.tips_paused_deconfliction).toBe(1);
      expect(report.investigations_initiated).toBe(2);
      expect(report.investigations_completed).toBe(1);
      expect(report.investigations_referred).toBe(1);
      expect(report.preservation_requests_issued).toBe(1);
      expect(report.preservation_requests_fulfilled).toBe(1);
      expect(report.warrants_granted).toBe(1);
    });

    it("handles empty tip list gracefully", async () => {
      const listTipsMock = listTips as unknown as Mock<any>;
      listTipsMock.mockResolvedValue({ tips: [] });

      const report = await generateOJJDPReport(
        { year: 2024, quarter: 1 },
        "TF Name",
        "TF-ID"
      );

      expect(report.tips_received_total).toBe(0);
      expect(report.tips_by_category.csam).toBe(0);
      expect(report.investigations_initiated).toBe(0);
    });
  });

  describe("reportToCSV", () => {
    it("generates valid CSV string", () => {
      const mockReport: any = {
        period: { year: 2024, quarter: 1 },
        generated_at: "2024-04-01T12:00:00Z",
        task_force_name: "Test TF",
        task_force_ojjdp_id: "TF-001",
        tips_received_total: 100,
        tips_by_category: {
          csam: 50,
          child_grooming: 10,
          online_enticement: 5,
          child_sex_trafficking: 5,
          cyber_exploitation: 5,
          sextortion: 10,
          financial_fraud: 5,
          other: 10,
        },
        tips_from_ncmec: 80,
        tips_from_esp_direct: 10,
        tips_from_public: 10,
        tips_with_hash_match: 20,
        tips_aig_csam: 5,
        tips_involving_minors: 30,
        tips_immediate_tier: 15,
        tips_paused_deconfliction: 2,
        investigations_initiated: 60,
        investigations_completed: 40,
        investigations_referred: 10,
        preservation_requests_issued: 25,
        preservation_requests_fulfilled: 20,
        warrants_applied: 5,
        warrants_granted: 4,
        warrants_denied: 1,
        arrests_adults: 2,
        arrests_juveniles: 0,
        prosecutions_initiated: 1,
        convictions: 1,
        forensic_exams_completed: 10,
        devices_examined: 15,
        outreach_events: 3,
        youth_educated: 100,
        adults_educated: 50,
        referrals_to_federal: 5,
        referrals_to_state: 2,
        referrals_to_other_icac: 1,
        referrals_to_ncmec: 2,
        avg_hours_to_assign_p1: 0.5,
        avg_hours_to_assign_p2: 12.0,
        tips_exceeding_sla: 1,
        manual_entry_fields: [],
        data_notes: ["Test Note"],
        case_data_available: false,
      };

      const csv = reportToCSV(mockReport);

      expect(csv).toContain('"Period","Q1 2024"');
      expect(csv).toContain('"Task Force","Test TF"');
      expect(csv).toContain('"Total Tips Received","100"');
      expect(csv).toContain('"CSAM","50"');
      expect(csv).toContain('"Forensic Exams Completed","10","MANUAL ENTRY REQUIRED"');
      expect(csv).toContain('"Test Note"');
    });
  });
});
