/**
 * Audit Log — Append-Only
 *
 * All agent outputs and human actions are written here.
 * This log is the chain of custody for AI triage decisions.
 *
 * ABSOLUTE RULE: No record may ever be modified or deleted.
 * The database trigger (see migrations) enforces this at the DB layer.
 * This module enforces it at the application layer.
 * Never call UPDATE or DELETE against the audit_log table.
 */

import { randomUUID } from "crypto";
import type { AuditEntry, AgentName } from "../models/index.js";

// In-memory log for development / testing (before DB is wired up)
const IN_MEMORY_LOG: AuditEntry[] = [];

// ── Core append function ─────────────────────────────────────────────────────

/**
 * Append a new entry to the audit log.
 * In production: writes to PostgreSQL audit_log table (append-only via trigger).
 * In development: writes to in-memory array.
 *
 * This function NEVER modifies existing records.
 */
export async function appendAuditEntry(
  entry: Omit<AuditEntry, "entry_id">
): Promise<AuditEntry> {
  const full: AuditEntry = {
    ...entry,
    entry_id: randomUUID(),
  };

  if (process.env["DB_MODE"] === "postgres") {
    await writeToPostgres(full);
  } else {
    // Development: in-memory
    IN_MEMORY_LOG.push(full);
  }

  // Always log to console in development
  if (process.env["NODE_ENV"] !== "production") {
    const icon = full.status === "success" ? "✓" : full.status === "agent_error" ? "✗" : "⚑";
    console.log(
      `[AUDIT] ${icon} ${full.agent} | tip:${full.tip_id.slice(0, 8)} | ${full.summary}`
    );
  }

  return full;
}

// ── Postgres writer (production) ─────────────────────────────────────────────

async function writeToPostgres(entry: AuditEntry): Promise<void> {
  // Lazy import to avoid requiring pg in dev/test environments
  const { getPool } = await import("../db/pool.js");
  const pool = getPool();

  await pool.query(
    `INSERT INTO audit_log
      (entry_id, tip_id, agent, timestamp, duration_ms, status, summary,
       model_used, tokens_used, error_detail, human_actor, previous_value, new_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      entry.entry_id,
      entry.tip_id,
      entry.agent,
      entry.timestamp,
      entry.duration_ms ?? null,
      entry.status,
      entry.summary,
      entry.model_used ?? null,
      entry.tokens_used ?? null,
      entry.error_detail ?? null,
      entry.human_actor ?? null,
      entry.previous_value ? JSON.stringify(entry.previous_value) : null,
      entry.new_value ? JSON.stringify(entry.new_value) : null,
    ]
  );
}

// ── Query helpers (read-only) ────────────────────────────────────────────────

/**
 * Get all audit entries for a tip. Read-only.
 */
export async function getAuditTrail(tip_id: string): Promise<AuditEntry[]> {
  if (process.env["DB_MODE"] === "postgres") {
    const { getPool } = await import("../db/pool.js");
    const pool = getPool();
    const result = await pool.query<AuditEntry>(
      `SELECT * FROM audit_log WHERE tip_id = $1 ORDER BY timestamp ASC`,
      [tip_id]
    );
    return result.rows;
  }

  return IN_MEMORY_LOG.filter((e) => e.tip_id === tip_id);
}

/**
 * Get recent audit entries by agent. Useful for monitoring.
 */
export async function getRecentByAgent(
  agent: AgentName,
  limit = 50
): Promise<AuditEntry[]> {
  if (process.env["DB_MODE"] === "postgres") {
    const { getPool } = await import("../db/pool.js");
    const pool = getPool();
    const result = await pool.query<AuditEntry>(
      `SELECT * FROM audit_log WHERE agent = $1 ORDER BY timestamp DESC LIMIT $2`,
      [agent, limit]
    );
    return result.rows;
  }

  return IN_MEMORY_LOG.filter((e) => e.agent === agent)
    .slice(-limit)
    .reverse();
}

// ── Dev helper ───────────────────────────────────────────────────────────────

/** For testing only — returns in-memory log snapshot */
export function getInMemoryLog(): ReadonlyArray<AuditEntry> {
  return IN_MEMORY_LOG;
}

/** For testing only — clears in-memory log between tests */
export function clearInMemoryLog(): void {
  if (process.env["NODE_ENV"] !== "test") {
    throw new Error("clearInMemoryLog() may only be called in test environment");
  }
  IN_MEMORY_LOG.length = 0;
}
