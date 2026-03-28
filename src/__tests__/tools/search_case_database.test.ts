import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { searchCaseDatabase } from "../../tools/database/search_case_database.js";

// Mock the pool
const mockQuery = mock();
const mockPool = {
  query: mockQuery,
};

// Mock the module
mock.module("../../db/pool.js", () => ({
  getPool: () => mockPool,
}));

describe("searchCaseDatabase (Real Mode)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, TOOL_MODE: "real" };
    mockQuery.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("searches by hash correctly", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tip_id: "tip-1",
          tip_status: "triaged",
          received_at: new Date("2023-01-01"),
          offense_category: "CSAM",
          subject_name: "John Doe",
        },
      ],
    });

    const result = await searchCaseDatabase("hash", "some-hash");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain("FROM cyber_tips ct");
    expect(sql).toContain("JOIN tip_files tf");
    expect(sql).toContain("tf.hash_md5    = $1");
    expect(result.data.results[0].tip_id).toBe("tip-1");
  });

  it("searches by subject name (fuzzy)", async () => {
     mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tip_id: "tip-2",
          matched_value: "Johnathan Doe",
          relevance_score: "0.85",
          tip_status: "pending",
          received_at: new Date("2023-01-02"),
          offense_category: "Grooming",
        },
      ],
    });

    const result = await searchCaseDatabase("subject_name", "John", true);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain("similarity(subj->>'name', $1)");
    expect(result.data.results[0].relevance_score).toBe(0.85);
  });

  it("searches by subject name (exact)", async () => {
    mockQuery.mockResolvedValueOnce({
     rows: [
       {
         tip_id: "tip-2b",
         matched_value: "John Doe",
         tip_status: "pending",
         received_at: new Date("2023-01-02"),
         offense_category: "Grooming",
       },
     ],
   });

   const result = await searchCaseDatabase("subject_name", "John Doe", false);

   expect(mockQuery).toHaveBeenCalledTimes(1);
   const sql = mockQuery.mock.calls[0][0];
   expect(sql).toContain("lower(subj->>'name') = lower($1)");
   expect(result.data.results[0].relevance_score).toBe(1.0);
 });

  it("searches by IP (exact)", async () => {
     mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tip_id: "tip-3",
          matched_value: "1.2.3.4",
          relevance_score: "1.0",
          tip_status: "closed",
          received_at: new Date("2023-01-03"),
          offense_category: null,
          subject_name: null,
        },
      ],
    });

    const result = await searchCaseDatabase("ip", "1.2.3.4", false);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain("jsonb_array_elements(ct.extracted->'ip_addresses')");
    expect(sql).toContain("lower(elem->>'value') = lower($1)");
    expect(result.data.results[0].matched_value).toBe("1.2.3.4");
  });

  it("searches by IP (fuzzy)", async () => {
     mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tip_id: "tip-4",
          matched_value: "1.2.3.4",
          relevance_score: "0.9",
          tip_status: "closed",
          received_at: new Date("2023-01-03"),
          offense_category: null,
          subject_name: null,
        },
      ],
    });

    const result = await searchCaseDatabase("ip", "1.2.3.4", true);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain("similarity(elem->>'value', $1)");
  });

  it("falls back to ILIKE for unknown entity type", async () => {
     mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tip_id: "tip-5",
          tip_status: "triaged",
          received_at: new Date("2023-01-04"),
          offense_category: "Other",
          subject_name: null,
        },
      ],
    });

    const result = await searchCaseDatabase("unknown_type", "something");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain("ct.extracted::text ILIKE $1");
    expect(result.data.results[0].relevance_score).toBe(0.5);
  });
});
