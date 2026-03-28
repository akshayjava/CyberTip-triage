import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock queue to avoid loading models/zod
vi.mock("../ingestion/queue.js", () => ({
  enqueueTip: vi.fn(),
}));

// Mock models/index to avoid loading deeper dependencies
vi.mock("../models/index.js", () => ({}));
vi.mock("zod", () => ({ z: { object: () => ({ parse: () => {} }), string: () => ({}) } }));

import { fetchNcmecReports } from "../ingestion/ncmec_api.js";

const BASE_URL = "https://example.com";
const API_KEY = "test-key";

describe("fetchNcmecReports", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches a single page of reports", async () => {
    const xmlResponse = `
      <Reports>
        <Report>
          <ReportId>1001</ReportId>
          <IsUrgent>true</IsUrgent>
        </Report>
        <Report>
          <ReportId>1002</ReportId>
          <IsUrgent>false</IsUrgent>
        </Report>
      </Reports>
    `;

    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => xmlResponse,
      headers: new Headers(),
    });

    const reports = await fetchNcmecReports(BASE_URL, API_KEY);

    expect(reports).toHaveLength(2);
    expect(reports[0].report_id).toBe("1001");
    expect(reports[0].urgent).toBe(true);
    expect(reports[1].report_id).toBe("1002");
    expect(reports[1].urgent).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/reports?since=&format=xml"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Authorization": "Bearer test-key"
        })
      })
    );
  });

  it("handles pagination via Link header", async () => {
    const page1Xml = `
      <Reports>
        <Report><ReportId>1001</ReportId></Report>
      </Reports>
    `;
    const page2Xml = `
      <Reports>
        <Report><ReportId>1002</ReportId></Report>
      </Reports>
    `;

    const fetchMock = global.fetch as any;

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => page1Xml,
        headers: new Headers({
          "Link": `<${BASE_URL}/api/v1/reports?page=2>; rel="next"`
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => page2Xml,
        headers: new Headers(),
      });

    const reports = await fetchNcmecReports(BASE_URL, API_KEY);

    expect(reports).toHaveLength(2);
    expect(reports[0].report_id).toBe("1001");
    expect(reports[1].report_id).toBe("1002");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${BASE_URL}/api/v1/reports?page=2`, expect.anything());
  });

  it("handles CyberTiplineReport tag variant", async () => {
    const xmlResponse = `
      <CyberTiplineReports>
        <CyberTiplineReport>
          <ReportId>2001</ReportId>
        </CyberTiplineReport>
      </CyberTiplineReports>
    `;

    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => xmlResponse,
      headers: new Headers(),
    });

    const reports = await fetchNcmecReports(BASE_URL, API_KEY);
    expect(reports).toHaveLength(1);
    expect(reports[0].report_id).toBe("2001");
  });

  it("throws on API error", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    await expect(fetchNcmecReports(BASE_URL, API_KEY)).rejects.toThrow("NCMEC API error: 401 Unauthorized");
  });
});
