import { describe, it, expect, beforeEach, afterEach, mock, afterAll, beforeAll } from "bun:test";

// Mock environment before imports
const originalEnv = { ...process.env };
process.env.DB_MODE = "postgres";

// Mock dependencies
const mockQuery = mock(() => Promise.resolve({ rows: [], rowCount: 1 }));
const mockRelease = mock(() => {});
const mockConnect = mock(() => Promise.resolve({ query: mockQuery, release: mockRelease }));
const mockGetPool = mock(() => ({
  query: mockQuery,
  connect: mockConnect,
}));

// Mock pool module
mock.module("../db/pool.js", () => ({
  getPool: mockGetPool,
}));

// Mock db/tips module to avoid side effects
const mockUpdateFileWarrant = mock(() => Promise.resolve({}));
mock.module("../db/tips.js", () => ({
  updateFileWarrant: mockUpdateFileWarrant,
}));

// Dynamic import to load modules AFTER mocks
const {
  openWarrantApplication,
  recordWarrantGrant,
  recordWarrantDenial,
  submitWarrantToDA,
  getWarrantApplications,
  getWarrantApplicationById,
} = await import("../tools/legal/warrant_workflow.js");

describe("Warrant Workflow (Postgres Mode)", () => {
  const mockTip = {
    tip_id: "tip-sql-1",
    received_at: "2023-01-01T00:00:00Z",
    ncmec_tip_number: "12345",
    classification: { offense_category: "CSAM" },
    extracted: { subjects: [], digital_artifacts: [] },
    files: [
      { file_id: "f1", file_access_blocked: true, media_type: "image/jpeg" }
    ],
    preservation_requests: [],
    audit_trail: []
  } as any;

  beforeEach(() => {
    mockQuery.mockClear();
    mockUpdateFileWarrant.mockClear();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("openWarrantApplication executes INSERT", async () => {
    await openWarrantApplication(mockTip, "officer-1", "DA Smith", "Superior Court");

    expect(mockQuery).toHaveBeenCalled();
    const call = mockQuery.mock.calls[0];
    const sql = call[0] as string;
    const params = call[1] as any[];

    expect(sql).toContain("INSERT INTO warrant_applications");
    expect(sql).toContain("application_id, tip_id, file_ids");
    expect(params[1]).toBe("tip-sql-1");
    expect(params[2]).toContain("f1"); // file_ids JSON
    expect(params[5]).toBe("DA Smith");
    expect(params[6]).toBe("Superior Court");
    expect(params[7]).toBe("officer-1");
  });

  it("submitWarrantToDA executes UPDATE", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ application_id: "app-1", status: "pending_da_review" }],
      rowCount: 1
    });

    await submitWarrantToDA("app-1", "DA Smith");

    const call = mockQuery.mock.calls[0];
    const sql = call[0] as string;
    const params = call[1] as any[];

    expect(sql).toContain("UPDATE warrant_applications");
    expect(sql).toContain("status = 'pending_da_review'");
    expect(sql).toContain("da_name = COALESCE($1, da_name)");
    expect(params[0]).toBe("DA Smith");
    expect(params[3]).toBe("app-1");
  });

  it("recordWarrantGrant executes UPDATE and calls updateFileWarrant", async () => {
    // Setup mock return for the UPDATE
    mockQuery.mockResolvedValueOnce({
      rows: [{
        application_id: "app-1",
        tip_id: "tip-sql-1",
        file_ids: ["f1"],
        status: "granted"
      }],
      rowCount: 1
    });

    await recordWarrantGrant("app-1", "W-123", "Judge Dredd", "sup-1");

    expect(mockQuery).toHaveBeenCalled();
    const call = mockQuery.mock.calls[0];
    const sql = call[0] as string;
    const params = call[1] as any[];

    expect(sql).toContain("UPDATE warrant_applications");
    expect(sql).toContain("status = 'granted'");
    expect(params[0]).toBe("W-123");
    expect(params[1]).toBe("Judge Dredd");
    expect(params[2]).toBe("sup-1");
    expect(params[5]).toBe("app-1");

    // Verify updateFileWarrant was called for the file
    // Need to wait a tick as it might be awaited inside the loop
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockUpdateFileWarrant).toHaveBeenCalled();
    expect(mockUpdateFileWarrant).toHaveBeenCalledWith("tip-sql-1", "f1", "granted", "W-123", "Judge Dredd");
  });

  it("recordWarrantDenial executes UPDATE", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ application_id: "app-1", status: "denied" }],
      rowCount: 1
    });

    await recordWarrantDenial("app-1", "Bad cause");

    const call = mockQuery.mock.calls[0];
    const sql = call[0] as string;
    const params = call[1] as any[];

    expect(sql).toContain("UPDATE warrant_applications");
    expect(sql).toContain("status = 'denied'");
    expect(params[0]).toBe("Bad cause");
    expect(params[3]).toBe("app-1");
  });

  it("getWarrantApplications executes SELECT", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await getWarrantApplications("tip-sql-1");

    const call = mockQuery.mock.calls[0];
    const sql = call[0] as string;
    const params = call[1] as any[];

    expect(sql).toContain("SELECT * FROM warrant_applications");
    expect(sql).toContain("WHERE tip_id = $1");
    expect(params[0]).toBe("tip-sql-1");
  });

  it("getWarrantApplicationById executes SELECT", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await getWarrantApplicationById("app-1");

    const call = mockQuery.mock.calls[0];
    const sql = call[0] as string;
    const params = call[1] as any[];

    expect(sql).toContain("SELECT * FROM warrant_applications");
    expect(sql).toContain("WHERE application_id = $1");
    expect(params[0]).toBe("app-1");
  });
});
