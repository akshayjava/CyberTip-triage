/**
 * Legal Precedents DB Layer
 *
 * Persists the circuit precedent log and rule overrides to PostgreSQL.
 * In dev/test (DB_MODE != postgres), falls back to the in-memory module arrays.
 *
 * This solves P0: previously, supervisor-submitted precedents were lost on
 * restart and never updated the deterministic warrant logic.
 *
 * Two tables (see migration 003):
 *   legal_precedents      — full log of all circuit opinions (replaces PRECEDENT_LOG array)
 *   circuit_rule_overrides — supervisor-set overrides to CIRCUIT_RULES binding_precedent + application
 *
 * On server startup, call loadPrecedentsFromDB() to hydrate the in-memory arrays
 * from the database. After that, the existing circuit_guide.ts lookup functions
 * work as before, but now reflect the persisted state.
 */

import { getPool } from "./pool.js";
import type { PrecedentUpdate, FederalCircuit, CircuitRule } from "../compliance/circuit_guide.js";

function isPostgres(): boolean {
  return process.env["DB_MODE"] === "postgres";
}

// ── Types for DB rows ─────────────────────────────────────────────────────────

interface PrecedentRow {
  precedent_id: string;
  date: Date;
  circuit: string;
  case_name: string;
  citation: string;
  effect: string;
  summary: string;
  added_by: string;
  created_at: Date;
}

interface OverrideRow {
  circuit: string;
  binding_precedent: string | null;
  application: string;
  file_access_standard: string | null;
  updated_at: Date;
  updated_by: string;
}

// ── Read: load all precedents from DB ─────────────────────────────────────────

export async function loadPrecedentsFromDB(): Promise<PrecedentUpdate[]> {
  if (!isPostgres()) return [];

  const pool = getPool();
  const result = await pool.query<PrecedentRow>(
    `SELECT * FROM legal_precedents ORDER BY date DESC`
  );

  return result.rows.map(row => ({
    date:      row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
    circuit:   row.circuit as FederalCircuit,
    case_name: row.case_name,
    citation:  row.citation,
    effect:    row.effect as PrecedentUpdate["effect"],
    summary:   row.summary,
    added_by:  row.added_by,
  }));
}

// ── Write: save a new precedent to DB ─────────────────────────────────────────

export async function savePrecedentToDB(update: PrecedentUpdate): Promise<void> {
  if (!isPostgres()) return;

  const pool = getPool();
  await pool.query(
    `INSERT INTO legal_precedents (date, circuit, case_name, citation, effect, summary, added_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [
      update.date,
      update.circuit,
      update.case_name,
      update.citation,
      update.effect,
      update.summary,
      update.added_by,
    ]
  );
}

// ── Read: load circuit rule overrides ─────────────────────────────────────────

export async function loadCircuitOverridesFromDB(): Promise<OverrideRow[]> {
  if (!isPostgres()) return [];

  const pool = getPool();
  const result = await pool.query<OverrideRow>(
    `SELECT * FROM circuit_rule_overrides`
  );
  return result.rows;
}

// ── Write: persist a circuit rule override ────────────────────────────────────

export async function saveCircuitOverrideToDB(
  circuit: FederalCircuit,
  binding_precedent: string | null,
  application: CircuitRule["application"],
  file_access_standard: string,
  updated_by: string
): Promise<void> {
  if (!isPostgres()) return;

  const pool = getPool();
  await pool.query(
    `INSERT INTO circuit_rule_overrides
       (circuit, binding_precedent, application, file_access_standard, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (circuit) DO UPDATE SET
       binding_precedent    = EXCLUDED.binding_precedent,
       application          = EXCLUDED.application,
       file_access_standard = EXCLUDED.file_access_standard,
       updated_at           = NOW(),
       updated_by           = EXCLUDED.updated_by`,
    [circuit, binding_precedent, application, file_access_standard, updated_by]
  );
}
