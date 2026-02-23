import { getPool } from "./pool.js";
import type { Agency } from "../models/index.js";
import { v4 as uuidv4 } from "uuid";

// ── In-memory fallback for dev / test ─────────────────────────────────────────

const memStore = new Map<string, Agency>();

function isPostgres(): boolean {
  return process.env["DB_MODE"] === "postgres";
}

function initializeMemStore() {
  const envKeys = (process.env["INTER_AGENCY_API_KEYS"] ?? "").split(",").filter(k => k.trim().length > 0);
  for (const key of envKeys) {
    const trimmedKey = key.trim();
    // Check if already exists to avoid duplicates if called multiple times (though we have the flag)
    let exists = false;
    for (const agency of memStore.values()) {
      if (agency.api_key === trimmedKey) {
        exists = true;
        break;
      }
    }

    if (!exists) {
      const agency: Agency = {
        agency_id: uuidv4(),
        name: "Env-Configured Agency", // Default name since env var only has keys
        api_key: trimmedKey,
        status: "active",
        created_at: new Date().toISOString(),
      };
      memStore.set(agency.agency_id, agency);
    }
  }
}

// ── Read: Get agency by API key ───────────────────────────────────────────────

export async function getAgencyByKey(apiKey: string): Promise<Agency | null> {
  if (!isPostgres()) {
    initializeMemStore();
    for (const agency of memStore.values()) {
      if (agency.api_key === apiKey) {
        return agency;
      }
    }
    return null;
  }

  const pool = getPool();
  const result = await pool.query<Agency>(
    `SELECT * FROM agencies WHERE api_key = $1`,
    [apiKey]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0];
}

// ── Write: Create or update agency (mainly for testing/seeding) ───────────────

export async function upsertAgency(agency: Agency): Promise<void> {
  if (!isPostgres()) {
    initializeMemStore();
    memStore.set(agency.agency_id, agency);
    return;
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO agencies (agency_id, name, api_key, status, contact_email, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (agency_id) DO UPDATE SET
       name = EXCLUDED.name,
       api_key = EXCLUDED.api_key,
       status = EXCLUDED.status,
       contact_email = EXCLUDED.contact_email`,
    [
      agency.agency_id,
      agency.name,
      agency.api_key,
      agency.status,
      agency.contact_email ?? null,
      agency.created_at,
    ]
  );
}
