/**
 * MLAT Request Repository — PostgreSQL persistence layer
 *
 * Persists generated MLAT/CLOUD Act requests.
 */

import { getPool } from "./pool.js";
import type { MLATRequestResult } from "../tools/legal/mlat_generator.js";

// ── In-memory fallback ────────────────────────────────────────────────────────

const memStore = new Map<string, MLATRequestResult>();

function isPostgres(): boolean {
  return process.env["DB_MODE"] === "postgres";
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function saveMLATRequest(req: MLATRequestResult): Promise<void> {
  if (!isPostgres()) {
    memStore.set(req.tracking_id, req);
    return;
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO mlat_requests (
       request_id, tip_id, target_country, mechanism, status, tracking_id,
       request_body, preservation_body, target_accounts, full_request_json, created_at, updated_at
     ) VALUES (
       gen_random_uuid(), $1, $2, $3, 'generated', $4, $5, $6, $7, $8, NOW(), NOW()
     )
     ON CONFLICT (tracking_id) DO UPDATE SET
       request_body      = EXCLUDED.request_body,
       preservation_body = EXCLUDED.preservation_body,
       target_accounts   = EXCLUDED.target_accounts,
       full_request_json = EXCLUDED.full_request_json,
       updated_at        = NOW()`,
    [
      req.tip_id,
      req.subject_country,
      req.recommended_mechanism,
      req.tracking_id,
      req.request_draft,
      req.preservation_draft,
      req.target_accounts,
      JSON.stringify(req),
    ]
  );
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function listMLATRequests(limit = 100, offset = 0): Promise<{ requests: MLATRequestResult[]; total: number }> {
  if (!isPostgres()) {
    const sorted = Array.from(memStore.values())
      .sort((a, b) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());
    return {
      requests: sorted.slice(offset, offset + limit),
      total: sorted.length,
    };
  }

  const pool = getPool();
  const [dataRes, countRes] = await Promise.all([
    pool.query<{ full_request_json: MLATRequestResult }>(
      `SELECT full_request_json FROM mlat_requests ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    ),
    pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM mlat_requests`),
  ]);

  return {
    requests: dataRes.rows.map(r => r.full_request_json),
    total: parseInt(countRes.rows[0]?.count ?? "0", 10),
  };
}
