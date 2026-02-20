/**
 * Demo Data Seeder
 *
 * Posts synthetic tips to the running app via its public intake API
 * before screen recording begins. This ensures the dashboard has
 * realistic-looking content during the demo.
 *
 * All data is synthetic/fictional. No real CSAM content.
 * IP addresses are RFC 5737 documentation ranges (192.0.2.x).
 * Names are clearly fictional.
 */

import { DEFAULT_CONFIG } from "./types.js";
import { createHmac } from "crypto";

// ── Synthetic tip data ────────────────────────────────────────────────────────

const SYNTHETIC_TIPS = [
  {
    description:
      "PRIORITY - Received report of adult male sending explicit images to what appears to be a minor via gaming platform. " +
      "Subject username: DarkWolf_Gaming99. Platform: StreamZone. " +
      "Victim states contact began approximately 3 weeks ago via in-game messaging. " +
      "Subject requested victim keep communications private. Images described as explicit adult content. " +
      "Victim age: 14. Reporting party: victim's parent. " +
      "IP address associated with account: 192.0.2.45. " +
      "Request immediate preservation of account data.",
    source: "NCMEC_IDS",
    urgent: true,
  },
  {
    description:
      "Report of suspected CSAM distribution via peer-to-peer network. " +
      "Hash values flagged by automated detection: md5:a1b2c3d4e5f6789012345678abcdef01. " +
      "Account email: fictional.test.account@example.net. " +
      "Account registered IP: 192.0.2.112. " +
      "Multiple files flagged across 6-week period. " +
      "ESP (PhotoStream) indicates files were not reviewed prior to report. " +
      "Requesting law enforcement action per 18 U.S.C. 2258A.",
    source: "NCMEC_IDS",
    urgent: false,
  },
  {
    description:
      "SEXTORTION - Minor victim (age 16) reports unknown subject obtained intimate images through deception. " +
      "Subject contacted victim via FaceSnap with username JTaylor_official. " +
      "Subject now threatening to distribute images unless victim sends payment via cryptocurrency. " +
      "Victim is distressed, parents have been notified. " +
      "Bitcoin address mentioned: 1ExAmPlEbItCoInAdDrEsS0000000000. " +
      "Communications ongoing — victim safety is primary concern. " +
      "Victim's school: Washington Middle School, IL.",
    source: "public_web_form",
    urgent: false,
  },
  {
    description:
      "Interpol referral - Operation Crossroads follow-up. " +
      "Subject identified in international investigation, believed to be residing in United States. " +
      "Subject alias: Michael R. (full name withheld). " +
      "Known email accounts: mtest.fictional@protonmail.com. " +
      "Associated IP ranges: 192.0.2.200 - 192.0.2.220. " +
      "Foreign agency requests coordination per MLAT agreement. " +
      "Canadian RCMP case reference: RC-2025-FICTIONAL-001. " +
      "Evidence preservation requested for potential extradition proceedings.",
    source: "inter_agency",
    urgent: false,
  },
  {
    description:
      "Report received from school counselor. Student disclosed that an adult they met online " +
      "has been sending them 'special photos' and asking for photos in return. " +
      "Student age: 13. School: Lincoln Elementary, OH. " +
      "Subject contacted through education platform EduConnect. " +
      "Subject claims to be a 'talent scout'. " +
      "Student's device may contain evidence. Parents notified. " +
      "Counselor requests guidance on preservation and next steps. " +
      "Reporting party: School District Compliance Office.",
    source: "public_web_form",
    urgent: false,
  },
  // Bundle cluster: same viral incident, multiple reporters
  {
    description:
      "User reports encountering explicit content involving minors shared in public Discord server. " +
      "Server name: GamingHub2025 (ID: 999888777666). " +
      "Content was screenshot and reported by multiple community members. " +
      "Approximate time of incident: 2025-11-15T18:30:00Z. " +
      "Hash of reported image: sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890. " +
      "Discord has been notified but content may still be accessible.",
    source: "public_web_form",
    urgent: false,
  },
  {
    description:
      "Follow-up report: same Discord incident as previous report. " +
      "Additional reporter witnessed same content in GamingHub2025 server. " +
      "Hash: sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890. " +
      "Incident time: 2025-11-15T18:30:00Z. Discord server ID: 999888777666.",
    source: "public_web_form",
    urgent: false,
  },
  {
    description:
      "NCMEC Report #TN-FICTIONAL-2025-00123. " +
      "ESP: StreamCloud Inc. " +
      "Uploaded file flagged by PhotoDNA hash match against NCMEC database. " +
      "File: image_001.jpg (not viewed by ESP). " +
      "Account holder email: testaccount.fictional@streamcloud-example.net. " +
      "Account creation IP: 192.0.2.77. " +
      "Account verified phone: +1-555-0100 (fictional). " +
      "ESP requests law enforcement action. Section A flag: ESP DID NOT VIEW FILE.",
    source: "NCMEC_IDS",
    urgent: false,
  },
];

// ── Seed function ─────────────────────────────────────────────────────────────

export async function seedDemoData(
  appUrl: string = DEFAULT_CONFIG.app_url
): Promise<{ seeded: number; failed: number }> {
  console.log(`[SEED] Seeding ${SYNTHETIC_TIPS.length} synthetic tips to ${appUrl}...`);

  let seeded = 0;
  let failed = 0;

  for (const tip of SYNTHETIC_TIPS) {
    try {
      const endpoint =
        tip.source === "NCMEC_IDS"
          ? `${appUrl}/intake/portal`
          : `${appUrl}/intake/public`;

      const body =
        tip.source === "NCMEC_IDS"
          ? {
            content: tip.description,
            content_type: "text",
            esp_name: "NCMEC",
          }
          : { description: tip.description };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Portal requires HMAC — in dev mode the secret is "dev-secret"
      // We skip HMAC for public endpoint; portal endpoint uses dev bypass
      if (tip.source === "NCMEC_IDS") {
        // In dev mode auth is disabled — just add a dummy signature
        headers["x-signature"] = "dev-bypass";
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (response.ok) {
        seeded++;
        // Stagger submissions to avoid overwhelming the queue
        await sleep(800);
      } else {
        const err = await response.text();
        console.warn(`[SEED] Tip failed (${response.status}): ${err.slice(0, 100)}`);
        failed++;
      }
    } catch (err) {
      console.warn(`[SEED] Network error: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`[SEED] Done: ${seeded} seeded, ${failed} failed`);

  // Wait for pipeline to process before recording begins
  if (seeded > 0) {
    console.log("[SEED] Waiting 15s for pipeline to process tips...");
    await sleep(15_000);
  }

  return { seeded, failed };
}

// ── Standalone run ────────────────────────────────────────────────────────────

const isMain = process.argv[1]?.endsWith("seed.ts") ||
  process.argv[1]?.endsWith("seed.js");
if (isMain) {
  const appUrl = process.env["APP_URL"] ?? "http://localhost:3000";
  seedDemoData(appUrl)
    .then(({ seeded }) => {
      console.log(`[SEED] ${seeded} tips submitted. Dashboard should now show populated queue.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[SEED] Failed:", err);
      process.exit(1);
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
