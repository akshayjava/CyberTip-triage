/**
 * Tier 3 API Routes
 *
 * GET  /api/bundles/stats          — Bundle dedup summary (queue inflation prevention)
 * GET  /api/bundles/:id            — Canonical bundle tip + duplicate count
 * POST /api/bundles/:id/reprocess  — Force reprocess a canonical bundle tip
 * GET  /api/hash/credentials       — Hash DB credential status (NCMEC/VIC/IWF/Interpol)
 * GET  /api/hash/stats             — Hash match statistics (last 30 days)
 */

import type { Application, Request, Response } from "express";
import { getBundleStats, checkBundleDuplicate } from "../ingestion/bundle_dedup.js";
import { checkHashDBCredentials } from "../tools/hash/check_watchlists.js";
import { listTips, getTipById, getDuplicatesForBundle, getHashMatchStats } from "../db/tips.js";
import type { CyberTip, TipFile } from "../models/index.js";

function wrapAsync(
  fn: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response) => void {
  return (req, res) => {
    fn(req, res).catch((err: unknown) => {
      console.error("[TIER3 ROUTES]", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    });
  };
}

// GET /api/bundles/stats
async function handleBundleStats(_req: Request, res: Response): Promise<void> {
  const stats = await getBundleStats();
  res.json(stats);
}

// GET /api/bundles/:id  — canonical bundle tip detail
async function handleGetBundle(req: Request, res: Response): Promise<void> {
  const tip = await getTipById(req.params["id"] ?? "");
  if (!tip) { res.status(404).json({ error: "Bundle not found" }); return; }
  if (!tip.is_bundled) { res.status(400).json({ error: "Tip is not a bundle" }); return; }

  // Count duplicates that reference this canonical
  // ⚡ Bolt Optimization: Push duplicate filtering to the database to prevent OOM
  // from fetching 10,000 full tip records into memory just to count them.
  const duplicates = await getDuplicatesForBundle(tip.tip_id);

  res.json({
    canonical: tip,
    duplicate_count: duplicates.length,
    total_incident_count: tip.bundled_incident_count ?? 1,
    duplicates_absorbed: duplicates,
  });
}

// GET /api/hash/credentials — show which hash DB creds are configured
async function handleHashCredentials(_req: Request, res: Response): Promise<void> {
  const status = checkHashDBCredentials();
  res.json({
    ...status,
    mode: process.env["TOOL_MODE"] === "real" ? "production" : "stub",
    docs: {
      NCMEC:          "Apply via NCMEC law enforcement liaison. Set NCMEC_API_KEY.",
      Project_VIC:    "Register at projectvic.org (LE only). Set PROJECT_VIC_ENDPOINT, PROJECT_VIC_CERT, PROJECT_VIC_KEY.",
      IWF:            "Apply via iwf.org.uk. Set IWF_API_KEY.",
      Interpol_ICSE:  "Contact Interpol NCB liaison (months to obtain). Set INTERPOL_ICSE_TOKEN, INTERPOL_ICSE_ENDPOINT.",
      AbuseIPDB:      "Register at abuseipdb.com (free for LE). Set ABUSEIPDB_API_KEY.",
    },
    tip: status.readyForProduction
      ? "All hash databases configured. Set TOOL_MODE=real to enable live lookups."
      : `Set TOOL_MODE=real after configuring all credentials. Currently: ${status.missing.join(", ")} missing.`,
  });
}

// GET /api/hash/stats — hash match rates from tip database (last 30 days)
async function handleHashStats(_req: Request, res: Response): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffISO = cutoff.toISOString();

  // ⚡ Bolt Optimization: push aggregation down to the database to prevent fetching 10,000 rows
  const stats = await getHashMatchStats(cutoffISO);

  res.json({
    period_days: 30,
    tips_analyzed: stats.tips_analyzed,
    files_checked: stats.files_checked,
    hash_matches: {
      ncmec: stats.ncmec_matches,
      project_vic: stats.project_vic_matches,
      iwf: stats.iwf_matches,
      interpol_icse: stats.interpol_icse_matches,
      any_db: stats.any_db_match_tips,
    },
    aig_csam_suspected: stats.aig_csam_suspected,
    match_rate_pct: stats.files_checked > 0
      ? ((stats.any_db_match_tips / stats.tips_analyzed) * 100).toFixed(1)
      : "0.0",
    mode: process.env["TOOL_MODE"] === "real" ? "production" : "stub",
    generated_at: new Date().toISOString(),
  });
}

export function mountTier3Routes(app: Application): void {
  app.get("/api/bundles/stats",         wrapAsync(handleBundleStats));
  app.get("/api/bundles/:id",           wrapAsync(handleGetBundle));
  app.get("/api/hash/credentials",      wrapAsync(handleHashCredentials));
  app.get("/api/hash/stats",            wrapAsync(handleHashStats));
  console.log("[TIER3] Routes mounted: /api/bundles/*, /api/hash/*");
}
