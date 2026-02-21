import { runTool, type ToolResult } from "../types.js";
import type { WarrantStatus } from "../../models/index.js";

// ── In-memory warrant store for stubs / testing ──────────────────────────────
const WARRANT_STORE: Map<string, WarrantStatus> = new Map();

/** Key format: "tip_id::file_id" */
function warrantKey(tipId: string, fileId: string): string {
  return `${tipId}::${fileId}`;
}

// Pre-seed known test states
// "test_granted" tip_id → all files return "granted"
export function seedWarrantStatus(tipId: string, fileId: string, status: WarrantStatus): void {
  WARRANT_STORE.set(warrantKey(tipId, fileId), status);
}

export function clearWarrantStore(): void {
  WARRANT_STORE.clear();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface WarrantStatusResult {
  tip_id: string;
  file_id: string;
  status: WarrantStatus;
  warrant_number?: string;
  granted_by?: string;
  updated_at?: string;
}

export interface WarrantUpdateResult {
  tip_id: string;
  file_id: string;
  previous_status: WarrantStatus;
  new_status: WarrantStatus;
  warrant_number?: string;
  granted_by?: string;
  updated_at: string;
}

// ── get_warrant_status ───────────────────────────────────────────────────────

async function getWarrantStatusStub(
  tipId: string,
  fileId: string
): Promise<WarrantStatusResult> {
  await new Promise(r => setTimeout(r, 10));

  // Special test tip_id: "test_granted_*" → return granted
  if (tipId.startsWith("test_granted")) {
    return {
      tip_id: tipId,
      file_id: fileId,
      status: "granted",
      warrant_number: "TEST-WARRANT-001",
      granted_by: "Judge Test",
      updated_at: new Date().toISOString(),
    };
  }

  const stored = WARRANT_STORE.get(warrantKey(tipId, fileId));
  return {
    tip_id: tipId,
    file_id: fileId,
    status: stored ?? "applied",
  };
}

async function getWarrantStatusReal(tipId: string, fileId: string): Promise<WarrantStatusResult> {
  throw new Error("Real warrant DB not configured.");
}

export async function getWarrantStatus(
  tipId: string,
  fileId: string
): Promise<ToolResult<WarrantStatusResult>> {
  const fn = process.env["TOOL_MODE"] === "real" ? getWarrantStatusReal : getWarrantStatusStub;
  return runTool(() => fn(tipId, fileId));
}

// ── update_warrant_status ────────────────────────────────────────────────────

async function updateWarrantStatusStub(
  tipId: string,
  fileId: string,
  status: "applied" | "granted" | "denied",
  warrantNumber?: string,
  grantedBy?: string
): Promise<WarrantUpdateResult> {
  await new Promise(r => setTimeout(r, 10));

  const key = warrantKey(tipId, fileId);
  const previous = WARRANT_STORE.get(key) ?? "applied";
  WARRANT_STORE.set(key, status);

  return {
    tip_id: tipId,
    file_id: fileId,
    previous_status: previous,
    new_status: status,
    warrant_number: warrantNumber,
    granted_by: grantedBy,
    updated_at: new Date().toISOString(),
  };
}

async function updateWarrantStatusReal(
  tipId: string,
  fileId: string,
  status: "applied" | "granted" | "denied",
  warrantNumber?: string,
  grantedBy?: string
): Promise<WarrantUpdateResult> {
  throw new Error("Real warrant DB not configured.");
}

export async function updateWarrantStatus(
  tipId: string,
  fileId: string,
  status: "applied" | "granted" | "denied",
  warrantNumber?: string,
  grantedBy?: string
): Promise<ToolResult<WarrantUpdateResult>> {
  const fn = process.env["TOOL_MODE"] === "real" ? updateWarrantStatusReal : updateWarrantStatusStub;
  return runTool(() => fn(tipId, fileId, status, warrantNumber, grantedBy));
}
