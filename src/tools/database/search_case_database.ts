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
  // TODO: Implement with PostgreSQL + pg-trgm for fuzzy search
  // Requires: DB_URL env var, connection pool from src/db/pool.ts
  throw new Error("Real database not configured. Set TOOL_MODE=real and DB_URL.");
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
