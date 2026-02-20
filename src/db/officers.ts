/**
 * Officer Repository — database layer for investigator accounts (Tier 2.4)
 *
 * Handles login credential lookup, officer CRUD, assignment tracking,
 * and JWT revocation. Dual-mode: PostgreSQL / in-memory fallback.
 */

import { randomUUID } from "crypto";
import { getPool } from "./pool.js";
import type { Officer, OfficerPublic, OfficerRole, UnitCode } from "../models/officer.js";

// ── In-memory fallback store ──────────────────────────────────────────────────

const memOfficers = new Map<string, Officer>();

// Seed a default admin for in-memory mode
function seedDefaultAdmin(): void {
  if (memOfficers.size > 0) return;
  const id = randomUUID();
  memOfficers.set(id, {
    officer_id:           id,
    badge_number:         "ADMIN-001",
    name:                 "System Administrator",
    rank:                 "Administrator",
    unit:                 "SUPERVISOR",
    role:                 "admin",
    email:                "admin@agency.local",
    phone:                undefined,
    specialty:            undefined,
    active:               true,
    supervisor_id:        undefined,
    max_concurrent_cases: 999,
    assigned_tip_ids:     [],
    password_hash:        undefined, // set via changePassword() or API
    created_at:           new Date().toISOString(),
  });
}

function isPostgres(): boolean {
  return process.env["DB_MODE"] === "postgres";
}

// Strip password_hash before returning to callers
function stripHash(o: Officer): OfficerPublic {
  const { password_hash: _ph, ...pub } = o;
  return pub as OfficerPublic;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** Find officer by badge number — includes password_hash for login flow only */
export async function getOfficerByBadge(badge: string): Promise<Officer | null> {
  if (!isPostgres()) {
    seedDefaultAdmin();
    return Array.from(memOfficers.values()).find((o) => o.badge_number === badge) ?? null;
  }

  const pool = getPool();
  const result = await pool.query<Officer>(
    `SELECT officer_id, badge_number, name, rank, unit, role, email, phone,
            specialty, active, supervisor_id, max_concurrent_cases,
            password_hash, created_at, updated_at, last_login_at,
            ARRAY(
              SELECT ta.tip_id::text FROM tip_assignments ta
               WHERE ta.officer_id = o.officer_id AND ta.status = 'active'
            ) as assigned_tip_ids
     FROM officers o WHERE badge_number = $1 AND active = TRUE`,
    [badge]
  );
  return result.rows[0] ?? null;
}

/** Get public officer info (no password_hash) by ID */
export async function getOfficerById(id: string): Promise<OfficerPublic | null> {
  if (!isPostgres()) {
    seedDefaultAdmin();
    const o = memOfficers.get(id);
    return o ? stripHash(o) : null;
  }

  const pool = getPool();
  const result = await pool.query<OfficerPublic>(
    `SELECT officer_id, badge_number, name, rank, unit, role, email, phone,
            specialty, active, supervisor_id, max_concurrent_cases,
            created_at, updated_at, last_login_at,
            ARRAY(
              SELECT ta.tip_id::text FROM tip_assignments ta
               WHERE ta.officer_id = o.officer_id AND ta.status = 'active'
            ) as assigned_tip_ids
     FROM officers o WHERE officer_id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/** List all active officers, optionally filtered by unit or role */
export async function listOfficers(
  opts: { unit?: string; role?: string; active_only?: boolean } = {}
): Promise<OfficerPublic[]> {
  if (!isPostgres()) {
    seedDefaultAdmin();
    let officers = Array.from(memOfficers.values());
    if (opts.unit) officers = officers.filter((o) => o.unit === opts.unit);
    if (opts.role) officers = officers.filter((o) => o.role === opts.role);
    if (opts.active_only !== false) officers = officers.filter((o) => o.active);
    return officers.map(stripHash);
  }

  const pool = getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (opts.unit) { conditions.push(`unit = $${paramIdx++}`); params.push(opts.unit); }
  if (opts.role) { conditions.push(`role = $${paramIdx++}`); params.push(opts.role); }
  if (opts.active_only !== false) { conditions.push(`active = TRUE`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query<OfficerPublic>(
    `SELECT officer_id, badge_number, name, rank, unit, role, email, phone,
            specialty, active, supervisor_id, max_concurrent_cases,
            created_at, updated_at, last_login_at,
            ARRAY(
              SELECT ta.tip_id::text FROM tip_assignments ta
               WHERE ta.officer_id = o.officer_id AND ta.status = 'active'
            ) as assigned_tip_ids
     FROM officers o ${where} ORDER BY name`,
    params
  );
  return result.rows;
}

/** Create a new officer account */
export async function createOfficer(
  data: Omit<Officer, "officer_id" | "created_at" | "assigned_tip_ids">
): Promise<OfficerPublic> {
  const id = randomUUID();
  const now = new Date().toISOString();

  if (!isPostgres()) {
    seedDefaultAdmin();
    const officer: Officer = {
      ...data,
      officer_id:       id,
      created_at:       now,
      assigned_tip_ids: [],
    };
    memOfficers.set(id, officer);
    return stripHash(officer);
  }

  const pool = getPool();
  const result = await pool.query<OfficerPublic>(
    `INSERT INTO officers
       (officer_id, badge_number, name, rank, unit, role, email, phone,
        specialty, active, supervisor_id, max_concurrent_cases, password_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING officer_id, badge_number, name, rank, unit, role, email, phone,
               specialty, active, supervisor_id, max_concurrent_cases,
               created_at, updated_at, last_login_at,
               ARRAY[]::text[] as assigned_tip_ids`,
    [
      id, data.badge_number, data.name, data.rank, data.unit, data.role,
      data.email, data.phone ?? null, data.specialty ?? null, data.active,
      data.supervisor_id ?? null, data.max_concurrent_cases ?? 20,
      data.password_hash ?? null,
    ]
  );
  return result.rows[0]!;
}

/** Update officer password hash */
export async function updatePasswordHash(officerId: string, hash: string): Promise<void> {
  if (!isPostgres()) {
    const o = memOfficers.get(officerId);
    if (o) { o.password_hash = hash; o.updated_at = new Date().toISOString(); }
    return;
  }
  const pool = getPool();
  await pool.query(
    `UPDATE officers SET password_hash = $1, updated_at = NOW() WHERE officer_id = $2`,
    [hash, officerId]
  );
}

/** Record a successful login (update last_login_at) */
export async function recordLogin(officerId: string): Promise<void> {
  if (!isPostgres()) {
    const o = memOfficers.get(officerId);
    if (o) o.last_login_at = new Date().toISOString();
    return;
  }
  const pool = getPool();
  await pool.query(
    `UPDATE officers SET last_login_at = NOW() WHERE officer_id = $1`,
    [officerId]
  );
}

/** Update officer role (admin only) */
export async function updateOfficerRole(
  officerId: string,
  role: OfficerRole,
  unit?: UnitCode
): Promise<OfficerPublic | null> {
  if (!isPostgres()) {
    const o = memOfficers.get(officerId);
    if (!o) return null;
    o.role = role;
    if (unit) o.unit = unit;
    o.updated_at = new Date().toISOString();
    return stripHash(o);
  }

  const pool = getPool();
  const result = await pool.query<OfficerPublic>(
    `UPDATE officers SET role = $1, unit = COALESCE($2, unit), updated_at = NOW()
     WHERE officer_id = $3
     RETURNING officer_id, badge_number, name, rank, unit, role, email, phone,
               specialty, active, supervisor_id, max_concurrent_cases,
               created_at, updated_at, last_login_at,
               ARRAY[]::text[] as assigned_tip_ids`,
    [role, unit ?? null, officerId]
  );
  return result.rows[0] ?? null;
}

/** Deactivate officer (soft delete — preserve audit history) */
export async function deactivateOfficer(officerId: string): Promise<boolean> {
  if (!isPostgres()) {
    const o = memOfficers.get(officerId);
    if (!o) return false;
    o.active = false;
    return true;
  }
  const pool = getPool();
  const result = await pool.query(
    `UPDATE officers SET active = FALSE, updated_at = NOW() WHERE officer_id = $1`,
    [officerId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ── JWT revocation ─────────────────────────────────────────────────────────────

const revokedTokens = new Set<string>(); // in-memory for dev mode

export async function revokeJTI(jti: string, officerId: string, reason = "logout"): Promise<void> {
  if (!isPostgres()) {
    revokedTokens.add(jti);
    return;
  }
  const pool = getPool();
  await pool.query(
    `INSERT INTO revoked_tokens (jti, officer_id, reason) VALUES ($1, $2, $3)
     ON CONFLICT (jti) DO NOTHING`,
    [jti, officerId, reason]
  );
}

export async function isJTIRevoked(jti: string): Promise<boolean> {
  if (!isPostgres()) return revokedTokens.has(jti);
  const pool = getPool();
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM revoked_tokens WHERE jti = $1) as exists`,
    [jti]
  );
  return result.rows[0]?.exists ?? false;
}

// ── Assignment suggestions ─────────────────────────────────────────────────────

/**
 * Suggest the best available officer for a tip based on:
 *   1. Unit match
 *   2. Specialty match
 *   3. Current caseload (under max_concurrent_cases)
 *   4. Conflict of interest (excluded officer IDs)
 */
export async function suggestAssignment(
  routingUnit: string,
  specialty: string | undefined,
  excludeOfficerIds: string[] = []
): Promise<OfficerPublic | null> {
  const officers = await listOfficers({ unit: routingUnit, role: "investigator", active_only: true });

  const eligible = officers.filter((o) => {
    if (excludeOfficerIds.includes(o.officer_id)) return false;
    if (o.assigned_tip_ids.length >= (o.max_concurrent_cases ?? 20)) return false;
    return true;
  });

  if (eligible.length === 0) return null;

  // Prefer specialty match
  if (specialty) {
    const specialist = eligible.find((o) => o.specialty === specialty);
    if (specialist) return specialist;
  }

  // Pick the officer with the fewest current assignments
  return eligible.sort((a, b) => a.assigned_tip_ids.length - b.assigned_tip_ids.length)[0] ?? null;
}
