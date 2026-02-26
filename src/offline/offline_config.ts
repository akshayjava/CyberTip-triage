/**
 * Offline / Air-Gap Mode Configuration
 *
 * Central module that determines whether the system is running in
 * offline/air-gap mode and exposes helpers for all subsystems.
 *
 * ── Environment variables ─────────────────────────────────────────────────────
 *
 *   OFFLINE_MODE=true|false
 *     Master switch. When true:
 *       • All cloud LLM providers (Anthropic, OpenAI, Gemini) are rejected
 *       • External network calls are blocked by the network guard
 *       • Watchlist lookups use local hash database files
 *       • SMS alerts (Twilio) are disabled; alerts go to local SMTP or file queue
 *       • Tip ingestion from NCMEC IDS Portal / NCMEC API is disabled
 *         (tips arrive via local file drop or internal email only)
 *
 *   OFFLINE_HASH_DB_PATH=/path/to/hash-databases
 *     Directory containing local hash database files exported from:
 *       - NCMEC hash DB export (ncmec_hashes.csv or ncmec_hashes.bin)
 *       - Project VIC (projectvic_hashes.csv)
 *       - IWF hash list (iwf_hashes.csv)
 *       Obtain exports via your LE liaison — not available publicly.
 *     Default: ./data/offline-hash-db
 *
 *   OFFLINE_ALERT_MODE=smtp|file|both
 *     How to deliver alerts when Twilio SMS is unavailable.
 *       smtp  — internal SMTP server (ALERT_EMAIL_* vars must be set)
 *       file  — write to OFFLINE_ALERT_QUEUE_PATH (default: ./data/alert-queue)
 *       both  — email + file (recommended for redundancy)
 *     Default: both
 *
 *   OFFLINE_ALERT_QUEUE_PATH=/path/to/alert-queue
 *     Directory for file-based alert queue. Each alert is one JSON file.
 *     Default: ./data/alert-queue
 *
 *   OFFLINE_NETWORK_WHITELIST=192.168.1.0/24,10.0.0.0/8
 *     Comma-separated CIDR ranges allowed in offline mode (your LAN / internal services).
 *     Loopback (127.0.0.0/8) and link-local (169.254.0.0/16) are always allowed.
 *     Default: 10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 (all RFC 1918)
 *
 *   OFFLINE_DECONFLICTION_DB_URL
 *     Connection string for an internal deconfliction database.
 *     If not set, the stub provider is used (safe — just returns no conflicts found).
 *     This can be the same PostgreSQL as the main DB or a separate read replica.
 *
 *   OFFLINE_INTERPOL_QUEUE_PATH=/path/to/interpol-queue
 *     Where to write draft Interpol referral packages for later manual submission.
 *     Default: ./data/interpol-queue
 *
 * ── Allowed services in offline mode ─────────────────────────────────────────
 *
 *   • Local PostgreSQL (DB_URL)
 *   • Local Redis (REDIS_HOST)
 *   • Local Ollama / vLLM / llama.cpp (LOCAL_LLM_BASE_URL)
 *   • Internal SMTP server (ALERT_EMAIL_HOST — must be on LAN)
 *   • Internal IMAP server (EMAIL_IMAP_HOST — must be on LAN)
 *   • Internal deconfliction DB (OFFLINE_DECONFLICTION_DB_URL)
 *   • Law enforcement internal network services (IDS Portal on LAN if deployed internally)
 *
 * ── Disallowed in offline mode (blocked by network guard) ─────────────────────
 *
 *   • api.anthropic.com
 *   • api.openai.com
 *   • generativelanguage.googleapis.com
 *   • api.twilio.com
 *   • api.ncmec.org
 *   • icacdatasystem.com
 *   • Any non-RFC-1918 IP / non-localhost hostname
 */

import { existsSync, mkdirSync } from "fs";
import { join } from "path";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OfflineAlertMode = "smtp" | "file" | "both";

export interface OfflineConfig {
  enabled: boolean;
  hashDbPath: string;
  alertMode: OfflineAlertMode;
  alertQueuePath: string;
  interpolQueuePath: string;
  networkWhitelist: string[];
  deconflictionDbUrl: string | undefined;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _config: OfflineConfig | null = null;

export function getOfflineConfig(): OfflineConfig {
  if (_config) return _config;

  const enabled = process.env["OFFLINE_MODE"]?.toLowerCase() === "true";
  const projectRoot = process.cwd();

  const hashDbPath = process.env["OFFLINE_HASH_DB_PATH"]
    ?? join(projectRoot, "data", "offline-hash-db");

  const alertMode = (process.env["OFFLINE_ALERT_MODE"] ?? "both") as OfflineAlertMode;

  const alertQueuePath = process.env["OFFLINE_ALERT_QUEUE_PATH"]
    ?? join(projectRoot, "data", "alert-queue");

  const interpolQueuePath = process.env["OFFLINE_INTERPOL_QUEUE_PATH"]
    ?? join(projectRoot, "data", "interpol-queue");

  // RFC 1918 private ranges + loopback
  const defaultWhitelist = [
    "127.0.0.0/8",
    "::1/128",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
    "fc00::/7",
  ];
  const networkWhitelist = process.env["OFFLINE_NETWORK_WHITELIST"]
    ? [
        ...defaultWhitelist,
        ...process.env["OFFLINE_NETWORK_WHITELIST"].split(",").map((s) => s.trim()).filter(Boolean),
      ]
    : defaultWhitelist;

  _config = {
    enabled,
    hashDbPath,
    alertMode,
    alertQueuePath,
    interpolQueuePath,
    networkWhitelist,
    deconflictionDbUrl: process.env["OFFLINE_DECONFLICTION_DB_URL"],
  };

  return _config;
}

/** Reset singleton — used in tests. */
export function resetOfflineConfig(): void {
  _config = null;
}

/** True when running in offline / air-gap mode. */
export function isOfflineMode(): boolean {
  return getOfflineConfig().enabled;
}

// ── Startup validation ────────────────────────────────────────────────────────

export interface OfflineValidationResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Validate offline mode configuration at startup.
 * Creates required directories and checks for hash DB files.
 */
export function validateOfflineConfig(): OfflineValidationResult {
  const cfg = getOfflineConfig();
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!cfg.enabled) {
    return { ok: true, warnings: [], errors: [] };
  }

  console.log("\n[OFFLINE] ╔═══════════════════════════════════════════════╗");
  console.log("[OFFLINE] ║  AIR-GAP / OFFLINE MODE ACTIVE                ║");
  console.log("[OFFLINE] ╚═══════════════════════════════════════════════╝\n");

  // Validate LLM provider
  const llmProvider = process.env["LLM_PROVIDER"] ?? "anthropic";
  if (!["local", "gemma"].includes(llmProvider)) {
    errors.push(
      `OFFLINE_MODE=true requires LLM_PROVIDER=local or LLM_PROVIDER=gemma, ` +
      `but got LLM_PROVIDER=${llmProvider}. Cloud LLM providers are not allowed in air-gap mode.`
    );
  }

  // Validate LOCAL_LLM_BASE_URL is set and points to local network
  const localUrl = process.env["LOCAL_LLM_BASE_URL"] ?? "http://localhost:11434/v1";
  if (isExternalUrl(localUrl)) {
    errors.push(
      `LOCAL_LLM_BASE_URL="${localUrl}" points to an external host. ` +
      `In offline mode, the LLM server must be on the local network.`
    );
  } else {
    console.log(`[OFFLINE] LLM endpoint: ${localUrl}`);
  }

  // Ensure data directories exist
  for (const dir of [cfg.hashDbPath, cfg.alertQueuePath, cfg.interpolQueuePath]) {
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
        warnings.push(`Created directory: ${dir}`);
      } catch (e) {
        errors.push(`Could not create directory ${dir}: ${String(e)}`);
      }
    }
  }

  // Check hash DB files
  const hashDbFiles = {
    ncmec: join(cfg.hashDbPath, "ncmec_hashes.csv"),
    projectvic: join(cfg.hashDbPath, "projectvic_hashes.csv"),
    iwf: join(cfg.hashDbPath, "iwf_hashes.csv"),
  };

  const missingDbs: string[] = [];
  for (const [name, path] of Object.entries(hashDbFiles)) {
    if (!existsSync(path)) {
      missingDbs.push(name);
    } else {
      console.log(`[OFFLINE] Hash DB found: ${name} (${path})`);
    }
  }

  if (missingDbs.length > 0) {
    warnings.push(
      `Local hash databases not found: ${missingDbs.join(", ")}. ` +
      `Watchlist lookups will return no matches for these databases. ` +
      `Place CSV exports in: ${cfg.hashDbPath}`
    );
  }

  // Validate alert mode
  if (cfg.alertMode === "smtp" || cfg.alertMode === "both") {
    const alertHost = process.env["ALERT_EMAIL_HOST"] ?? "";
    if (!alertHost) {
      warnings.push(
        `OFFLINE_ALERT_MODE includes smtp but ALERT_EMAIL_HOST is not set. ` +
        `Email alerts will be disabled; file-based queue will be used.`
      );
    } else if (isExternalUrl(`http://${alertHost}`)) {
      warnings.push(
        `ALERT_EMAIL_HOST="${alertHost}" may be an external mail server. ` +
        `In offline mode, ensure your SMTP server is on the local network.`
      );
    }
  }

  // Warn about disabled cloud ingestion
  if (process.env["IDS_ENABLED"] === "true") {
    warnings.push(
      "IDS_ENABLED=true but NCMEC IDS Portal (icacdatasystem.com) is an external service. " +
      "In offline mode, configure IDS_STUB_DIR for local file-based tip import."
    );
  }
  if (process.env["NCMEC_API_ENABLED"] === "true") {
    warnings.push(
      "NCMEC_API_ENABLED=true but NCMEC API (api.ncmec.org) is an external service. " +
      "In offline mode, disable NCMEC_API_ENABLED and use local file-based import."
    );
  }

  // Summary
  for (const e of errors) console.error(`[OFFLINE] ERROR: ${e}`);
  for (const w of warnings) console.warn(`[OFFLINE] WARN:  ${w}`);

  if (errors.length === 0) {
    console.log("[OFFLINE] Configuration valid — all external API calls will be blocked.\n");
  }

  return { ok: errors.length === 0, warnings, errors };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRIVATE_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^0\.0\.0\.0$/,
];

/**
 * Returns true if the URL points to an external (non-local) host.
 * Used to validate config values in offline mode.
 */
export function isExternalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return !PRIVATE_PATTERNS.some((re) => re.test(hostname));
  } catch {
    return false; // unparseable — treat as local
  }
}

/**
 * Generate a human-readable offline mode summary for the /health endpoint.
 */
export function getOfflineSummary(): Record<string, unknown> {
  const cfg = getOfflineConfig();
  if (!cfg.enabled) return { offline_mode: false };

  return {
    offline_mode: true,
    hash_db_path: cfg.hashDbPath,
    alert_mode: cfg.alertMode,
    alert_queue_path: cfg.alertQueuePath,
    interpol_queue_path: cfg.interpolQueuePath,
    network_whitelist: cfg.networkWhitelist,
    deconfliction_db: cfg.deconflictionDbUrl ? "configured" : "stub",
  };
}
