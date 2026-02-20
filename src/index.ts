import "dotenv/config";

/**
 * CyberTip Triage System — Server Entry Point
 *
 * Starts the Express API server and all ingestion channels.
 * Dashboard is served as a static HTML file.
 */

import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mountApiRoutes } from "./api/routes.js";
import { mountTier2Routes } from "./auth/tier2_routes.js";
import { mountTier3Routes } from "./api/tier3_routes.js";
import { mountSetupRoutes } from "./api/setup_routes.js";
import { mountIngestionRoutes } from "./ingestion/routes.js";
import { authMiddleware } from "./auth/middleware.js";
import { startIdsPoller } from "./ingestion/ids_portal.js";
import { startNcmecApiListener } from "./ingestion/ncmec_api.js";
import { startEmailIngestion } from "./ingestion/email.js";
import { startQueueWorkers } from "./ingestion/queue.js";
import { loadConfig } from "./ingestion/config.js";
import { warnIfAlertsUnconfigured } from "./tools/alerts/alert_tools.js";
import { checkHashDBCredentials } from "./tools/hash/check_watchlists.js";
import { startClusterScheduler, stopClusterScheduler } from "./jobs/cluster_scan.js";
import { hydrateFromDB } from "./compliance/circuit_guide.js";
import { validateLLMConfig, getLLMConfigSummary } from "./llm/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env["PORT"] ?? "3000");

async function main(): Promise<void> {
  const config = loadConfig();
  const app = express();

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // CORS for dashboard dev server
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", process.env["CORS_ORIGIN"] ?? "http://localhost:5173");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-agency-key,x-agency-name,x-signature,x-esp-name");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  // Auth middleware (pass-through unless AUTH_ENABLED=true)
  app.use("/api", authMiddleware);

  // Mount routes
  mountApiRoutes(app);
  mountTier2Routes(app);
  mountTier3Routes(app);
  mountSetupRoutes(app);
  mountIngestionRoutes(app);

  // Serve dashboard — includes mobile.html automatically via static middleware
  app.use("/dashboard", express.static(join(__dirname, "../dashboard")));
  app.get("/mobile", (_req, res) => { res.redirect("/dashboard/mobile.html"); });
  app.get("/tier4", (_req, res) => { res.redirect("/dashboard/tier4.html"); });
  app.get("/quickstart", (_req, res) => { res.redirect("/dashboard/quickstart.html"); });
  app.get("/demo", (_req, res) => { res.redirect("/dashboard/demo.html"); });
  app.get("/status", (_req, res) => { res.redirect("/dashboard/status.html"); });
  app.get("/", (_req, res) => { res.redirect("/dashboard"); });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", ts: new Date().toISOString(), llm: getLLMConfigSummary() });
  });

  // Start server
  app.listen(PORT, () => {
    console.log(`\n🛡  CyberTip Triage`);
    console.log(`   Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`   Mobile:    http://localhost:${PORT}/mobile`);
    console.log(`   Setup:     http://localhost:${PORT}/setup`);
    console.log(`   Demo:      http://localhost:${PORT}/demo`);
    console.log(`   Status:    http://localhost:${PORT}/status`);
    console.log(`   Quickstart:http://localhost:${PORT}/quickstart`);
    console.log(`   Tier4 Admin:http://localhost:${PORT}/tier4`);
    console.log(`   API:       http://localhost:${PORT}/api\n`);

    // Tier 3.1: report hash DB credential status
    const hashStatus = checkHashDBCredentials();
    if (hashStatus.readyForProduction) {
      console.log(`   ✓ Hash DBs: All configured (${hashStatus.configured.join(", ")})`);
    } else {
      console.log(`   ⚠ Hash DBs: ${hashStatus.configured.length > 0 ? hashStatus.configured.join(", ") + " configured; " : ""}` +
        `${hashStatus.missing.join(", ")} missing — stub mode active`);
    }
  });

  // Start ingestion channels
  const cleanups: Array<() => void> = [];
  validateLLMConfig(); // Warn early if API keys are missing for configured provider
  await hydrateFromDB(); // P0 fix: restore persisted circuit precedents + overrides from DB
  cleanups.push(await startIdsPoller(config));
  cleanups.push(await startNcmecApiListener(config));
  cleanups.push(await startEmailIngestion(config));
  await startQueueWorkers();
  warnIfAlertsUnconfigured();
  startClusterScheduler(); // Tier 4.2: nightly pattern clustering

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("\n[SERVER] SIGTERM received — shutting down");
    cleanups.forEach((fn) => fn());
    stopClusterScheduler();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[SERVER] Fatal startup error:", err);
  process.exit(1);
});
