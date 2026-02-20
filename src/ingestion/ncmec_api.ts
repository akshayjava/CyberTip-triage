/**
 * NCMEC API Listener
 *
 * Polls the NCMEC CyberTipline API for new reports.
 * Authorized law enforcement agencies receive XML-format reports.
 */

import { enqueueTip } from "./queue.js";
import type { IngestionConfig } from "./config.js";

const seenReportIds = new Set<string>();

async function fetchNcmecReports(
  baseUrl: string,
  apiKey: string,
  since?: string
): Promise<Array<{ report_id: string; xml: string; urgent: boolean }>> {
  // TODO: Implement NCMEC API polling
  // Endpoint: GET /api/v1/reports?since=<ISO>&format=xml
  // Requires NCMEC API key (law enforcement registration required)
  // Returns paginated XML reports
  throw new Error("NCMEC API requires law enforcement API credentials.");
}

export async function startNcmecApiListener(
  config: IngestionConfig
): Promise<() => void> {
  if (!config.ncmec_api.enabled) {
    console.log("[NCMEC-API] Listener disabled");
    return () => {};
  }

  const apiKey = process.env["NCMEC_API_KEY"];
  if (!apiKey) {
    console.error("[NCMEC-API] Missing NCMEC_API_KEY — listener not started");
    return () => {};
  }
  const apiKeyStr: string = apiKey; // narrowed above; alias for async closures

  let lastPollTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  async function poll(): Promise<void> {
    try {
      const reports = await fetchNcmecReports(
        config.ncmec_api.base_url,
        apiKeyStr,
        lastPollTime
      );

      for (const report of reports) {
        if (seenReportIds.has(report.report_id)) continue;
        seenReportIds.add(report.report_id);
        lastPollTime = new Date().toISOString();

        await enqueueTip(
          {
            source: "NCMEC_API",
            raw_content: report.xml,
            content_type: "xml",
            received_at: new Date().toISOString(),
          },
          { priority: report.urgent ? 1 : 2 }
        );

        console.log(`[NCMEC-API] Enqueued report ${report.report_id}`);
      }
    } catch (err) {
      console.error("[NCMEC-API] Poll error:", err);
    }
  }

  await poll();
  const interval = setInterval(() => void poll(), config.ncmec_api.poll_interval_ms);
  return () => clearInterval(interval);
}
