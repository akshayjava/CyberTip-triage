import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadAndExtractTip, IdsSession, IdsTipRef } from "../../ingestion/ids_portal.js";
import { writeFile } from "fs/promises";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

// Mock node-fetch
vi.mock("node-fetch", () => {
  return {
    default: vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "application/zip" },
      arrayBuffer: async () => Buffer.from("dummy zip content"),
    }),
  };
});

// Mock adm-zip
vi.mock("adm-zip", () => {
  return {
    default: class MockAdmZip {
      getEntries() {
        return [{
          entryName: "report.pdf",
          getData: () => Buffer.from("dummy pdf content"),
        }];
      }
    },
  };
});

// Mock pdf-parse
vi.mock("pdf-parse", () => {
  return {
    default: vi.fn().mockResolvedValue({ text: "parsed pdf text" }),
  };
});

// Mock other dependencies to prevent side effects/heavy loads
vi.mock("../../ingestion/queue.js", () => ({
  enqueueTip: vi.fn(),
}));

vi.mock("../../parsers/ncmec_pdf.js", () => ({
  parseNcmecPdfText: vi.fn().mockReturnValue({}),
  validateNcmecPdf: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

vi.mock("../../tools/alerts/alert_tools.js", () => ({
  alertSupervisor: vi.fn(),
}));


describe("downloadAndExtractTip Security", () => {
  const mockSession: IdsSession = {
    cookie: "session=123",
    authenticated_at: Date.now(),
    expires_at: Date.now() + 3600000,
  };

  const mockDownloadDir = "/tmp/downloads";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should throw error for malicious tip_id with path traversal", async () => {
    const maliciousRef: IdsTipRef = {
      tip_id: "../../etc/passwd",
      download_url: "http://example.com/download/123",
      urgent: false,
      esp_name: "Test ESP",
    };

    await expect(downloadAndExtractTip(maliciousRef, mockSession, mockDownloadDir))
      .rejects.toThrow("Invalid tip_id: ../../etc/passwd");

    // Verify writeFile was not called
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("should proceed for valid tip_id", async () => {
    const validRef: IdsTipRef = {
      tip_id: "valid-123",
      download_url: "http://example.com/download/123",
      urgent: false,
      esp_name: "Test ESP",
    };

    const result = await downloadAndExtractTip(validRef, mockSession, mockDownloadDir);

    expect(result).toBe("parsed pdf text");
    expect(writeFile).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining("valid-123.pdf"), expect.any(Buffer));
  });
});
