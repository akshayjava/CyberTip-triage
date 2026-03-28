/**
 * NCMEC API Listener
 *
 * Polls the NCMEC CyberTipline API for new reports.
 * Authorized law enforcement agencies receive XML-format reports.
 */

import { enqueueTip } from "./queue.js";
import type { IngestionConfig } from "./config.js";
import { parseNcmecXml, xmlAll } from "../parsers/ncmec_xml.js";

const seenReportIds = new Set<string>();

export async function fetchNcmecReports(
  baseUrl: string,
  apiKey: string,
  since?: string
): Promise<Array<{ report_id: string; xml: string; urgent: boolean }>> {
  const results: Array<{ report_id: string; xml: string; urgent: boolean }> = [];
  let nextUrl: string | null = `${baseUrl}/api/v1/reports?since=${encodeURIComponent(since || "")}&format=xml`;

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/xml"
      }
    });

    if (!response.ok) {
      throw new Error(`NCMEC API error: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();

    // Extract reports using xmlAll.
    // We look for top-level report tags which could be Report or CyberTiplineReport
    const reports = [...xmlAll(text, "Report"), ...xmlAll(text, "CyberTiplineReport")];

    for (const xml of reports) {
      const parsed = parseNcmecXml(xml);
      if (parsed.ncmec_tip_number) {
        results.push({
          report_id: parsed.ncmec_tip_number,
          xml,
          urgent: parsed.ncmec_urgent_flag
        });
      }
    }

    // Handle pagination via Link header (RFC 5988)
    const linkHeader = response.headers.get("Link");
    nextUrl = null;
    if (linkHeader) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
      if (match) {
        nextUrl = match[1];
      }
    }
  }

  return results;
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
