import { getPool } from "../../db/pool.js";
import { runTool, type ToolResult } from "../types.js";

export interface CaseSearchResult {
  tip_id: string;
  match_type: string;
  matched_value: string;
  relevance_score: number;
  tip_status: string;
  received_at: string;
  offense_category?: string;
  subject_name?: string;
}

export interface CaseSearchResponse {
  results: CaseSearchResult[];
  total_found: number;
  query: { entity_type: string; entity_value: string };
}

// Known-match test values for stubs
const STUB_KNOWN_MATCHES: Record<string, CaseSearchResult[]> = {
  "stub_known_subject": [{
    tip_id: "00000000-0000-0000-0000-000000000001",
    match_type: "subject_name",
    matched_value: "stub_known_subject",
    relevance_score: 0.95,
    tip_status: "in_investigation",
    received_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    offense_category: "CHILD_GROOMING",
    subject_name: "stub_known_subject",
  }],
  "192.168.1.100": [{
    tip_id: "00000000-0000-0000-0000-000000000002",
    match_type: "ip",
    matched_value: "192.168.1.100",
    relevance_score: 0.99,
    tip_status: "triaged",
    received_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    offense_category: "CSAM",
  }],
};

async function searchCaseDatabaseStub(
  entityType: string,
  entityValue: string,
  fuzzy: boolean = false,
  dateRangeDays: number = 365
): Promise<CaseSearchResponse> {
  await new Promise(r => setTimeout(r, 20)); // Simulate latency

  const results = STUB_KNOWN_MATCHES[entityValue] ?? [];

  return {
    results,
    total_found: results.length,
    query: { entity_type: entityType, entity_value: entityValue },
  };
}

async function searchCaseDatabaseReal(
  entityType: string,
  entityValue: string,
  fuzzy: boolean = false,
  dateRangeDays: number = 365
): Promise<CaseSearchResponse> {
  const pool = getPool();
  const sinceInterval = `${Math.max(1, Math.floor(dateRangeDays))} days`;

  // Hash lookups go straight to tip_files; all other entity types search extracted JSONB
  if (entityType === "hash") {
    const result = await pool.query<{
      tip_id: string;
      tip_status: string;
      received_at: Date;
      offense_category: string | null;
      subject_name: string | null;
    }>(
      `SELECT DISTINCT ON (ct.tip_id)
         ct.tip_id,
         ct.status                             AS tip_status,
         ct.received_at,
         ct.classification->>'offense_category' AS offense_category,
         ct.extracted->'subjects'->0->>'name'  AS subject_name
       FROM cyber_tips ct
       JOIN tip_files tf ON tf.tip_id = ct.tip_id
       WHERE (
           tf.hash_md5    = $1
        OR tf.hash_sha1   = $1
        OR tf.hash_sha256 = $1
        OR tf.photodna_hash = $1
       )
         AND ct.received_at > NOW() - $2::interval
       ORDER BY ct.tip_id, ct.received_at DESC`,
      [entityValue, sinceInterval]
    );

    const results: CaseSearchResult[] = result.rows.map((row) => ({
      tip_id: row.tip_id,
      match_type: "hash",
      matched_value: entityValue,
      relevance_score: 1.0,
      tip_status: row.tip_status,
      received_at: row.received_at instanceof Date
        ? row.received_at.toISOString()
        : String(row.received_at),
      offense_category: row.offense_category ?? undefined,
      subject_name: row.subject_name ?? undefined,
    }));

    return {
      results,
      total_found: results.length,
      query: { entity_type: entityType, entity_value: entityValue },
    };
  }

  // Map caller-facing entity type names to the JSONB array key in extracted
  const jsonbArrayKey: Record<string, string> = {
    ip:            "ip_addresses",
    ip_address:    "ip_addresses",
    email:         "email_addresses",
    email_address: "email_addresses",
    username:      "usernames",
    domain:        "domains",
    phone:         "phone_numbers",
    phone_number:  "phone_numbers",
    crypto:        "crypto_addresses",
    file_hash:     "file_hashes",
    url:           "urls",
  };

  // Subject-name searches use pg_trgm similarity; exact match uses = comparison
  if (entityType === "subject_name" || entityType === "name") {
    if (fuzzy) {
      const result = await pool.query<{
        tip_id: string;
        matched_value: string;
        relevance_score: string;
        tip_status: string;
        received_at: Date;
        offense_category: string | null;
      }>(
        `SELECT DISTINCT ON (ct.tip_id)
           ct.tip_id,
           subj->>'name'                          AS matched_value,
           similarity(subj->>'name', $1)          AS relevance_score,
           ct.status                              AS tip_status,
           ct.received_at,
           ct.classification->>'offense_category' AS offense_category
         FROM cyber_tips ct,
              jsonb_array_elements(ct.extracted->'subjects') subj
         WHERE subj->>'name' IS NOT NULL
           AND similarity(subj->>'name', $1) > 0.25
           AND ct.received_at > NOW() - $2::interval
         ORDER BY ct.tip_id, similarity(subj->>'name', $1) DESC`,
        [entityValue, sinceInterval]
      );

      const results: CaseSearchResult[] = result.rows.map((row) => ({
        tip_id: row.tip_id,
        match_type: "subject_name",
        matched_value: row.matched_value,
        relevance_score: parseFloat(row.relevance_score),
        tip_status: row.tip_status,
        received_at: row.received_at instanceof Date
          ? row.received_at.toISOString()
          : String(row.received_at),
        offense_category: row.offense_category ?? undefined,
        subject_name: row.matched_value,
      }));

      results.sort((a, b) => b.relevance_score - a.relevance_score);

      return {
        results,
        total_found: results.length,
        query: { entity_type: entityType, entity_value: entityValue },
      };
    }

    // Exact subject name match
    const result = await pool.query<{
      tip_id: string;
      matched_value: string;
      tip_status: string;
      received_at: Date;
      offense_category: string | null;
    }>(
      `SELECT DISTINCT ON (ct.tip_id)
         ct.tip_id,
         subj->>'name'                          AS matched_value,
         ct.status                              AS tip_status,
         ct.received_at,
         ct.classification->>'offense_category' AS offense_category
       FROM cyber_tips ct,
            jsonb_array_elements(ct.extracted->'subjects') subj
       WHERE lower(subj->>'name') = lower($1)
         AND ct.received_at > NOW() - $2::interval
       ORDER BY ct.tip_id, ct.received_at DESC`,
      [entityValue, sinceInterval]
    );

    const results: CaseSearchResult[] = result.rows.map((row) => ({
      tip_id: row.tip_id,
      match_type: "subject_name",
      matched_value: row.matched_value,
      relevance_score: 1.0,
      tip_status: row.tip_status,
      received_at: row.received_at instanceof Date
        ? row.received_at.toISOString()
        : String(row.received_at),
      offense_category: row.offense_category ?? undefined,
      subject_name: row.matched_value,
    }));

    return {
      results,
      total_found: results.length,
      query: { entity_type: entityType, entity_value: entityValue },
    };
  }

  // Generic entity search: look for exact value match inside the appropriate JSONB array.
  // Falls back to full extracted-text ILIKE for unknown entity types.
  const arrayKey = jsonbArrayKey[entityType];

  if (arrayKey) {
    let queryText: string;
    let queryParams: unknown[];

    if (fuzzy) {
      // Use pg_trgm similarity over the extracted text column for speed
      queryText = `
        SELECT DISTINCT ON (ct.tip_id)
          ct.tip_id,
          elem->>'value'                           AS matched_value,
          similarity(elem->>'value', $1)           AS relevance_score,
          ct.status                                AS tip_status,
          ct.received_at,
          ct.classification->>'offense_category'   AS offense_category,
          ct.extracted->'subjects'->0->>'name'     AS subject_name
        FROM cyber_tips ct,
             jsonb_array_elements(ct.extracted->'${arrayKey}') elem
        WHERE similarity(elem->>'value', $1) > 0.25
          AND ct.received_at > NOW() - $2::interval
        ORDER BY ct.tip_id, similarity(elem->>'value', $1) DESC`;
      queryParams = [entityValue, sinceInterval];
    } else {
      queryText = `
        SELECT DISTINCT ON (ct.tip_id)
          ct.tip_id,
          elem->>'value'                           AS matched_value,
          1.0                                      AS relevance_score,
          ct.status                                AS tip_status,
          ct.received_at,
          ct.classification->>'offense_category'   AS offense_category,
          ct.extracted->'subjects'->0->>'name'     AS subject_name
        FROM cyber_tips ct,
             jsonb_array_elements(ct.extracted->'${arrayKey}') elem
        WHERE lower(elem->>'value') = lower($1)
          AND ct.received_at > NOW() - $2::interval
        ORDER BY ct.tip_id, ct.received_at DESC`;
      queryParams = [entityValue, sinceInterval];
    }

    const result = await pool.query<{
      tip_id: string;
      matched_value: string;
      relevance_score: string;
      tip_status: string;
      received_at: Date;
      offense_category: string | null;
      subject_name: string | null;
    }>(queryText, queryParams);

    const results: CaseSearchResult[] = result.rows.map((row) => ({
      tip_id: row.tip_id,
      match_type: entityType,
      matched_value: row.matched_value,
      relevance_score: parseFloat(row.relevance_score),
      tip_status: row.tip_status,
      received_at: row.received_at instanceof Date
        ? row.received_at.toISOString()
        : String(row.received_at),
      offense_category: row.offense_category ?? undefined,
      subject_name: row.subject_name ?? undefined,
    }));

    if (fuzzy) results.sort((a, b) => b.relevance_score - a.relevance_score);

    return {
      results,
      total_found: results.length,
      query: { entity_type: entityType, entity_value: entityValue },
    };
  }

  // Unknown entity type: fall back to ILIKE search across the entire extracted text
  const result = await pool.query<{
    tip_id: string;
    tip_status: string;
    received_at: Date;
    offense_category: string | null;
    subject_name: string | null;
  }>(
    `SELECT
       ct.tip_id,
       ct.status                              AS tip_status,
       ct.received_at,
       ct.classification->>'offense_category' AS offense_category,
       ct.extracted->'subjects'->0->>'name'   AS subject_name
     FROM cyber_tips ct
     WHERE ct.extracted::text ILIKE $1
       AND ct.received_at > NOW() - $2::interval
     ORDER BY ct.received_at DESC`,
    [`%${entityValue}%`, sinceInterval]
  );

  const results: CaseSearchResult[] = result.rows.map((row) => ({
    tip_id: row.tip_id,
    match_type: entityType,
    matched_value: entityValue,
    relevance_score: 0.5,
    tip_status: row.tip_status,
    received_at: row.received_at instanceof Date
      ? row.received_at.toISOString()
      : String(row.received_at),
    offense_category: row.offense_category ?? undefined,
    subject_name: row.subject_name ?? undefined,
  }));

  return {
    results,
    total_found: results.length,
    query: { entity_type: entityType, entity_value: entityValue },
  };
}

export async function searchCaseDatabase(
  entityType: string,
  entityValue: string,
  fuzzy: boolean = false,
  dateRangeDays: number = 365
): Promise<ToolResult<CaseSearchResponse>> {
  const fn = process.env["TOOL_MODE"] === "real"
    ? searchCaseDatabaseReal
    : searchCaseDatabaseStub;
  return runTool(() => fn(entityType, entityValue, fuzzy, dateRangeDays));
}
