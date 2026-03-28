/**
 * Network Guard — Offline / Air-Gap Mode Enforcement
 *
 * When OFFLINE_MODE=true, this module installs a global fetch wrapper that:
 *   1. Allows requests to RFC 1918 / loopback addresses (LAN services)
 *   2. Blocks requests to external (internet-routable) hosts
 *   3. Logs every blocked attempt to the audit trail
 *
 * Must be installed BEFORE any LLM, alert, or tool calls are made.
 * Call `installNetworkGuard()` from src/index.ts when OFFLINE_MODE=true.
 *
 * ── What is allowed ──────────────────────────────────────────────────────────
 *
 *   ✓ http://localhost:11434/...       (Ollama)
 *   ✓ http://127.0.0.1:8000/...       (vLLM)
 *   ✓ http://192.168.1.50:5432/...    (local PostgreSQL)
 *   ✓ http://10.0.1.5/...             (internal SMTP / deconfliction server)
 *
 * ── What is blocked ──────────────────────────────────────────────────────────
 *
 *   ✗ https://api.anthropic.com/...
 *   ✗ https://api.openai.com/...
 *   ✗ https://generativelanguage.googleapis.com/...
 *   ✗ https://api.twilio.com/...
 *   ✗ https://api.ncmec.org/...
 *   ✗ https://www.icacdatasystem.com/...
 *   ✗ Any non-RFC-1918 IP
 *
 * ── Architecture note ────────────────────────────────────────────────────────
 *
 * Node.js's built-in `fetch` (v18+) and `node-fetch` both use the
 * undici library or native WHATWG fetch under the hood. We wrap
 * `globalThis.fetch` at process startup so that all downstream code
 * (LLM providers, alert tools, hash tools) is covered without
 * needing per-module changes.
 */

import { getOfflineConfig } from "../offline/offline_config.js";

// ── IP range matchers ─────────────────────────────────────────────────────────

interface IpRange {
  base: number[];
  mask: number;
  family: 4 | 6;
}

/**
 * Well-known private / loopback ranges that are always allowed in offline mode.
 * Format: CIDR strings parsed into { base, mask, family }.
 */
const ALWAYS_ALLOWED_RANGES: IpRange[] = [
  parseCidr("127.0.0.0/8"),          // IPv4 loopback
  parseCidr("10.0.0.0/8"),           // RFC 1918
  parseCidr("172.16.0.0/12"),        // RFC 1918
  parseCidr("192.168.0.0/16"),       // RFC 1918
  parseCidr("169.254.0.0/16"),       // Link-local
  parseCidr("100.64.0.0/10"),        // Shared address space (RFC 6598)
].filter((r): r is IpRange => r !== null);

/**
 * Known cloud provider / external API hostnames that must be blocked.
 * This is a defence-in-depth list — the primary check is the IP range check,
 * but hostname matching catches DNS-resolved external addresses earlier.
 */
const BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
  /api\.anthropic\.com$/i,
  /openai\.com$/i,
  /googleapis\.com$/i,
  /twilio\.com$/i,
  /api\.ncmec\.org$/i,
  /icacdatasystem\.com$/i,
  /projectvic\.org$/i,
  /iwf\.org\.uk$/i,
  /interpol\.int$/i,
  /abuseipdb\.com$/i,
  /haveibeenpwned\.com$/i,
];

// ── Guard state ───────────────────────────────────────────────────────────────

let _installed = false;
const _originalFetch = globalThis.fetch;
const _blockedLog: Array<{ url: string; timestamp: string; reason: string }> = [];

/** Returns a copy of all blocked call records (for health endpoint / audit). */
export function getBlockedCalls(): Array<{ url: string; timestamp: string; reason: string }> {
  return [..._blockedLog];
}

// ── Guard installer ───────────────────────────────────────────────────────────

/**
 * Install the network guard.  Must be called once at startup.
 * Idempotent — safe to call multiple times.
 */
export function installNetworkGuard(): void {
  if (_installed) return;
  _installed = true;

  const cfg = getOfflineConfig();
  if (!cfg.enabled) return;

  // Parse additional whitelist from config
  const extraAllowed: IpRange[] = cfg.networkWhitelist
    .map(parseCidr)
    .filter((r): r is IpRange => r !== null);

  const allowedRanges = [...ALWAYS_ALLOWED_RANGES, ...extraAllowed];

  globalThis.fetch = async function guardedFetch(
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    const url = normalizeUrl(input);

    const blockReason = shouldBlock(url, allowedRanges);
    if (blockReason) {
      const entry = {
        url: redactUrl(url),
        timestamp: new Date().toISOString(),
        reason: blockReason,
      };
      _blockedLog.push(entry);
      console.error(
        `[NETWORK GUARD] BLOCKED external request in offline mode.\n` +
        `  URL:    ${entry.url}\n` +
        `  Reason: ${blockReason}\n` +
        `  Set OFFLINE_MODE=false or add the host to OFFLINE_NETWORK_WHITELIST to allow it.`
      );
      throw new NetworkGuardError(
        `[OFFLINE MODE] External network request blocked: ${entry.url}. ` +
        `Reason: ${blockReason}`
      );
    }

    return _originalFetch(input, init);
  } as typeof globalThis.fetch;

  console.log(
    "[NETWORK GUARD] Installed — all external network calls will be blocked.\n" +
    `  Allowed ranges: ${allowedRanges.map(ipRangeToString).join(", ")}`
  );
}

/** Remove the network guard (used in tests). */
export function uninstallNetworkGuard(): void {
  if (!_installed) return;
  globalThis.fetch = _originalFetch;
  _installed = false;
  _blockedLog.length = 0;
}

// ── Block decision ────────────────────────────────────────────────────────────

function shouldBlock(url: string, allowedRanges: IpRange[]): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Unparseable URL — allow (not our concern)
    return null;
  }

  // Strip IPv6 brackets
  const cleanHost = hostname.replace(/^\[(.+)\]$/, "$1");

  // Localhost is always allowed
  if (cleanHost === "localhost" || cleanHost === "::1" || cleanHost === "0.0.0.0") {
    return null;
  }

  // Known blocked patterns (fast path)
  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(cleanHost)) {
      return `Hostname matches blocked pattern: ${pattern.source}`;
    }
  }

  // If it looks like a raw IP, check ranges
  if (isIpAddress(cleanHost)) {
    if (isInRanges(cleanHost, allowedRanges)) {
      return null; // Private IP — allowed
    }
    return `IP address ${cleanHost} is not in the allowed private ranges`;
  }

  // Hostname (not a raw IP) — allow internal hostnames (no dots or all-local)
  // Block multi-label hostnames that look like external domains
  if (looksExternal(cleanHost)) {
    return `Hostname "${cleanHost}" appears to be an external domain. ` +
      `Add to OFFLINE_NETWORK_WHITELIST if this is an internal host.`;
  }

  return null; // Single-label or unresolved hostname — allow
}

/**
 * Heuristic: a hostname with 2+ dots that doesn't look like a local pattern
 * (e.g., "server.local", "host.icac.agency.gov" is not blocked,
 *  but "api.openai.com" and "googleapis.com" would be caught by BLOCKED_HOSTNAME_PATTERNS first).
 */
function looksExternal(hostname: string): boolean {
  if (!hostname.includes(".")) return false; // Single label — local
  if (hostname.endsWith(".local")) return false;
  if (hostname.endsWith(".internal")) return false;
  if (hostname.endsWith(".lan")) return false;
  if (hostname.endsWith(".localdomain")) return false;
  // Known TLDs indicate public internet
  const tld = hostname.split(".").pop()?.toLowerCase() ?? "";
  const publicTlds = ["com", "net", "org", "io", "ai", "gov", "mil", "edu", "int", "uk", "de", "fr", "ca", "au"];
  return publicTlds.includes(tld);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

/** Redact auth tokens from the URL before logging. */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.searchParams.get("key")) u.searchParams.set("key", "***");
    if (u.searchParams.get("api_key")) u.searchParams.set("api_key", "***");
    return u.href;
  } catch {
    return url.slice(0, 200);
  }
}

function isIpAddress(host: string): boolean {
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // IPv6 (simplified)
  if (/^[0-9a-f:]+$/i.test(host) && host.includes(":")) return true;
  return false;
}

function isInRanges(ip: string, ranges: IpRange[]): boolean {
  for (const range of ranges) {
    if (ipInRange(ip, range)) return true;
  }
  return false;
}

function ipInRange(ip: string, range: IpRange): boolean {
  if (range.family === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return false;
    const ipInt = (parts[0]! << 24) | (parts[1]! << 8 * 2) | (parts[2]! << 8) | parts[3]!;
    const baseInt = (range.base[0]! << 24) | (range.base[1]! << 8 * 2) | (range.base[2]! << 8) | range.base[3]!;
    const maskInt = 0xFFFFFFFF << (32 - range.mask);
    return (ipInt & maskInt) === (baseInt & maskInt);
  }
  // IPv6 — simplified: just check prefix
  if (range.family === 6) {
    const ipNorm = normalizeIpv6(ip);
    const baseNorm = normalizeIpv6(range.base.join(":"));
    const prefixChars = Math.ceil(range.mask / 4);
    return ipNorm.slice(0, prefixChars) === baseNorm.slice(0, prefixChars);
  }
  return false;
}

function parseCidr(cidr: string): IpRange | null {
  try {
    const [addr, maskStr] = cidr.split("/");
    const mask = parseInt(maskStr ?? "32", 10);
    if (addr!.includes(":")) {
      // IPv6
      const parts = expandIpv6(addr!);
      return { base: parts, mask, family: 6 };
    } else {
      const parts = addr!.split(".").map(Number);
      if (parts.length !== 4) return null;
      return { base: parts, mask, family: 4 };
    }
  } catch {
    return null;
  }
}

function ipRangeToString(r: IpRange): string {
  if (r.family === 4) return `${r.base.join(".")}/${r.mask}`;
  return `${r.base.join(":")}/${r.mask}`;
}

function expandIpv6(addr: string): number[] {
  // Very simplified expansion for common cases
  const parts = addr.split(":").map((p) => parseInt(p || "0", 16));
  return parts.slice(0, 8);
}

function normalizeIpv6(addr: string): string {
  return addr.toLowerCase().replace(/:/g, "");
}

// ── Custom error ──────────────────────────────────────────────────────────────

export class NetworkGuardError extends Error {
  readonly code = "NETWORK_GUARD_BLOCKED";
  constructor(message: string) {
    super(message);
    this.name = "NetworkGuardError";
  }
}
