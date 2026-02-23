/**
 * Tip Repository — PostgreSQL persistence layer
 *
 * This is the single data access layer for all CyberTip CRUD operations.
 * All routes and the orchestrator call these functions; nothing else talks
 * to the database directly (except the audit module, which is append-only).
 *
 * Design decisions:
 *  - Tips are stored with JSONB columns for agent outputs (classification,
 *    priority, etc.) so the schema doesn't need to change as agents evolve.
 *  - Files are in a normalized tip_files table for hash lookups across tips.
 *  - All writes use upsertTip() — idempotent on tip_id, safe to call repeatedly
 *    as the orchestrator pipeline updates the tip incrementally.
 *  - All queries are parameterized — no string interpolation.
 *  - In non-postgres environments (dev/test), falls back to in-memory store.
 */

import { getPool } from "./pool.js";
import type { CyberTip, TipFile } from "../models/index.js";

// ── In-memory fallback for dev / test ─────────────────────────────────────────

const memStore = new Map<string, CyberTip>();

function isPostgres(): boolean {
  return process.env["DB_MODE"] === "postgres";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ListTipsOptions {
  tier?: string;
  status?: string;
  unit?: string;
  limit?: number;
  offset?: number;
  /** Only return tips with victim_crisis_alert=true */
  crisis_only?: boolean;
  /** Return tips received at or after this ISO timestamp */
  since?: string;
}

export interface ListTipsResult {
  tips: CyberTip[];
  total: number;
}

// ── Write: upsert a full tip after pipeline processing ────────────────────────

/**
 * Persist (or update) a tip and all its associated files.
 * Safe to call multiple times — uses ON CONFLICT DO UPDATE.
 * Runs tip row + file rows in a single transaction.
 */
export async function upsertTip(tip: CyberTip): Promise<void> {
  if (!isPostgres()) {
    memStore.set(tip.tip_id, tip);
    return;
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Upsert main tip row
    await client.query(
      `INSERT INTO cyber_tips (
         tip_id, ncmec_tip_number, ids_case_number, source, received_at,
         raw_body, normalized_body, status, is_bundled, bundled_incident_count,
         ncmec_urgent_flag, reporter, jurisdiction_of_tip, legal_status,
         extracted, hash_matches, classification, links, priority, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW()
       )
       ON CONFLICT (tip_id) DO UPDATE SET
         status              = EXCLUDED.status,
         normalized_body     = EXCLUDED.normalized_body,
         legal_status        = EXCLUDED.legal_status,
         extracted           = EXCLUDED.extracted,
         hash_matches        = EXCLUDED.hash_matches,
         classification      = EXCLUDED.classification,
         links               = EXCLUDED.links,
         priority            = EXCLUDED.priority,
         updated_at          = NOW()`,
      [
        tip.tip_id,
        tip.ncmec_tip_number ?? null,
        tip.ids_case_number ?? null,
        tip.source,
        tip.received_at,
        tip.raw_body,
        tip.normalized_body,
        tip.status,
        tip.is_bundled,
        tip.bundled_incident_count ?? null,
        tip.ncmec_urgent_flag,
        JSON.stringify(tip.reporter),
        JSON.stringify(tip.jurisdiction_of_tip),
        tip.legal_status ? JSON.stringify(tip.legal_status) : null,
        tip.extracted ? JSON.stringify(tip.extracted) : null,
        tip.hash_matches ? JSON.stringify(tip.hash_matches) : null,
        tip.classification ? JSON.stringify(tip.classification) : null,
        tip.links ? JSON.stringify(tip.links) : null,
        tip.priority ? JSON.stringify(tip.priority) : null,
      ]
    );

    // Upsert files — delete old + insert fresh keeps it simple and correct
    await client.query("DELETE FROM tip_files WHERE tip_id = $1", [tip.tip_id]);

    // ⚡ Bolt Optimization: Batch insert files (1 query instead of N)
    if (tip.files.length > 0) {
      const fileValues: unknown[] = [];
      const filePlaceholders: string[] = [];
      let pIdx = 1;

      for (const file of tip.files) {
        filePlaceholders.push(`(
          $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++},
          $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++},
          $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++},
          $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++},
          $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++},
          $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}
        )`);

        fileValues.push(
          file.file_id,
          tip.tip_id,
          file.filename ?? null,
          file.media_type,
          file.hash_md5 ?? null,
          file.hash_sha1 ?? null,
          file.hash_sha256 ?? null,
          file.photodna_hash ?? null,
          file.esp_viewed,
          file.esp_viewed_missing,
          file.esp_categorized_as ?? null,
          file.publicly_available,
          file.warrant_required,
          file.warrant_status,
          file.warrant_number ?? null,
          file.warrant_granted_by ?? null,
          file.file_access_blocked,
          file.ncmec_hash_match,
          file.project_vic_match,
          file.iwf_match,
          file.interpol_icse_match,
          file.aig_csam_suspected,
          file.aig_detection_confidence ?? null,
          file.aig_detection_method ?? null
        );
      }

      await client.query(
        `INSERT INTO tip_files (
           file_id, tip_id, filename, media_type,
           hash_md5, hash_sha1, hash_sha256, photodna_hash,
           esp_viewed, esp_viewed_missing, esp_categorized_as, publicly_available,
           warrant_required, warrant_status, warrant_number, warrant_granted_by,
           file_access_blocked,
           ncmec_hash_match, project_vic_match, iwf_match, interpol_icse_match,
           aig_csam_suspected, aig_detection_confidence, aig_detection_method
         ) VALUES ${filePlaceholders.join(", ")}
         ON CONFLICT (file_id) DO UPDATE SET
           warrant_status          = EXCLUDED.warrant_status,
           warrant_number          = EXCLUDED.warrant_number,
           warrant_granted_by      = EXCLUDED.warrant_granted_by,
           file_access_blocked     = EXCLUDED.file_access_blocked,
           ncmec_hash_match        = EXCLUDED.ncmec_hash_match,
           project_vic_match       = EXCLUDED.project_vic_match,
           iwf_match               = EXCLUDED.iwf_match,
           interpol_icse_match     = EXCLUDED.interpol_icse_match,
           aig_csam_suspected      = EXCLUDED.aig_csam_suspected,
           aig_detection_confidence= EXCLUDED.aig_detection_confidence,
           aig_detection_method    = EXCLUDED.aig_detection_method`,
        fileValues
      );
    }

    // Upsert preservation requests
    // ⚡ Bolt Optimization: Batch insert preservation requests
    if (tip.preservation_requests.length > 0) {
      const prValues: unknown[] = [];
      const prPlaceholders: string[] = [];
      let pIdx = 1;

      for (const pr of tip.preservation_requests) {
        prPlaceholders.push(`(
          $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++},
          $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++},
          $${pIdx++}, $${pIdx++}, $${pIdx++}
        )`);

        prValues.push(
          pr.request_id,
          tip.tip_id,
          pr.esp_name,
          JSON.stringify(pr.account_identifiers),
          pr.legal_basis,
          pr.jurisdiction,
          pr.issued_at ?? null,
          pr.deadline_for_esp_response ?? null,
          pr.esp_retention_window_days ?? null,
          pr.status,
          pr.auto_generated,
          pr.approved_by ?? null,
          pr.letter_text ?? null
        );
      }

      await client.query(
        `INSERT INTO preservation_requests (
           request_id, tip_id, esp_name, account_identifiers, legal_basis,
           jurisdiction, issued_at, deadline_for_esp_response,
           esp_retention_window_days, status, auto_generated,
           approved_by, letter_text
         ) VALUES ${prPlaceholders.join(", ")}
         ON CONFLICT (request_id) DO UPDATE SET
           status        = EXCLUDED.status,
           issued_at     = EXCLUDED.issued_at,
           approved_by   = EXCLUDED.approved_by,
           letter_text   = EXCLUDED.letter_text,
           updated_at    = NOW()`,
        prValues
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Read: single tip by ID ────────────────────────────────────────────────────

export async function getTipById(tipId: string): Promise<CyberTip | null> {
  if (!isPostgres()) {
    return memStore.get(tipId) ?? null;
  }

  const pool = getPool();

  // Fetch tip row
  const tipRow = await pool.query<TipRow>(
    `SELECT * FROM cyber_tips WHERE tip_id = $1`,
    [tipId]
  );
  if (tipRow.rows.length === 0) return null;

  // Fetch associated data concurrently
  const [filesRow, presRow, auditRow] = await Promise.all([
    pool.query<FileRow>(
      `SELECT * FROM tip_files WHERE tip_id = $1 ORDER BY created_at`,
      [tipId]
    ),
    pool.query<Record<string, unknown>>(
      `SELECT * FROM preservation_requests WHERE tip_id = $1 ORDER BY created_at`,
      [tipId]
    ),
    pool.query<Record<string, unknown>>(
      `SELECT * FROM audit_log WHERE tip_id = $1 ORDER BY timestamp LIMIT 100`,
      [tipId]
    ),
  ]);

  return assembleTip(tipRow.rows[0]!, filesRow.rows, presRow.rows, auditRow.rows);
}

// ── Read: paginated tip list with tier filtering ──────────────────────────────

export async function listTips(opts: ListTipsOptions = {}): Promise<ListTipsResult> {
  const limit = Math.min(opts.limit ?? 200, 500);
  const offset = opts.offset ?? 0;

  if (!isPostgres()) {
    let tips = Array.from(memStore.values());

    if (opts.tier) {
      tips = tips.filter((t) => t.priority?.tier === opts.tier);
    }
    if (opts.status) {
      tips = tips.filter((t) => t.status === opts.status);
    }
    if (opts.crisis_only) {
      tips = tips.filter(
        (t) =>
          t.priority?.victim_crisis_alert === true ||
          t.classification?.sextortion_victim_in_crisis === true
      );
    }
    if (opts.since) {
      const sinceTime = new Date(opts.since).getTime();
      tips = tips.filter((t) => new Date(t.received_at).getTime() >= sinceTime);
    }

    // Sort: tier order, then score descending
    const tierOrder: Record<string, number> = {
      IMMEDIATE: 0, URGENT: 1, PAUSED: 2, STANDARD: 3, MONITOR: 4,
    };
    tips.sort((a, b) => {
      const ta = tierOrder[a.priority?.tier ?? ""] ?? 99;
      const tb = tierOrder[b.priority?.tier ?? ""] ?? 99;
      if (ta !== tb) return ta - tb;
      return (b.priority?.score ?? 0) - (a.priority?.score ?? 0);
    });

    const total = tips.length;
    return { tips: tips.slice(offset, offset + limit), total };
  }

  const pool = getPool();

  // Build WHERE clause dynamically
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (opts.tier) {
    conditions.push(`priority->>'tier' = $${paramIdx++}`);
    params.push(opts.tier);
  }
  if (opts.status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(opts.status);
  }
  if (opts.crisis_only) {
    conditions.push(
      `(priority->>'victim_crisis_alert' = 'true' OR classification->>'sextortion_victim_in_crisis' = 'true')`
    );
  }
  if (opts.since) {
    conditions.push(`received_at >= $${paramIdx++}`);
    params.push(opts.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count query
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM cyber_tips ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0]!.count, 10);

  // Data query — sorted by tier priority then score, paginated
  const dataResult = await pool.query<TipRow>(
    `SELECT * FROM cyber_tips ${where}
     ORDER BY
       CASE priority->>'tier'
         WHEN 'IMMEDIATE' THEN 0
         WHEN 'URGENT'    THEN 1
         WHEN 'PAUSED'    THEN 2
         WHEN 'STANDARD'  THEN 3
         WHEN 'MONITOR'   THEN 4
         ELSE 99
       END ASC,
       (priority->>'score')::numeric DESC NULLS LAST,
       received_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset]
  );

  // For list view, fetch files inline (one additional query batched)
  const tipIds = dataResult.rows.map((r) => r.tip_id);
  let allFiles: FileRow[] = [];
  if (tipIds.length > 0) {
    const filesResult = await pool.query<FileRow>(
      `SELECT * FROM tip_files WHERE tip_id = ANY($1) ORDER BY created_at`,
      [tipIds]
    );
    allFiles = filesResult.rows;
  }

  const tips = dataResult.rows.map((row) => {
    const files = allFiles.filter((f) => f.tip_id === row.tip_id);
    return assembleTip(row, files, [], []);
  });

  return { tips, total };
}

// ── Write: update a single file's warrant status ──────────────────────────────

export async function updateFileWarrant(
  tipId: string,
  fileId: string,
  warrantStatus: string,
  warrantNumber?: string,
  grantedBy?: string
): Promise<TipFile | null> {
  if (!isPostgres()) {
    const tip = memStore.get(tipId);
    if (!tip) return null;
    const file = tip.files.find((f: import("../models/index.js").TipFile) => f.file_id === fileId);
    if (!file) return null;

    const updated = {
      ...file,
      warrant_status: warrantStatus as TipFile["warrant_status"],
      warrant_number: warrantNumber,
      warrant_granted_by: grantedBy,
      file_access_blocked: warrantStatus !== "granted",
    };

    const updatedTip = {
      ...tip,
      files: tip.files.map((f: import("../models/index.js").TipFile) => (f.file_id === fileId ? updated : f)),
    };
    memStore.set(tipId, updatedTip);
    return updated;
  }

  const pool = getPool();
  const result = await pool.query<FileRow>(
    `UPDATE tip_files SET
       warrant_status      = $1,
       warrant_number      = COALESCE($2, warrant_number),
       warrant_granted_by  = COALESCE($3, warrant_granted_by),
       file_access_blocked = ($1 <> 'granted' AND warrant_required = TRUE)
     WHERE file_id = $4 AND tip_id = $5
     RETURNING *`,
    [warrantStatus, warrantNumber ?? null, grantedBy ?? null, fileId, tipId]
  );

  if (result.rows.length === 0) return null;
  return assembleFile(result.rows[0]!);
}

// ── Write: mark a preservation request as issued ──────────────────────────────

export async function issuePreservationRequest(
  requestId: string,
  approvedBy?: string
): Promise<boolean> {
  if (!isPostgres()) {
    for (const tip of memStore.values()) {
      const pr = tip.preservation_requests.find((r: import("../models/index.js").PreservationRequest) => r.request_id === requestId);
      if (pr) {
        (pr as Record<string, unknown>)["status"] = "issued";
        (pr as Record<string, unknown>)["issued_at"] = new Date().toISOString();
        (pr as Record<string, unknown>)["approved_by"] = approvedBy;
        return true;
      }
    }
    return false;
  }

  const pool = getPool();
  const result = await pool.query(
    `UPDATE preservation_requests
     SET status = 'issued', issued_at = NOW(), approved_by = $1, updated_at = NOW()
     WHERE request_id = $2`,
    [approvedBy ?? null, requestId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ── Read: stats for dashboard header ─────────────────────────────────────────

export interface TipStats {
  total: number;
  by_tier: Record<string, number>;
  crisis_alerts: number;
  blocked: number;
}

export async function getTipStats(): Promise<TipStats> {
  if (!isPostgres()) {
    const tips = Array.from(memStore.values());

    let total = 0;
    let crisis_alerts = 0;
    let blocked = 0;
    const by_tier: Record<string, number> = {
      IMMEDIATE: 0, URGENT: 0, PAUSED: 0, STANDARD: 0, MONITOR: 0,
    };

    for (const t of tips) {
      total++;
      if (t.priority?.victim_crisis_alert === true) {
        crisis_alerts++;
      }
      if (t.status === "BLOCKED") {
        blocked++;
      }
      const tier = t.priority?.tier;
      if (tier && tier in by_tier) {
        by_tier[tier]++;
      }
    }

    return {
      total,
      by_tier,
      crisis_alerts,
      blocked,
    };
  }

  const pool = getPool();
  // ⚡ Bolt Optimization: Combined 3 sequential queries into 1 using FILTER aggregation
  const result = await pool.query<{
    tier: string | null;
    count: string;
    crisis_count: string;
    blocked_count: string;
  }>(
    `SELECT
       priority->>'tier' as tier,
       COUNT(*) as count,
       COUNT(*) FILTER (WHERE priority->>'victim_crisis_alert' = 'true') as crisis_count,
       COUNT(*) FILTER (WHERE status = 'BLOCKED') as blocked_count
     FROM cyber_tips
     GROUP BY priority->>'tier'`
  );

  const by_tier: Record<string, number> = {
    IMMEDIATE: 0, URGENT: 0, PAUSED: 0, STANDARD: 0, MONITOR: 0,
  };

  let total = 0;
  let crisis_alerts = 0;
  let blocked = 0;

  for (const row of result.rows) {
    const count = parseInt(row.count, 10);
    const crisis = parseInt(row.crisis_count, 10);
    const blk = parseInt(row.blocked_count, 10);

    if (row.tier && row.tier in by_tier) {
      by_tier[row.tier] = count;
    }

    total += count;
    crisis_alerts += crisis;
    blocked += blk;
  }

  return {
    total,
    by_tier,
    crisis_alerts,
    blocked,
  };
}

// ── Internal assembly helpers ─────────────────────────────────────────────────

interface TipRow {
  tip_id: string;
  ncmec_tip_number: string | null;
  ids_case_number: string | null;
  source: string;
  received_at: Date;
  raw_body: string;
  normalized_body: string | null;
  status: string;
  is_bundled: boolean;
  bundled_incident_count: number | null;
  ncmec_urgent_flag: boolean;
  reporter: unknown;
  jurisdiction_of_tip: unknown;
  legal_status: unknown;
  extracted: unknown;
  hash_matches: unknown;
  classification: unknown;
  links: unknown;
  priority: unknown;
}

interface FileRow {
  file_id: string;
  tip_id: string;
  filename: string | null;
  media_type: string;
  hash_md5: string | null;
  hash_sha1: string | null;
  hash_sha256: string | null;
  photodna_hash: string | null;
  esp_viewed: boolean;
  esp_viewed_missing: boolean;
  esp_categorized_as: string | null;
  publicly_available: boolean;
  warrant_required: boolean;
  warrant_status: string;
  warrant_number: string | null;
  warrant_granted_by: string | null;
  file_access_blocked: boolean;
  ncmec_hash_match: boolean;
  project_vic_match: boolean;
  iwf_match: boolean;
  interpol_icse_match: boolean;
  aig_csam_suspected: boolean;
  aig_detection_confidence: string | null;
  aig_detection_method: string | null;
}

function assembleFile(row: FileRow): TipFile {
  return {
    file_id: row.file_id,
    filename: row.filename ?? undefined,
    media_type: row.media_type as TipFile["media_type"],
    hash_md5: row.hash_md5 ?? undefined,
    hash_sha1: row.hash_sha1 ?? undefined,
    hash_sha256: row.hash_sha256 ?? undefined,
    photodna_hash: row.photodna_hash ?? undefined,
    esp_viewed: row.esp_viewed,
    esp_viewed_missing: row.esp_viewed_missing,
    esp_categorized_as: row.esp_categorized_as ?? undefined,
    publicly_available: row.publicly_available,
    warrant_required: row.warrant_required,
    warrant_status: row.warrant_status as TipFile["warrant_status"],
    warrant_number: row.warrant_number ?? undefined,
    warrant_granted_by: row.warrant_granted_by ?? undefined,
    file_access_blocked: row.file_access_blocked,
    ncmec_hash_match: row.ncmec_hash_match,
    project_vic_match: row.project_vic_match,
    iwf_match: row.iwf_match,
    interpol_icse_match: row.interpol_icse_match,
    aig_csam_suspected: row.aig_csam_suspected,
    aig_detection_confidence: row.aig_detection_confidence
      ? parseFloat(row.aig_detection_confidence)
      : undefined,
    aig_detection_method: row.aig_detection_method ?? undefined,
  };
}

function assembleTip(
  row: TipRow,
  fileRows: FileRow[],
  presRows: Record<string, unknown>[],
  auditRows: Record<string, unknown>[]
): CyberTip {
  return {
    tip_id: row.tip_id,
    ncmec_tip_number: row.ncmec_tip_number ?? undefined,
    ids_case_number: row.ids_case_number ?? undefined,
    source: row.source as CyberTip["source"],
    received_at: row.received_at instanceof Date
      ? row.received_at.toISOString()
      : String(row.received_at),
    raw_body: row.raw_body,
    normalized_body: row.normalized_body ?? "",
    status: row.status as CyberTip["status"],
    is_bundled: row.is_bundled,
    bundled_incident_count: row.bundled_incident_count ?? undefined,
    ncmec_urgent_flag: row.ncmec_urgent_flag,
    reporter: row.reporter as CyberTip["reporter"],
    jurisdiction_of_tip: row.jurisdiction_of_tip as CyberTip["jurisdiction_of_tip"],
    legal_status: row.legal_status as CyberTip["legal_status"],
    extracted: row.extracted as CyberTip["extracted"],
    hash_matches: row.hash_matches as CyberTip["hash_matches"],
    classification: row.classification as CyberTip["classification"],
    links: row.links as CyberTip["links"],
    priority: row.priority as CyberTip["priority"],
    files: fileRows.map(assembleFile),
    preservation_requests: presRows as CyberTip["preservation_requests"],
    audit_trail: auditRows as CyberTip["audit_trail"],
  };
}
