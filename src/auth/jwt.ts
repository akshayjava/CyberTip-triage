/**
 * JWT Authentication — Tier 2.4 (fully implemented)
 *
 * Uses native Node.js crypto — no external JWT library required.
 * HMAC-SHA256 signatures. PBKDF2-SHA256 password hashing.
 * 8-hour tokens; CJIS 30-minute inactivity enforced in middleware.
 *
 * Role hierarchy (lowest → highest):
 *   analyst → investigator → supervisor → commander → admin
 *
 * Access rules enforced at API layer:
 *   analyst:      read own unit's tips (PII redacted)
 *   investigator: read/write assigned tips; read unit tips
 *   supervisor:   full unit access; cross-unit summary reads
 *   commander:    multi-unit read; approve legal processes
 *   admin:        full system; officer management
 */

import { createHmac, timingSafeEqual, randomBytes, pbkdf2Sync } from "crypto";
import { randomUUID } from "crypto";
import {
  getOfficerByBadge,
  recordLogin,
  revokeJTI,
  isJTIRevoked,
  updatePasswordHash,
} from "../db/officers.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OfficerRole = "analyst" | "investigator" | "supervisor" | "commander" | "admin";
export type UnitCode    = "ICAC" | "FINANCIAL_CRIMES" | "CYBER" | "JTTF" | "GENERAL_INV" | "SUPERVISOR";
export type OfficerSpecialty = "AIG_CSAM" | "INTERNATIONAL" | "SEXTORTION" | "UNDERCOVER" | "FORENSICS" | "GENERAL";

export interface AuthSession {
  officer_id:           string;
  badge_number:         string;
  name:                 string;
  role:                 OfficerRole;
  unit:                 UnitCode;
  specialty:            OfficerSpecialty | null;
  max_concurrent_cases: number;
  jti:                  string;   // JWT ID — used for revocation
  iat:                  number;   // Issued-at (Unix seconds)
  exp:                  number;   // Expiry (Unix seconds)
  last_active_at:       string;   // ISO 8601 — updated on each request
}

export interface LoginRequest  { badge_number: string; password: string; }
export interface LoginResponse { token: string; session: AuthSession; expires_at: string; }

// ── Configuration ─────────────────────────────────────────────────────────────

const SECRET          = process.env["JWT_SECRET"];

if (!SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

const TOKEN_TTL       = 8 * 60 * 60;       // 8 hours in seconds
const INACTIVITY_TTL  = 30 * 60 * 1000;    // 30 min in ms (CJIS § 5.6.2.1)

const PBKDF2_ITERS  = 600_000;
const PBKDF2_KEYLEN = 32;
const SALT_LEN      = 16;

if (SECRET.length < 32) {
  console.warn("[AUTH] WARNING: JWT_SECRET is short. Set a 256-bit secret in production.");
}

// ── JWT internals ─────────────────────────────────────────────────────────────

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function fromB64url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

function hmacSign(header: string, payload: string): string {
  return createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
}

function issueJWT(payload: Omit<AuthSession, "jti" | "iat" | "exp">): string {
  const header  = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now     = Math.floor(Date.now() / 1000);
  const body    = b64url(JSON.stringify({
    ...payload,
    jti: randomUUID(),
    iat: now,
    exp: now + TOKEN_TTL,
  }));
  return `${header}.${body}.${hmacSign(header, body)}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Verify a Bearer token. Returns the decoded session or null if invalid.
 * Checks: structure, signature, expiry, JTI revocation.
 */
export async function verifyToken(token: string): Promise<AuthSession | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sig] = parts as [string, string, string];

  // Timing-safe signature verification
  const expected = hmacSign(headerB64, payloadB64);
  try {
    const expBuf = Buffer.from(expected, "utf8");
    const sigBuf = Buffer.from(sig,      "utf8");
    if (expBuf.length !== sigBuf.length || !timingSafeEqual(expBuf, sigBuf)) return null;
  } catch {
    return null;
  }

  let session: AuthSession;
  try {
    session = JSON.parse(fromB64url(payloadB64)) as AuthSession;
  } catch {
    return null;
  }

  // Check expiry
  if (session.exp <= Math.floor(Date.now() / 1000)) return null;

  // Check revocation
  if (session.jti && await isJTIRevoked(session.jti)) return null;

  return session;
}

/**
 * Authenticate an officer with badge number + password.
 * Returns a signed JWT on success; throws on invalid credentials.
 */
export async function login(req: LoginRequest): Promise<LoginResponse> {
  const officer = await getOfficerByBadge(req.badge_number);
  if (!officer) throw new AuthError("Invalid badge number or password");
  if (!officer.active) throw new AuthError("Account is inactive");

  if (!officer.password_hash) {
    throw new AuthError("Account password not set. Contact administrator.");
  }

  if (!verifyPassword(req.password, officer.password_hash)) {
    throw new AuthError("Invalid badge number or password");
  }

  // Auto-upgrade hash if iterations are below current default
  const hashParts = officer.password_hash.split(":");
  if (hashParts.length === 4 && hashParts[0] === "pbkdf2") {
    const iters = parseInt(hashParts[1], 10);
    if (!isNaN(iters) && iters < PBKDF2_ITERS) {
      const newHash = hashPassword(req.password);
      await updatePasswordHash(officer.officer_id, newHash);
    }
  }

  await recordLogin(officer.officer_id);

  const now = new Date().toISOString();
  const sessionBase: Omit<AuthSession, "jti" | "iat" | "exp"> = {
    officer_id:           officer.officer_id,
    badge_number:         officer.badge_number,
    name:                 officer.name,
    role:                 officer.role as OfficerRole,
    unit:                 officer.unit as UnitCode,
    specialty:            (officer.specialty ?? null) as OfficerSpecialty | null,
    max_concurrent_cases: officer.max_concurrent_cases ?? 20,
    last_active_at:       now,
  };

  const token = issueJWT(sessionBase);

  // Decode to get the full session (with jti/iat/exp)
  const parts    = token.split(".");
  const session  = JSON.parse(fromB64url(parts[1]!)) as AuthSession;

  return {
    token,
    session,
    expires_at: new Date(session.exp * 1000).toISOString(),
  };
}

/**
 * Refresh a session — issues a new token, revokes the old one.
 * Only refreshes if the old token is still within INACTIVITY_TTL.
 */
export async function refreshSession(oldToken: string): Promise<LoginResponse> {
  const session = await verifyToken(oldToken);
  if (!session) throw new AuthError("Invalid or expired token");

  const inactiveMs = Date.now() - new Date(session.last_active_at).getTime();
  if (inactiveMs > INACTIVITY_TTL) {
    throw new AuthError("Session expired due to inactivity (CJIS 30-minute policy)");
  }

  // Revoke old token
  await revokeJTI(session.jti, session.officer_id, "refresh");

  const now = new Date().toISOString();
  const base: Omit<AuthSession, "jti" | "iat" | "exp"> = { ...session, last_active_at: now };
  const token    = issueJWT(base);
  const parts    = token.split(".");
  const newSess  = JSON.parse(fromB64url(parts[1]!)) as AuthSession;

  return { token, session: newSess, expires_at: new Date(newSess.exp * 1000).toISOString() };
}

/**
 * Revoke a token immediately (logout).
 */
export async function revokeToken(token: string): Promise<void> {
  const session = await verifyToken(token);
  if (!session) return; // already invalid — nothing to do
  await revokeJTI(session.jti, session.officer_id, "logout");
}

// ── Role helpers ──────────────────────────────────────────────────────────────

const ROLE_LEVEL: Record<OfficerRole, number> = {
  analyst: 1, investigator: 2, supervisor: 3, commander: 4, admin: 5,
};

export function hasRole(actual: OfficerRole, required: OfficerRole): boolean {
  return (ROLE_LEVEL[actual] ?? 0) >= (ROLE_LEVEL[required] ?? 99);
}

export function canAccessUnit(session: AuthSession, targetUnit: string): boolean {
  if (session.role === "admin" || session.role === "commander") return true;
  return session.unit === targetUnit;
}

// ── Password hashing ──────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN).toString("hex");
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERS, PBKDF2_KEYLEN, "sha256").toString("hex");
  return `pbkdf2:${PBKDF2_ITERS}:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const [, itersStr, salt, expectedHash] = parts as [string, string, string, string];
  const iters = parseInt(itersStr, 10);
  if (isNaN(iters) || iters < 1) return false;
  const derived  = pbkdf2Sync(password, salt, iters, PBKDF2_KEYLEN, "sha256").toString("hex");
  const derivedBuf  = Buffer.from(derived, "utf8");
  const expectedBuf = Buffer.from(expectedHash, "utf8");
  if (derivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(derivedBuf, expectedBuf);
}

/** Redact PII fields for analyst-role access */
export function redactForAnalyst(tip: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...tip };
  const reporter = redacted["reporter"] as Record<string, unknown> | undefined;
  if (reporter) {
    redacted["reporter"] = {
      ...reporter,
      name:  reporter["name"]  ? "[REDACTED]" : undefined,
      email: reporter["email"] ? "[REDACTED]" : undefined,
      ip:    reporter["ip"]    ? "[REDACTED]" : undefined,
    };
  }
  return redacted;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

// Extract Bearer token from Authorization header
export function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7) || null;
}
