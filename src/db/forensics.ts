/**
 * Forensics Handoff Repository — PostgreSQL + in-memory fallback
 *
 * Persists ForensicsHandoff records produced by the forensics handoff
 * coordinator. These records track which tips have been handed off to
 * which forensics platforms, the status of the handoff, and Wilson
 * compliance counts (files_included vs files_blocked_wilson).
 *
 * DB_MODE=memory  → in-process Map (dev / CI)
 * DB_MODE=postgres → PostgreSQL forensics_handoffs table (production)
 */

import { getPool } from "./pool.js";
import type { ForensicsHandoff, ForensicsHandoffStatus } from "../models/forensics.js";

// ── In-memory fallback ────────────────────────────────────────────────────────

const memStore = new Map<string, ForensicsHandoff>();

function isPostgres(): boolean {
  return process.env["DB_MODE"] === "postgres";
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function saveForensicsHandoff(handoff: ForensicsHandoff): Promise<void> {
  if (!isPostgres()) {
    memStore.set(handoff.handoff_id, handoff);
    return;
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO forensics_handoffs (
       handoff_id, tip_id, platform, generated_at, generated_by,
       status, files_included, files_blocked_wilson,
       export_format, export_size_bytes, notes, full_handoff_json
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
     )
     ON CONFLICT (handoff_id) DO UPDATE SET
       status             = EXCLUDED.status,
       delivered_at       = EXCLUDED.delivered_at,
       imported_at        = EXCLUDED.imported_at,
       completed_at       = EXCLUDED.completed_at,
       notes              = EXCLUDED.notes,
       full_handoff_json  = EXCLUDED.full_handoff_json,
       updated_at         = NOW()`,
    [
      handoff.handoff_id,
      handoff.tip_id,
      handoff.platform,
      handoff.generated_at,
      handoff.generated_by,
      handoff.status,
      handoff.files_included,
      handoff.files_blocked_wilson,
      handoff.export_format,
      handoff.export_size_bytes ?? null,
      handoff.notes ?? null,
      JSON.stringify(handoff),
    ]
  );
}

// ── Update status ─────────────────────────────────────────────────────────────

export async function updateHandoffStatus(
  handoffId: string,
  status: ForensicsHandoffStatus,
  notes?: string
): Promise<ForensicsHandoff | null> {
  const now = new Date().toISOString();

  if (!isPostgres()) {
    const h = memStore.get(handoffId);
    if (!h) return null;
    const updated: ForensicsHandoff = {
      ...h,
      status,
      notes: notes ?? h.notes,
      ...(status === "delivered" ? { delivered_at: now } : {}),
      ...(status === "imported" ? { imported_at: now } : {}),
      ...(status === "completed" ? { completed_at: now } : {}),
    };
    memStore.set(handoffId, updated);
    return updated;
  }

  const timestampCol =
    status === "delivered" ? ", delivered_at = NOW()"
    : status === "imported" ? ", imported_at = NOW()"
    : status === "completed" ? ", completed_at = NOW()"
    : "";

  const pool = getPool();
  const result = await pool.query<{ full_handoff_json: ForensicsHandoff }>(
    `UPDATE forensics_handoffs
     SET status = $1, notes = COALESCE($2, notes)${timestampCol}, updated_at = NOW()
     WHERE handoff_id = $3
     RETURNING full_handoff_json`,
    [status, notes ?? null, handoffId]
  );

  if (result.rows.length === 0) return null;

  // Re-fetch to get the freshest record
  const row = await pool.query<{ full_handoff_json: ForensicsHandoff }>(
    `SELECT full_handoff_json FROM forensics_handoffs WHERE handoff_id = $1`,
    [handoffId]
  );

  return row.rows[0]?.full_handoff_json ?? null;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function listForensicsHandoffs(
  tipId?: string,
  limit = 100
): Promise<ForensicsHandoff[]> {
  if (!isPostgres()) {
    let results = Array.from(memStore.values());
    if (tipId) results = results.filter((h) => h.tip_id === tipId);
    return results
      .sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime())
      .slice(0, limit);
  }

  const pool = getPool();
  if (tipId) {
    const res = await pool.query<{ full_handoff_json: ForensicsHandoff }>(
      `SELECT full_handoff_json FROM forensics_handoffs
       WHERE tip_id = $1 ORDER BY generated_at DESC LIMIT $2`,
      [tipId, limit]
    );
    return res.rows.map((r) => r.full_handoff_json);
  }

  const res = await pool.query<{ full_handoff_json: ForensicsHandoff }>(
    `SELECT full_handoff_json FROM forensics_handoffs
     ORDER BY generated_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows.map((r) => r.full_handoff_json);
}

export async function getForensicsHandoff(handoffId: string): Promise<ForensicsHandoff | null> {
  if (!isPostgres()) {
    return memStore.get(handoffId) ?? null;
  }

  const pool = getPool();
  const res = await pool.query<{ full_handoff_json: ForensicsHandoff }>(
    `SELECT full_handoff_json FROM forensics_handoffs WHERE handoff_id = $1`,
    [handoffId]
  );
  return res.rows[0]?.full_handoff_json ?? null;
}
