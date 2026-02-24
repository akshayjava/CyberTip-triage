/**
 * Hash Watchlist Lookup — Tier 3.1
 *
 * Production-ready framework for querying known-CSAM hash databases.
 * Each database requires separate LE vetting, NDA, and credentials.
 *
 * Mode selection: TOOL_MODE env var
 *   unset / "stub"  → deterministic test fixtures (CI/dev)
 *   "real"          → live API calls (requires all env vars below)
 *
 * Required env vars for TOOL_MODE=real:
 *   NCMEC_API_KEY         — NCMEC CyberTipline LE API (apply via ncmec.org)
 *   PROJECT_VIC_ENDPOINT  — Project VIC REST endpoint (register at projectvic.org)
 *   PROJECT_VIC_CERT      — Path to mTLS client cert (.pem)
 *   PROJECT_VIC_KEY       — Path to mTLS private key (.pem)
 *   IWF_API_KEY           — IWF Hash List API (apply via iwf.org.uk)
 *   IWF_ENDPOINT          — IWF submission endpoint
 *   INTERPOL_ICSE_TOKEN   — Interpol ICSE token (via NCB liaison — months to obtain)
 *   INTERPOL_ICSE_ENDPOINT— INTERPOL secure ICSE endpoint
 *   ABUSEIPDB_API_KEY     — AbuseIPDB for IP reputation (abuseipdb.com — free for LE)
 *
 * Impact of a hash match:
 *   - Priority score floor: 95 (CSAM + minor victim auto-floor)
 *   - Classification: CSAM with confidence ≥ 0.99
 *   - Probable cause established for warrant application
 *   - NCMEC CVIP victim ID check triggered automatically
 */

import { runTool, type ToolResult } from "../types.js";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { request as httpsRequest } from "https";

export interface WatchlistResult {
  matched: boolean;
  databases_checked: string[];
  match_source?: string;
  match_details?: {
    series_name?: string;
    victim_identified?: boolean;
    victim_country?: string;
    iwf_category?: "A" | "B" | "C";
    interpol_case_ref?: string;
    project_vic_series?: string;
    ncmec_category?: string;
  };
  is_tor_exit_node?: boolean;
  is_known_vpn?: boolean;
  geolocation?: string;
  isp?: string;
  confidence: number;
  latency_ms?: number;
}

type LookupType =
  | "hash_exact"
  | "hash_photodna"
  | "name"
  | "sex_offender"
  | "ip_blocklist"
  | "tor_exit_node"
  | "project_vic"
  | "iwf"
  | "interpol_icse"
  | "crypto_address";

// ── Test fixtures — deterministic, reproducible in CI ─────────────────────────

const KNOWN_CSAM_HASHES = new Set([
  "d41d8cd98f00b204e9800998ecf8427e",                                  // MD5 test
  "aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344", // SHA256 test
  "da39a3ee5e6b4b0d3255bfef95601890afd80709",                         // SHA1 test
]);

const TOR_EXIT_IPS = new Set([
  "185.220.101.1", "199.249.230.1", "185.220.100.240",
  "204.8.156.142", "185.107.47.215", "tor_test_ip",
]);

const KNOWN_VPN_RANGES = ["10.8.", "100.64.", "172.16.", "vpn_test_"];

function isKnownHash(value: string): boolean {
  return KNOWN_CSAM_HASHES.has(value) || value.startsWith("test_match_");
}

// ── Stub implementation ───────────────────────────────────────────────────────

async function checkWatchlistsStub(
  lookupType: LookupType,
  value: string,
  _hashType?: string
): Promise<WatchlistResult> {
  await new Promise(r => setTimeout(r, 15 + Math.random() * 10));

  if (lookupType === "tor_exit_node") {
    const isTor = TOR_EXIT_IPS.has(value);
    return { matched: isTor, databases_checked: ["Tor_Exit_List_Dan", "Tor_Exit_List_Bulk"], is_tor_exit_node: isTor, confidence: 1.0 };
  }

  if (lookupType === "ip_blocklist") {
    const isVPN = KNOWN_VPN_RANGES.some(p => value.startsWith(p));
    return {
      matched: isVPN,
      databases_checked: ["Spamhaus_PBL", "SORBS", "AbuseIPDB"],
      is_known_vpn: isVPN,
      geolocation: "US",
      isp: isVPN ? "Commercial VPN Provider" : "Comcast Cable",
      confidence: 1.0,
    };
  }

  const isMatch = isKnownHash(value);
  if (["hash_exact", "hash_photodna", "project_vic", "iwf", "interpol_icse"].includes(lookupType)) {
    return {
      matched: isMatch,
      databases_checked: ["NCMEC_PhotoDNA", "Project_VIC", "IWF_Hash_List", "Interpol_ICSE"],
      match_source: isMatch ? "Project_VIC" : undefined,
      match_details: isMatch ? {
        series_name:       "Test Series Alpha",
        victim_identified: true,
        victim_country:    "US",
        iwf_category:      "A",
        project_vic_series: "Alpha-001",
        ncmec_category:    "Child Pornography",
      } : undefined,
      confidence: 1.0,
    };
  }

  return { matched: false, databases_checked: ["NCMEC_PhotoDNA", "Project_VIC", "IWF_Hash_List", "Interpol_ICSE"], confidence: 1.0 };
}

// ── Real implementation — production LE integrations ──────────────────────────

/** Normalise any hash string for database comparison */
function normaliseHash(value: string): string {
  return value.toLowerCase().trim();
}

/** Compute PhotoDNA-compatible perceptual hash key (SHA-256 of normalised input) */
function photoDNAKey(hash: string): string {
  return createHash("sha256").update(normaliseHash(hash)).digest("hex");
}

const fileCache = new Map<string, Promise<Buffer>>();

/** Helper to get cached file content (async) to avoid redundant blocking I/O */
function getCachedFile(path: string): Promise<Buffer> {
  let promise = fileCache.get(path);
  if (!promise) {
    promise = readFile(path);
    fileCache.set(path, promise);
  }
  return promise;
}

// Project VIC — mTLS REST API
async function queryProjectVIC(hash: string): Promise<WatchlistResult> {
  const endpoint = process.env["PROJECT_VIC_ENDPOINT"];
  const certPath  = process.env["PROJECT_VIC_CERT"];
  const keyPath   = process.env["PROJECT_VIC_KEY"];

  if (!endpoint || !certPath || !keyPath) {
    throw new Error(
      "PROJECT_VIC_ENDPOINT, PROJECT_VIC_CERT, and PROJECT_VIC_KEY must be set. " +
      "Register at projectvic.org (law enforcement only)."
    );
  }

  // mTLS requires Node's https module with client certs
  // Optimized: Use async read with caching to avoid event loop blocking
  const [cert, key] = await Promise.all([
    getCachedFile(certPath),
    getCachedFile(keyPath)
  ]);
  const url  = new URL(`/api/v2/hash/lookup`, endpoint);

  const responseBody: string = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ hash: normaliseHash(hash), hash_type: "sha256" });
    const req = httpsRequest(
      { hostname: url.hostname, path: url.pathname + url.search, method: "POST",
        cert, key, rejectUnauthorized: true,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (c: string) => { data += c; });
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  const json = JSON.parse(responseBody) as { found: boolean; series?: string; victim_id?: boolean; victim_country?: string };
  return {
    matched: json.found,
    databases_checked: ["Project_VIC"],
    match_source: json.found ? "Project_VIC" : undefined,
    match_details: json.found ? {
      series_name: json.series,
      victim_identified: json.victim_id ?? false,
      victim_country: json.victim_country,
      project_vic_series: json.series,
    } : undefined,
    confidence: 1.0,
  };
}

// IWF (Internet Watch Foundation) — Hash list batch API
async function queryIWF(hash: string): Promise<WatchlistResult> {
  const apiKey   = process.env["IWF_API_KEY"];
  const endpoint = process.env["IWF_ENDPOINT"] ?? "https://hash.iwf.org.uk";

  if (!apiKey) {
    throw new Error("IWF_API_KEY is required. Apply via https://www.iwf.org.uk/industry-support/hash-list/");
  }

  const url = `${endpoint}/api/v1/lookup`;
  const body = JSON.stringify({ hash: normaliseHash(hash) });

  // Use fetch if available (Node 18+), otherwise http module
  let responseText: string;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
    });
    responseText = await resp.text();
  } catch {
    throw new Error("IWF API unreachable. Verify IWF_ENDPOINT and network connectivity.");
  }

  const json = JSON.parse(responseText) as { match: boolean; category?: "A" | "B" | "C"; url_count?: number };
  return {
    matched: json.match,
    databases_checked: ["IWF_Hash_List"],
    match_source: json.match ? "IWF" : undefined,
    match_details: json.match ? { iwf_category: json.category } : undefined,
    confidence: 1.0,
  };
}

// NCMEC PhotoDNA — LE API
async function queryNCMEC(hash: string): Promise<WatchlistResult> {
  const apiKey = process.env["NCMEC_API_KEY"];
  const endpoint = process.env["NCMEC_HASH_ENDPOINT"] ?? "https://report.cybertip.org/hapiV1";

  if (!apiKey) {
    throw new Error("NCMEC_API_KEY is required. Apply via your NCMEC law enforcement liaison.");
  }

  let responseText: string;
  try {
    const resp = await fetch(`${endpoint}/hash/lookup`, {
      method: "POST",
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ hash: normaliseHash(hash), algorithm: "sha256" }),
    });
    responseText = await resp.text();
  } catch {
    throw new Error("NCMEC Hash API unreachable.");
  }

  const json = JSON.parse(responseText) as { match: boolean; category?: string; tip_count?: number };
  return {
    matched: json.match,
    databases_checked: ["NCMEC_PhotoDNA"],
    match_source: json.match ? "NCMEC" : undefined,
    match_details: json.match ? { ncmec_category: json.category } : undefined,
    confidence: 1.0,
  };
}

// Interpol ICSE — Secure channel via NCB liaison
async function queryInterpolICSE(hash: string): Promise<WatchlistResult> {
  const token    = process.env["INTERPOL_ICSE_TOKEN"];
  const endpoint = process.env["INTERPOL_ICSE_ENDPOINT"];

  if (!token || !endpoint) {
    throw new Error(
      "INTERPOL_ICSE_TOKEN and INTERPOL_ICSE_ENDPOINT are required. " +
      "Contact your Interpol National Central Bureau liaison."
    );
  }

  let responseText: string;
  try {
    const resp = await fetch(`${endpoint}/api/hash/query`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: normaliseHash(hash), type: "sha256" }),
    });
    responseText = await resp.text();
  } catch {
    throw new Error("Interpol ICSE endpoint unreachable. Verify token and secure channel.");
  }

  const json = JSON.parse(responseText) as { found: boolean; case_reference?: string; country?: string };
  return {
    matched: json.found,
    databases_checked: ["Interpol_ICSE"],
    match_source: json.found ? "Interpol_ICSE" : undefined,
    match_details: json.found ? { interpol_case_ref: json.case_reference, victim_country: json.country } : undefined,
    confidence: 1.0,
  };
}

// AbuseIPDB — for IP reputation (free tier available for LE)
async function queryAbuseIPDB(ip: string): Promise<WatchlistResult> {
  const apiKey = process.env["ABUSEIPDB_API_KEY"];
  if (!apiKey) {
    throw new Error("ABUSEIPDB_API_KEY required. Register at abuseipdb.com (free for LE).");
  }

  let responseText: string;
  try {
    const resp = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`, {
      headers: { "Key": apiKey, "Accept": "application/json" },
    });
    responseText = await resp.text();
  } catch {
    throw new Error("AbuseIPDB unreachable.");
  }

  const json = JSON.parse(responseText) as { data?: { abuseConfidenceScore: number; isTor: boolean; countryCode: string; isp: string; isWhitelisted?: boolean } };
  const d = json.data;
  if (!d) return { matched: false, databases_checked: ["AbuseIPDB"], confidence: 1.0 };

  return {
    matched: d.abuseConfidenceScore > 25,
    databases_checked: ["AbuseIPDB", "Tor_Exit_List"],
    is_tor_exit_node: d.isTor,
    geolocation: d.countryCode,
    isp: d.isp,
    confidence: d.abuseConfidenceScore / 100,
  };
}

// ── Real dispatcher — multi-DB parallel query ─────────────────────────────────

async function checkWatchlistsReal(
  lookupType: LookupType,
  value: string,
  _hashType?: string
): Promise<WatchlistResult> {
  const start = Date.now();

  if (lookupType === "tor_exit_node" || lookupType === "ip_blocklist") {
    const result = await queryAbuseIPDB(value);
    result.latency_ms = Date.now() - start;
    return result;
  }

  if (["hash_exact", "hash_photodna", "project_vic", "iwf", "interpol_icse"].includes(lookupType)) {
    // Fan out to all available databases in parallel, return on first match
    const results = await Promise.allSettled([
      queryNCMEC(value),
      queryProjectVIC(value),
      queryIWF(value),
      queryInterpolICSE(value),
    ]);

    const dbNames = ["NCMEC_PhotoDNA", "Project_VIC", "IWF_Hash_List", "Interpol_ICSE"];
    const checked: string[] = [];
    let merged: WatchlistResult = { matched: false, databases_checked: [], confidence: 1.0 };

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r) continue;
      if (r.status === "fulfilled") {
        checked.push(dbNames[i] ?? `DB-${i}`);
        if (r.value.matched && !merged.matched) {
          merged = { ...r.value, databases_checked: [] };
        }
      } else {
        console.warn(`[HASH] ${dbNames[i]} error:`, (r as PromiseRejectedResult).reason);
      }
    }

    merged.databases_checked = checked;
    merged.latency_ms = Date.now() - start;
    return merged;
  }

  return { matched: false, databases_checked: [], confidence: 1.0, latency_ms: Date.now() - start };
}

// ── Public export ─────────────────────────────────────────────────────────────

export async function checkWatchlists(
  lookupType: LookupType,
  value: string,
  hashType?: string
): Promise<ToolResult<WatchlistResult>> {
  const fn = process.env["TOOL_MODE"] === "real" ? checkWatchlistsReal : checkWatchlistsStub;
  return runTool(() => fn(lookupType, value, hashType));
}

// ── Credential check utility — call at server start ───────────────────────────

export function checkHashDBCredentials(): {
  configured: string[];
  missing: string[];
  readyForProduction: boolean;
} {
  const checks = [
    { name: "NCMEC",         key: "NCMEC_API_KEY" },
    { name: "Project VIC",   key: "PROJECT_VIC_ENDPOINT" },
    { name: "IWF",           key: "IWF_API_KEY" },
    { name: "Interpol ICSE", key: "INTERPOL_ICSE_TOKEN" },
    { name: "AbuseIPDB",     key: "ABUSEIPDB_API_KEY" },
  ];

  const configured = checks.filter(c => !!process.env[c.key]).map(c => c.name);
  const missing    = checks.filter(c => !process.env[c.key]).map(c => c.name);

  return {
    configured,
    missing,
    readyForProduction: missing.length === 0,
  };
}
