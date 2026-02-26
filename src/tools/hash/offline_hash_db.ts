/**
 * Offline Hash Database
 *
 * Local flat-file hash lookup for air-gap deployments.
 * Replaces live NCMEC / Project VIC / IWF / Interpol API calls when
 * OFFLINE_MODE=true or TOOL_MODE=offline.
 *
 * ── Supported formats ────────────────────────────────────────────────────────
 *
 *   CSV (default):
 *     Each file: one hash per line (optionally with metadata)
 *
 *     ncmec_hashes.csv
 *       sha256hash,series_name,victim_identified,victim_country,ncmec_category
 *       a1b2c3d4...,Unknown Series,false,,A
 *       e5f6a7b8...,Known Series Name,true,US,B
 *
 *     projectvic_hashes.csv
 *       sha256hash,series_name,victim_country,project_vic_series
 *       ...
 *
 *     iwf_hashes.csv
 *       sha256hash,iwf_category   (A/B/C)
 *       ...
 *
 *     interpol_icse_hashes.csv
 *       sha256hash,interpol_case_ref,victim_country
 *       ...
 *
 *     tor_exit_nodes.txt        (one IP per line)
 *     known_vpns.txt            (one IP per line)
 *     crypto_blocklist.txt      (one address per line)
 *
 * ── How to populate ──────────────────────────────────────────────────────────
 *
 *   1. Export from NCMEC hash portal (law enforcement access required)
 *   2. Export from Project VIC (requires LE vetting at projectvic.org)
 *   3. Export from IWF (via IWF LE liaison)
 *   4. Export from Interpol ICSE (via NCB/INTERPOL liaison)
 *   5. Download Tor exit nodes from collector.torproject.org (before going air-gap)
 *   6. Place all files in OFFLINE_HASH_DB_PATH (default: ./data/offline-hash-db)
 *
 * ── Performance ──────────────────────────────────────────────────────────────
 *
 *   Files are loaded into memory Sets on first access and cached.
 *   Re-read from disk on SIGHUP (graceful reload).
 *
 *   Typical sizes:
 *     NCMEC:       ~2M hashes  → ~200 MB RAM after parsing
 *     Project VIC: ~500K hashes → ~50 MB RAM
 *     IWF:         ~1M hashes  → ~100 MB RAM
 *     Tor exits:   ~7K IPs     → negligible
 *
 *   For very large DBs (>5M entries), consider SQLite instead of CSV.
 *   Set OFFLINE_HASH_DB_FORMAT=sqlite to use ./data/offline-hash-db/hashes.db
 */

import { createReadStream, existsSync } from "fs";
import { createInterface } from "readline";
import { join } from "path";
import { getOfflineConfig } from "../../offline/offline_config.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OfflineHashMatch {
  matched: boolean;
  database: string;
  series_name?: string;
  victim_identified?: boolean;
  victim_country?: string;
  iwf_category?: "A" | "B" | "C";
  interpol_case_ref?: string;
  project_vic_series?: string;
  ncmec_category?: string;
}

export interface OfflineHashDbStats {
  ncmec_count: number;
  projectvic_count: number;
  iwf_count: number;
  interpol_count: number;
  tor_exits_count: number;
  loaded_at: string | null;
  db_path: string;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

interface NcmecEntry {
  series_name?: string;
  victim_identified: boolean;
  victim_country?: string;
  category?: string;
}

interface IwfEntry {
  category: "A" | "B" | "C";
}

interface InterpolEntry {
  case_ref?: string;
  victim_country?: string;
}

interface ProjectVicEntry {
  series_name?: string;
  victim_country?: string;
  series_id?: string;
}

let _ncmec    = new Map<string, NcmecEntry>();
let _projectvic = new Map<string, ProjectVicEntry>();
let _iwf      = new Map<string, IwfEntry>();
let _interpol  = new Map<string, InterpolEntry>();
let _torExits = new Set<string>();
let _knownVpns = new Set<string>();
let _cryptoBlocklist = new Set<string>();
let _loadedAt: string | null = null;
let _loaded = false;

// ── Loader ───────────────────────────────────────────────────────────────────

async function loadDatabases(): Promise<void> {
  if (_loaded) return;

  const cfg = getOfflineConfig();
  const dbPath = cfg.hashDbPath;

  if (!existsSync(dbPath)) {
    console.warn(`[OFFLINE HASH DB] Directory not found: ${dbPath} — all lookups will return no match`);
    _loaded = true;
    return;
  }

  await Promise.all([
    loadNcmecCsv(join(dbPath, "ncmec_hashes.csv")),
    loadProjectVicCsv(join(dbPath, "projectvic_hashes.csv")),
    loadIwfCsv(join(dbPath, "iwf_hashes.csv")),
    loadInterpolCsv(join(dbPath, "interpol_icse_hashes.csv")),
    loadSimpleSet(join(dbPath, "tor_exit_nodes.txt"), _torExits),
    loadSimpleSet(join(dbPath, "known_vpns.txt"), _knownVpns),
    loadSimpleSet(join(dbPath, "crypto_blocklist.txt"), _cryptoBlocklist),
  ]);

  _loadedAt = new Date().toISOString();
  _loaded = true;

  const stats = getStats();
  console.log(
    `[OFFLINE HASH DB] Loaded: NCMEC=${stats.ncmec_count} ` +
    `ProjectVIC=${stats.projectvic_count} IWF=${stats.iwf_count} ` +
    `Interpol=${stats.interpol_count} TorExits=${stats.tor_exits_count}`
  );
}

/** Force reload from disk (call on SIGHUP). */
export function reloadDatabases(): void {
  _ncmec = new Map();
  _projectvic = new Map();
  _iwf = new Map();
  _interpol = new Map();
  _torExits = new Set();
  _knownVpns = new Set();
  _cryptoBlocklist = new Set();
  _loadedAt = null;
  _loaded = false;
  loadDatabases().catch((err) => console.error("[OFFLINE HASH DB] Reload failed:", err));
}

// ── CSV parsers ───────────────────────────────────────────────────────────────

async function loadNcmecCsv(path: string): Promise<void> {
  if (!existsSync(path)) {
    console.warn(`[OFFLINE HASH DB] NCMEC hash file not found: ${path}`);
    return;
  }
  await forEachCsvLine(path, (cols) => {
    const [hash, series, victimId, country, category] = cols;
    if (hash) {
      _ncmec.set(hash.toLowerCase(), {
        series_name:        series     || undefined,
        victim_identified:  victimId === "true",
        victim_country:     country    || undefined,
        category:           category   || undefined,
      });
    }
  });
}

async function loadProjectVicCsv(path: string): Promise<void> {
  if (!existsSync(path)) {
    console.warn(`[OFFLINE HASH DB] Project VIC hash file not found: ${path}`);
    return;
  }
  await forEachCsvLine(path, (cols) => {
    const [hash, series, country, seriesId] = cols;
    if (hash) {
      _projectvic.set(hash.toLowerCase(), {
        series_name:    series   || undefined,
        victim_country: country  || undefined,
        series_id:      seriesId || undefined,
      });
    }
  });
}

async function loadIwfCsv(path: string): Promise<void> {
  if (!existsSync(path)) {
    console.warn(`[OFFLINE HASH DB] IWF hash file not found: ${path}`);
    return;
  }
  await forEachCsvLine(path, (cols) => {
    const [hash, category] = cols;
    if (hash && (category === "A" || category === "B" || category === "C")) {
      _iwf.set(hash.toLowerCase(), { category });
    }
  });
}

async function loadInterpolCsv(path: string): Promise<void> {
  if (!existsSync(path)) {
    console.warn(`[OFFLINE HASH DB] Interpol ICSE hash file not found: ${path}`);
    return;
  }
  await forEachCsvLine(path, (cols) => {
    const [hash, caseRef, country] = cols;
    if (hash) {
      _interpol.set(hash.toLowerCase(), {
        case_ref:       caseRef || undefined,
        victim_country: country || undefined,
      });
    }
  });
}

async function loadSimpleSet(path: string, target: Set<string>): Promise<void> {
  if (!existsSync(path)) return;
  await forEachLine(path, (line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      target.add(trimmed.toLowerCase());
    }
  });
}

// ── Lookup functions ──────────────────────────────────────────────────────────

/**
 * Look up a hash against all local databases.
 * Returns the first match found (priority: NCMEC > Project VIC > IWF > Interpol).
 */
export async function lookupHashOffline(
  hash: string
): Promise<OfflineHashMatch | null> {
  await loadDatabases();

  const h = hash.toLowerCase();

  const ncmecEntry = _ncmec.get(h);
  if (ncmecEntry) {
    return {
      matched: true,
      database: "ncmec",
      series_name:      ncmecEntry.series_name,
      victim_identified: ncmecEntry.victim_identified,
      victim_country:   ncmecEntry.victim_country,
      ncmec_category:   ncmecEntry.category,
    };
  }

  const projectVicEntry = _projectvic.get(h);
  if (projectVicEntry) {
    return {
      matched: true,
      database: "project_vic",
      series_name:      projectVicEntry.series_name,
      victim_country:   projectVicEntry.victim_country,
      project_vic_series: projectVicEntry.series_id,
    };
  }

  const iwfEntry = _iwf.get(h);
  if (iwfEntry) {
    return {
      matched: true,
      database: "iwf",
      iwf_category: iwfEntry.category,
    };
  }

  const interpolEntry = _interpol.get(h);
  if (interpolEntry) {
    return {
      matched: true,
      database: "interpol_icse",
      interpol_case_ref: interpolEntry.case_ref,
      victim_country:    interpolEntry.victim_country,
    };
  }

  return null;
}

/**
 * Check if an IP is a known Tor exit node.
 */
export async function isTorExitNode(ip: string): Promise<boolean> {
  await loadDatabases();
  return _torExits.has(ip.toLowerCase());
}

/**
 * Check if an IP is a known VPN exit node.
 */
export async function isKnownVpn(ip: string): Promise<boolean> {
  await loadDatabases();
  return _knownVpns.has(ip.toLowerCase());
}

/**
 * Check if a crypto address is on the blocklist.
 */
export async function isCryptoBlocked(address: string): Promise<boolean> {
  await loadDatabases();
  return _cryptoBlocklist.has(address.toLowerCase());
}

/**
 * Return database statistics for the health endpoint.
 */
export function getStats(): OfflineHashDbStats {
  const cfg = getOfflineConfig();
  return {
    ncmec_count:      _ncmec.size,
    projectvic_count: _projectvic.size,
    iwf_count:        _iwf.size,
    interpol_count:   _interpol.size,
    tor_exits_count:  _torExits.size,
    loaded_at:        _loadedAt,
    db_path:          cfg.hashDbPath,
  };
}

// ── File reading utilities ────────────────────────────────────────────────────

async function forEachCsvLine(
  path: string,
  callback: (cols: string[]) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let firstLine = true;
    const rl = createInterface({
      input: createReadStream(path, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      if (firstLine && trimmed.toLowerCase().startsWith("hash")) {
        // Skip header row
        firstLine = false;
        return;
      }
      firstLine = false;
      const cols = trimmed.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
      callback(cols);
    });
    rl.on("close", resolve);
    rl.on("error", reject);
  });
}

async function forEachLine(
  path: string,
  callback: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: createReadStream(path, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    rl.on("line", callback);
    rl.on("close", resolve);
    rl.on("error", reject);
  });
}
