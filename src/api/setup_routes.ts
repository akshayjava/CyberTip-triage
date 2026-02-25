/**
 * Setup & Health API Routes
 *
 * GET  /health          — Basic liveness check
 * GET  /health/detailed — Full integration status for the status dashboard
 * POST /api/setup/save  — Writes .env from web setup wizard
 * GET  /setup           — Serves the setup wizard HTML
 * GET  /demo            — Serves the demo mode HTML
 * GET  /status          — Serves the status page HTML
 */

import type { Application, Request, Response } from "express";
import { writeFile, access, readdir, stat } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { requireRole } from "../auth/middleware.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../");
const DASHBOARD = join(ROOT, "dashboard");

// ── Page routes ───────────────────────────────────────────────────────────────

export function mountSetupRoutes(app: Application): void {
  // Serve setup wizard
  app.get("/setup", (_req, res) =>
    res.sendFile(join(DASHBOARD, "setup.html"))
  );

  // Serve demo mode
  app.get("/demo", (_req, res) =>
    res.sendFile(join(DASHBOARD, "demo.html"))
  );

  // Serve status page
  app.get("/status", (_req, res) =>
    res.sendFile(join(DASHBOARD, "status.html"))
  );

  // Serve quick-start card
  app.get("/quickstart", (_req, res) =>
    res.sendFile(join(DASHBOARD, "quickstart.html"))
  );

  // ── Basic health check ────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      ts: new Date().toISOString(),
      version: "0.1.0",
    });
  });

  // ── Detailed health check ─────────────────────────────────────────────────
  app.get("/health/detailed", async (_req, res) => {
    const health = await getDetailedHealth();
    res.json(health);
  });

  // ── Setup wizard — save configuration ────────────────────────────────────
  app.post("/api/setup/save", requireRole("admin"), async (req: Request, res: Response) => {
    try {
      const config = req.body as SetupConfig;
      const validation = validateSetupConfig(config);

      if (!validation.valid) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const envContent = generateEnvFile(config);

      // Write .env with restrictive permissions (owner-only)
      const envPath = join(ROOT, ".env");
      await writeFile(envPath, envContent, { mode: 0o600 });

      // Create test data directory and sample stub tip
      await ensureTestData(config);

      console.log(`[SETUP] Configuration saved for agency: ${config.agencyName}`);

      res.json({
        success: true,
        message: "Configuration saved",
        mode: config.mode,
        next: config.mode === "docker" ? "Run ./start.sh" : "Run npm start",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[SETUP] Save failed:", msg);
      res.status(500).json({ error: `Save failed: ${msg}` });
    }
  });

  console.log("[ROUTES] Setup routes mounted");
}

// ── Detailed health check ─────────────────────────────────────────────────────

async function getDetailedHealth(): Promise<Record<string, unknown>> {
  const health: Record<string, unknown> = {
    api: "ok",
    ts: new Date().toISOString(),
  };

  const { getLLMConfigSummary } = await import("../llm/index.js");
  const llmConfig = getLLMConfigSummary();
  health["llm"] = llmConfig;

  // Check API key presence for active provider
  const provider = llmConfig.provider;
  const keyPresent = (
    (provider === "anthropic" && !!process.env["ANTHROPIC_API_KEY"]) ||
    (provider === "openai"    && !!process.env["OPENAI_API_KEY"])    ||
    (provider === "gemini"    && !!process.env["GEMINI_API_KEY"])    ||
    (provider === "local")  // local needs no key
  );
  health["llm_key"] = keyPresent ? "ok" : "missing";

  // Database
  const dbMode = process.env["DB_MODE"] ?? "memory";
  if (dbMode === "postgres") {
    try {
      const { getPool } = await import("../db/pool.js");
      await getPool().query("SELECT 1");
      health["db"] = "ok";
    } catch {
      health["db"] = "error";
    }
  } else {
    health["db"] = "memory";
  }

  // Queue
  const queueMode = process.env["QUEUE_MODE"] ?? "memory";
  health["queue"] = queueMode === "bullmq" ? "ok" : "memory";

  // IDS Portal
  health["ids_enabled"] = process.env["IDS_ENABLED"] === "true";
  health["ids_credentials"] =
    !!(process.env["IDS_EMAIL"] && process.env["IDS_PASSWORD"]);

  // NCMEC API
  health["ncmec_api_enabled"] = process.env["NCMEC_API_ENABLED"] === "true";
  health["ncmec_api_key"] = !!process.env["NCMEC_API_KEY"];

  // Email
  health["email_enabled"] = process.env["EMAIL_ENABLED"] === "true";
  health["email_credentials"] = !!(
    process.env["EMAIL_USER"] && process.env["EMAIL_PASSWORD"]
  );
  health["email_user"] = process.env["EMAIL_USER"];

  // External APIs
  health["project_vic"] = !!process.env["PROJECT_VIC_API_KEY"];
  health["iwf"] = !!process.env["IWF_API_KEY"];
  health["deconfliction"] = !!process.env["RISSAFE_API_KEY"];
  health["interpol"] = !!process.env["INTERPOL_ICSE_KEY"];

  // Stub directory
  const stubDir =
    process.env["IDS_STUB_DIR"] ?? join(ROOT, "test-data", "ids-stubs");
  try {
    await access(stubDir);
    const files = await readdir(stubDir);
    const tipFiles = files.filter(
      (f) => f.endsWith(".txt") || f.endsWith(".pdf.txt")
    );
    health["stub_dir_exists"] = true;
    health["stub_count"] = tipFiles.length;
  } catch {
    health["stub_dir_exists"] = false;
    health["stub_count"] = 0;
  }

  return health;
}

// ── Setup config types ────────────────────────────────────────────────────────

interface SetupConfig {
  agencyName: string;
  agencyState: string;
  contactEmail: string;
  port: string;
  mode: "docker" | "node";
  dbUrl?: string;
  apiKey: string;
  idsEnabled: boolean;
  idsEmail?: string;
  idsPassword?: string;
  ncmecEnabled: boolean;
  ncmecKey?: string;
  emailEnabled: boolean;
  emailHost?: string;
  emailUser?: string;
  emailPass?: string;
  vicKey?: string;
  iwfKey?: string;
  deconKey?: string;
  /** Forensics platform identifiers enabled at this agency (e.g. ["GRIFFEYE","FTK"]). GENERIC always included. */
  forensicsTools?: string[];
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

function validateSetupConfig(config: SetupConfig): ValidationResult {
  if (!config.agencyName?.trim()) {
    return { valid: false, error: "Agency name is required" };
  }
  if (/[\r\n"]/.test(config.agencyName)) {
    return { valid: false, error: "Agency name cannot contain newlines or double quotes" };
  }

  if (!config.agencyState?.trim()) {
    return { valid: false, error: "State is required" };
  }
  if (/[\r\n"]/.test(config.agencyState)) {
    return { valid: false, error: "State cannot contain newlines or double quotes" };
  }

  if (config.contactEmail && /[\r\n"]/.test(config.contactEmail)) {
    return { valid: false, error: "Contact email cannot contain newlines or double quotes" };
  }

  if (!["docker", "node"].includes(config.mode)) {
    return { valid: false, error: "Mode must be docker or node" };
  }
  const port = parseInt(config.port);
  if (isNaN(port) || port < 1024 || port > 65535) {
    return { valid: false, error: "Port must be between 1024 and 65535" };
  }
  return { valid: true };
}

// ── .env file generator ───────────────────────────────────────────────────────

function generateEnvFile(c: SetupConfig): string {
  const secret = generateSecret();
  const dbPassword = generateSecret(20);
  const redisPassword = generateSecret(20);

  const dbUrl =
    c.dbUrl ||
    (c.mode === "docker"
      ? `postgresql://cybertip:${dbPassword}@postgres:5432/cybertip`
      : "postgresql://cybertip:CHANGEME@localhost:5432/cybertip");

  return `# CyberTip Triage — Configuration
# Agency: ${c.agencyName} (${c.agencyState})
# Generated by Setup Wizard: ${new Date().toISOString()}
# ⚠ KEEP THIS FILE SECURE — Contains credentials. Never commit to version control.

# ── Agency ────────────────────────────────────────────────────────────────────
AGENCY_NAME="${c.agencyName}"
AGENCY_STATE="${c.agencyState.toUpperCase()}"
CONTACT_EMAIL="${c.contactEmail || ""}"

# ── Server ────────────────────────────────────────────────────────────────────
PORT=${c.port || 3000}
NODE_ENV=production
CORS_ORIGIN=http://localhost:${c.port || 3000}

# ── Anthropic AI ──────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=${c.apiKey || "REPLACE_WITH_KEY"}

# ── Database ──────────────────────────────────────────────────────────────────
DB_MODE=postgres
DATABASE_URL=${dbUrl}
DB_PASSWORD=${dbPassword}

# ── Queue ─────────────────────────────────────────────────────────────────────
QUEUE_MODE=${c.mode === "docker" ? "bullmq" : "memory"}
REDIS_HOST=${c.mode === "docker" ? "redis" : "localhost"}
REDIS_PORT=6379
REDIS_PASSWORD=${redisPassword}
QUEUE_CONCURRENCY=5

# ── NCMEC IDS Portal ──────────────────────────────────────────────────────────
IDS_ENABLED=${c.idsEnabled}
IDS_BASE_URL=https://www.icacdatasystem.com
IDS_POLL_INTERVAL_MS=60000
IDS_DOWNLOAD_DIR=/tmp/cybertip-ids
IDS_STUB_DIR=./test-data/ids-stubs
${
  c.idsEnabled && c.idsEmail
    ? `IDS_EMAIL=${c.idsEmail}\nIDS_PASSWORD=${c.idsPassword ?? ""}`
    : `# IDS_EMAIL=investigator@agency.gov\n# IDS_PASSWORD=`
}

# ── NCMEC API ─────────────────────────────────────────────────────────────────
NCMEC_API_ENABLED=${c.ncmecEnabled}
NCMEC_API_BASE_URL=https://api.ncmec.org
NCMEC_POLL_INTERVAL_MS=30000
${c.ncmecEnabled && c.ncmecKey ? `NCMEC_API_KEY=${c.ncmecKey}` : `# NCMEC_API_KEY=`}

# ── Email Ingestion ───────────────────────────────────────────────────────────
EMAIL_ENABLED=${c.emailEnabled}
EMAIL_IMAP_PORT=993
EMAIL_TLS=true
${
  c.emailEnabled && c.emailHost
    ? `EMAIL_IMAP_HOST=${c.emailHost}\nEMAIL_USER=${c.emailUser ?? ""}\nEMAIL_PASSWORD=${c.emailPass ?? ""}`
    : `# EMAIL_IMAP_HOST=imap.agency.gov\n# EMAIL_USER=\n# EMAIL_PASSWORD=`
}

# ── VPN Portal ────────────────────────────────────────────────────────────────
VPN_PORTAL_ENABLED=true
VPN_PORTAL_PORT=3001
VPN_PORTAL_SECRET=${secret}

# ── Inter-Agency ──────────────────────────────────────────────────────────────
INTER_AGENCY_ENABLED=false
# INTER_AGENCY_API_KEYS=key1,key2

# ── External APIs ─────────────────────────────────────────────────────────────
${c.vicKey ? `PROJECT_VIC_API_KEY=${c.vicKey}` : `# PROJECT_VIC_API_KEY=`}
${c.iwfKey ? `IWF_API_KEY=${c.iwfKey}` : `# IWF_API_KEY=`}
${c.deconKey ? `RISSAFE_API_KEY=${c.deconKey}` : `# RISSAFE_API_KEY=`}
# INTERPOL_ICSE_KEY=

# ── Forensics Tool Handoff ─────────────────────────────────────────────────────
# Platforms licensed and deployed at this agency. Only these appear in the
# Forensics Handoff UI. GENERIC is always available as a fallback.
FORENSICS_ENABLED_PLATFORMS=${buildForensicsPlatformsValue(c.forensicsTools)}
`;
}

const VALID_FORENSICS_PLATFORMS = ["GRIFFEYE", "AXIOM", "FTK", "CELLEBRITE", "ENCASE", "GENERIC"] as const;

function buildForensicsPlatformsValue(tools?: string[]): string {
  const selected = (tools ?? [])
    .map((t) => t.toUpperCase())
    .filter((t) => (VALID_FORENSICS_PLATFORMS as readonly string[]).includes(t));

  // GENERIC is always included
  if (!selected.includes("GENERIC")) selected.push("GENERIC");
  return selected.join(",");
}

function generateSecret(length = 32): string {
  return createHash("sha256")
    .update(Math.random().toString() + Date.now().toString())
    .digest("hex")
    .slice(0, length);
}

// ── Test data setup ───────────────────────────────────────────────────────────

async function ensureTestData(config: SetupConfig): Promise<void> {
  const { mkdir, writeFile: wf } = await import("fs/promises");
  const stubDir = join(ROOT, "test-data", "ids-stubs");
  await mkdir(stubDir, { recursive: true });

  const sampleTip = `NCMEC CyberTipline Report
Report Number: TEST-SETUP-001
NOT URGENT

Section A: Electronic Service Provider Information
Reporting ESP: SETUP_WIZARD_TEST
Incident Date: ${new Date().toISOString().split("T")[0]}
Subject Email: test.subject@example.invalid
Subject Username: setup_test_user
Subject IP Address: 192.0.2.100

Uploaded File 1:
Filename: test_file.jpg
File Viewed by Reporting ESP: Yes
Publicly Available: No
MD5: aabbccddaabbccddaabbccddaabbccdd

Description: [SETUP TEST TIP - NOT A REAL INCIDENT]
This is an automatically generated test tip created during setup
to verify that the processing pipeline is working correctly.
This tip does not represent a real incident, a real subject, or
real evidence. It should be scored as LOW priority with MONITOR tier.

Section B: Geolocation
Country: United States
State: ${config.agencyState}
City: Test City
ISP: Test ISP Inc.

Section C: Additional Information
Notes: Sample tip created by CyberTip Triage setup wizard.
Delete this file from test-data/ids-stubs/ when done testing.
`;

  await wf(join(stubDir, "TEST-SETUP-001.txt"), sampleTip);
}
