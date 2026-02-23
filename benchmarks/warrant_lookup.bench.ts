import { randomUUID } from "crypto";
import { upsertTip, listTips } from "../src/db/tips.js";
import { openWarrantApplication, getWarrantApplications, getWarrantApplicationById, clearApplicationStore, type WarrantApplication } from "../src/tools/legal/warrant_workflow.js";
import type { CyberTip, TipFile } from "../src/models/index.js";

// Ensure DB_MODE is memory
process.env.DB_MODE = "memory";

function createFakeTip(): CyberTip {
  const tipId = randomUUID();
  const fileId = randomUUID();

  const file: TipFile = {
    file_id: fileId,
    media_type: "image",
    esp_viewed: false,
    esp_viewed_missing: false,
    publicly_available: false,
    warrant_required: true,
    warrant_status: "not_needed",
    file_access_blocked: true,
    ncmec_hash_match: false,
    project_vic_match: false,
    iwf_match: false,
    interpol_icse_match: false,
    aig_csam_suspected: false,
  };

  return {
    tip_id: tipId,
    source: "ESP_direct",
    received_at: new Date().toISOString(),
    raw_body: "test body",
    normalized_body: "test body",
    status: "pending",
    ncmec_urgent_flag: false,
    files: [file],
    preservation_requests: [],
    audit_trail: [],
    reporter: { type: "ESP" },
    jurisdiction_of_tip: { primary: "US_federal", countries_involved: [], interpol_referral_indicated: false, europol_referral_indicated: false },
    is_bundled: false,
  } as unknown as CyberTip;
}

async function main() {
  console.log("Setting up benchmark...");
  clearApplicationStore();

  const tipCount = 500;
  const tips: CyberTip[] = [];
  const appIds: string[] = [];

  console.log(`Generating ${tipCount} tips...`);
  for (let i = 0; i < tipCount; i++) {
    const tip = createFakeTip();
    tips.push(tip);
    await upsertTip(tip);

    // Create warrant application for this tip
    const app = await openWarrantApplication(tip, "officer-123");
    appIds.push(app.application_id);
  }

  // Pick a random target application
  const targetAppId = appIds[Math.floor(Math.random() * appIds.length)];
  console.log(`Target App ID: ${targetAppId}`);

  // Benchmark: Inefficient Lookup
  console.log("Benchmarking inefficient lookup...");
  const startSlow = performance.now();

  // Logic from src/auth/tier2_routes.ts
  let foundSlow: WarrantApplication | undefined;
  // Note: listTips actually returns { tips, total }
  const { tips: listedTips } = await listTips({ limit: 500 });

  for (const tip of listedTips) {
    const apps = getWarrantApplications(tip.tip_id);
    const found = apps.find((a) => a.application_id === targetAppId);
    if (found) {
      foundSlow = found;
      break;
    }
  }

  const endSlow = performance.now();
  const durationSlow = endSlow - startSlow;
  console.log(`Inefficient lookup found: ${foundSlow?.application_id === targetAppId}`);
  console.log(`Inefficient lookup time: ${durationSlow.toFixed(4)} ms`);

  // Benchmark: Optimized Lookup
  console.log("Benchmarking optimized lookup...");
  const startFast = performance.now();
  const foundFast = getWarrantApplicationById(targetAppId);
  const endFast = performance.now();
  const durationFast = endFast - startFast;

  console.log(`Optimized lookup found: ${foundFast?.application_id === targetAppId}`);
  console.log(`Optimized lookup time: ${durationFast.toFixed(4)} ms`);
  console.log(`Speedup: ${(durationSlow / durationFast).toFixed(2)}x`);
}

main().catch(console.error);
