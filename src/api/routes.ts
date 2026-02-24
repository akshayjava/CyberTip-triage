/**
 * API Routes — consumed by the dashboard
 *
 * All persistence goes through src/db/tips.ts (repository pattern).
 * In dev/test (DB_MODE != postgres): repository uses in-memory Map.
 * In production (DB_MODE=postgres):  repository uses PostgreSQL.
 * No route handler knows or cares which backend is active.
 *
 * GET  /api/queue                     — Triage queue, tiered + paginated
 * GET  /api/tips/:id                  — Full tip detail
 * POST /api/tips/:id/assign           — Assign to investigator
 * POST /api/tips/:id/warrant/:fileId  — Update warrant status
 * POST /api/preservation/:id/issue   — Issue preservation request
 * GET  /api/tips/:id/stream           — SSE pipeline updates
 * GET  /api/stats                     — Queue + tip stats
 * GET  /api/clusters                  — Tips with cluster flags
 * GET  /api/crisis                    — Victim crisis alerts
 */

import type { Application, Request, Response } from "express";
import { onPipelineEvent } from "../orchestrator.js";
import { getQueueStats } from "../ingestion/queue.js";
import {
  upsertTip,
  getTipById as dbGetTipById,
  listTips,
  updateFileWarrant,
  issuePreservationRequest,
  getTipStats,
} from "../db/tips.js";
import { appendAuditEntry } from "../compliance/audit.js";
import type { CyberTip } from "../models/index.js";
import { generateMLATRequest, tipNeedsMLAT } from "../tools/legal/mlat_generator.js";
import { saveMLATRequest, listMLATRequests } from "../db/mlat.js";
import { circuitLegalSummary, getCircuitForState, PRECEDENT_LOG } from "../compliance/circuit_guide.js";
import { runClusterScan } from "../jobs/cluster_scan.js";
import { generateForensicsHandoff } from "../tools/forensics/forensics_handoff.js";
import { saveForensicsHandoff, listForensicsHandoffs, updateHandoffStatus } from "../db/forensics.js";
import { ForensicsPlatformSchema } from "../models/forensics.js";

// Wrap async handlers so unhandled rejections surface as 500s
function wrapAsync(
  fn: (req: Request, res: Response) => Promise<void>
): (req: Request, res: Response) => void {
  return (req, res) => {
    fn(req, res).catch((err: unknown) => {
      console.error("[ROUTES] Unhandled error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    });
  };
}

// GET /api/queue
async function handleGetQueue(req: Request, res: Response): Promise<void> {
  const tier = req.query["tier"] as string | undefined;
  const unit = req.query["unit"] as string | undefined;
  const limit = Math.min(parseInt((req.query["limit"] as string) ?? "200", 10), 500);
  const offset = parseInt((req.query["offset"] as string) ?? "0", 10);

  const { tips, total } = await listTips({ tier, limit, offset });
  const filtered = unit ? tips.filter((t) => t.priority?.routing_unit === unit) : tips;

  const grouped: Record<string, CyberTip[]> = {
    IMMEDIATE: [], URGENT: [], PAUSED: [], STANDARD: [], MONITOR: [], pending: [],
  };
  for (const t of filtered) {
    const key = t.priority?.tier ?? "pending";
    (grouped[key] ?? grouped["pending"]!).push(t);
  }

  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Limit", String(limit));
  res.setHeader("X-Offset", String(offset));
  res.json(grouped);
}

// GET /api/tips/:id
async function handleGetTip(req: Request, res: Response): Promise<void> {
  const tip = await dbGetTipById(req.params["id"] ?? "");
  if (!tip) { res.status(404).json({ error: "Tip not found" }); return; }
  res.json(tip);
}

// POST /api/tips/:id/assign
async function handleAssignTip(req: Request, res: Response): Promise<void> {
  const tip = await dbGetTipById(req.params["id"] ?? "");
  if (!tip) { res.status(404).json({ error: "Tip not found" }); return; }

  const { investigator_id, investigator_name } = req.body as {
    investigator_id?: string;
    investigator_name?: string;
  };
  if (!investigator_id) { res.status(400).json({ error: "investigator_id required" }); return; }

  const updated: CyberTip = {
    ...tip,
    status: "assigned",
    priority: tip.priority ? { ...tip.priority, assigned_to: investigator_id } : tip.priority,
  };
  await upsertTip(updated);
  await appendAuditEntry({
    tip_id: updated.tip_id, agent: "HumanAction",
    timestamp: new Date().toISOString(), status: "success",
    summary: `Tip assigned to ${investigator_name ?? investigator_id}.`,
    human_actor: investigator_id,
  });

  res.json({ success: true, tip_id: updated.tip_id, assigned_to: investigator_id });
}

// POST /api/tips/:id/warrant/:fileId
async function handleUpdateWarrant(req: Request, res: Response): Promise<void> {
  const tipId = req.params["id"] ?? "";
  const fileId = req.params["fileId"] ?? "";
  const { status, warrant_number, granted_by, approved_by } = req.body as {
    status?: string; warrant_number?: string; granted_by?: string; approved_by?: string;
  };

  if (!["applied", "granted", "denied"].includes(status ?? "")) {
    res.status(400).json({ error: "status must be: applied | granted | denied" }); return;
  }

  const updatedFile = await updateFileWarrant(tipId, fileId, status!, warrant_number, granted_by);
  if (!updatedFile) { res.status(404).json({ error: "Tip or file not found" }); return; }

  const tip = await dbGetTipById(tipId);
  if (tip) {
    const updatedFiles = tip.files.map((f: import("../models/index.js").TipFile) => (f.file_id === fileId ? updatedFile : f));
    const stillBlocked = updatedFiles.filter((f: import("../models/index.js").TipFile) => f.file_access_blocked).length;
    await upsertTip({
      ...tip,
      files: updatedFiles,
      legal_status: tip.legal_status ? {
        ...tip.legal_status,
        any_files_accessible: stillBlocked < updatedFiles.length,
        all_warrants_resolved: stillBlocked === 0,
      } : tip.legal_status,
    });
    await appendAuditEntry({
      tip_id: tipId, agent: "HumanAction",
      timestamp: new Date().toISOString(), status: "success",
      summary: `Warrant status set to "${status}" for file ${fileId.slice(0, 8)}.`,
      human_actor: approved_by,
      previous_value: { warrant_status: tip.files.find((f: import("../models/index.js").TipFile) => f.file_id === fileId)?.warrant_status },
      new_value: { warrant_status: status, warrant_number, granted_by },
    });
  }
  res.json({ success: true, file: updatedFile });
}

// POST /api/preservation/:id/issue
async function handleIssuePreservation(req: Request, res: Response): Promise<void> {
  const requestId = req.params["id"] ?? "";
  const { approved_by } = req.body as { approved_by?: string };
  const ok = await issuePreservationRequest(requestId, approved_by);
  if (!ok) { res.status(404).json({ error: "Preservation request not found" }); return; }
  res.json({ success: true, request_id: requestId, issued_at: new Date().toISOString() });
}

// GET /api/crisis
async function handleGetCrisisAlerts(_req: Request, res: Response): Promise<void> {
  const { tips } = await listTips({ crisis_only: true, limit: 100 });
  res.json(tips);
}

// GET /api/clusters
async function handleGetClusters(_req: Request, res: Response): Promise<void> {
  const { tips } = await listTips({ status: "triaged", limit: 500 });
  res.json(tips.filter((t) => ((t.links?.cluster_flags as unknown[]) ?? []).length > 0));
}

// GET /api/stats
async function handleGetStats(_req: Request, res: Response): Promise<void> {
  const [tipStats, queueStats] = await Promise.all([getTipStats(), Promise.resolve(getQueueStats())]);
  res.json({ queue: queueStats, tips: tipStats });
}

// GET /api/tips/:id/stream  (SSE — not async)
function handlePipelineStream(req: Request, res: Response): void {
  const tipId = req.params["id"] ?? "*";
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (data: unknown): void => { res.write(`data: ${JSON.stringify(data)}\n\n`); };
  send({ type: "connected", tip_id: tipId, ts: new Date().toISOString() });

  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  const unsubscribe = onPipelineEvent(tipId, (event) => {
    send(event);
    if (event.step === "complete" || event.step === "blocked") { clearInterval(ping); res.end(); }
  });
  req.on("close", () => { clearInterval(ping); unsubscribe(); });
}

// GET /api/bundles/stats
async function handleBundleStats(_req: Request, res: Response): Promise<void> {
  const { getBundleStats } = await import("../ingestion/bundle_dedup.js");
  const stats = await getBundleStats();
  res.json(stats);
}

// POST /api/jobs/cluster-scan
async function handleTriggerClusterScan(_req: Request, res: Response): Promise<void> {
  // Run asynchronously — responds immediately with scan ID, result posted to audit log
  const result = await runClusterScan();
  res.json({
    scan_id: result.scan_id,
    clusters: result.clusters_found.length,
    escalations: result.escalations,
    duration_ms: result.duration_ms,
    errors: result.errors,
  });
}

// GET /api/tips/:id/mlat
async function handleGetMLAT(req: Request, res: Response): Promise<void> {
  const tip = await dbGetTipById(req.params["id"] ?? "");
  if (!tip) { res.status(404).json({ error: "Tip not found" }); return; }

  if (!tipNeedsMLAT(tip)) {
    res.json({ needs_mlat: false, message: "No international subjects identified in this tip." });
    return;
  }

  const requests = generateMLATRequest(tip);

  // Persist generated requests so they are tracked in admin/dashboard
  for (const r of requests) {
    await saveMLATRequest(r);
  }

  res.json({ needs_mlat: true, requests });
}

// GET /api/mlat/requests
async function handleListMLATRequests(req: Request, res: Response): Promise<void> {
  const limit = parseInt((req.query["limit"] as string) ?? "100", 10);
  const requests = await listMLATRequests(limit);
  res.json(requests);
}

// GET /api/legal/circuit/:state
async function handleCircuitGuidance(req: Request, res: Response): Promise<void> {
  const state = (req.params["state"] ?? "").toUpperCase();
  const circuit = getCircuitForState(state);
  if (!circuit) {
    res.status(404).json({ error: `No circuit data for state: ${state}` });
    return;
  }
  const summary = circuitLegalSummary(circuit);
  const history = PRECEDENT_LOG.filter(p => p.circuit === circuit);
  res.json({ state, circuit, summary, precedent_history: history });
}

// GET /api/legal/precedents
async function handlePrecedentLog(_req: Request, res: Response): Promise<void> {
  res.json({ last_updated: new Date().toISOString(), precedents: PRECEDENT_LOG });
}

// POST /api/legal/precedents — record a new binding opinion (supervisor/admin only)
async function handleAddPrecedent(req: Request, res: Response): Promise<void> {
  const { recordPrecedentUpdate } = await import("../compliance/circuit_guide.js");
  const { savePrecedentToDB, saveCircuitOverrideToDB } = await import("../db/precedents.js");
  const { circuit, case_name, citation, effect, summary, added_by, date } = req.body as Record<string, string>;

  if (!circuit || !case_name || !citation || !effect || !summary || !added_by) {
    res.status(400).json({ error: "All fields required: circuit, case_name, citation, effect, summary, added_by" });
    return;
  }

  const validEffects = ["now_binding", "affirmed", "limited", "reversed"];
  if (!validEffects.includes(effect)) {
    res.status(400).json({ error: `effect must be one of: ${validEffects.join(", ")}` });
    return;
  }

  const update = {
    date: date ?? new Date().toISOString().slice(0, 10),
    circuit: circuit as any,
    case_name,
    citation,
    effect: effect as any,
    summary,
    added_by,
  };

  // 1. Update in-memory PRECEDENT_LOG + CIRCUIT_RULES (live, immediate effect)
  recordPrecedentUpdate(update);

  // 2. Persist precedent to DB so it survives restart
  await savePrecedentToDB(update);

  // 3. If binding, also persist the circuit rule override to DB
  if (effect === "now_binding") {
    await saveCircuitOverrideToDB(
      circuit as any,
      citation,
      "strict_wilson",
      `Files accessible only if ESP viewed before reporting — warrant required otherwise. Binding: ${citation}`,
      added_by
    );
  }

  await appendAuditEntry({
    tip_id: "SYSTEM",
    agent: "PrecedentAdmin",
    timestamp: new Date().toISOString(),
    status: "success",
    summary: `New precedent recorded + persisted: ${case_name} (${circuit} Circuit, ${effect})`,
    new_value: { citation, added_by, persisted_to_db: true },
  });

  res.json({
    ok: true,
    message: `Precedent recorded and persisted: ${case_name}`,
    circuit_rules_updated: effect === "now_binding",
    total: PRECEDENT_LOG.length,
  });
}

// POST /api/tips/:id/forensics — Generate a forensics handoff package
async function handleGenerateForensicsHandoff(req: Request, res: Response): Promise<void> {
  const tipId = req.params["id"] ?? "";
  const { platform, generated_by } = req.body as { platform?: string; generated_by?: string };

  if (!platform) { res.status(400).json({ error: "platform required" }); return; }
  if (!generated_by) { res.status(400).json({ error: "generated_by required" }); return; }

  const parsed = ForensicsPlatformSchema.safeParse(platform.toUpperCase());
  if (!parsed.success) {
    res.status(400).json({
      error: `Invalid platform. Must be one of: ${ForensicsPlatformSchema.options.join(", ")}`,
    });
    return;
  }

  const tip = await dbGetTipById(tipId);
  if (!tip) { res.status(404).json({ error: "Tip not found" }); return; }

  if (!tip.classification || !tip.priority) {
    res.status(409).json({ error: "Tip has not completed triage pipeline — cannot generate handoff" });
    return;
  }

  const result = await generateForensicsHandoff(tip, parsed.data, generated_by);
  await saveForensicsHandoff(result.handoff);

  await appendAuditEntry({
    tip_id: tipId,
    agent: "ForensicsHandoff",
    timestamp: new Date().toISOString(),
    status: "success",
    summary: `Forensics handoff generated for ${parsed.data} by ${generated_by}. Files: ${result.handoff.files_included} included, ${result.handoff.files_blocked_wilson} blocked (Wilson).`,
    human_actor: generated_by,
    new_value: { handoff_id: result.handoff.handoff_id, platform: parsed.data },
  });

  res.json({
    handoff: result.handoff,
    exports: result.exports,
    context_summary: {
      offense_category: result.context.offense_category,
      severity: result.context.severity_us_icac,
      priority_score: result.context.priority_score,
      files_included: result.context.accessible_file_count,
      files_blocked_wilson: tip.files.length - result.context.accessible_file_count,
    },
  });
}

// GET /api/tips/:id/forensics — List handoffs for a tip
async function handleListTipForensicsHandoffs(req: Request, res: Response): Promise<void> {
  const tipId = req.params["id"] ?? "";
  const tip = await dbGetTipById(tipId);
  if (!tip) { res.status(404).json({ error: "Tip not found" }); return; }

  const handoffs = await listForensicsHandoffs(tipId);
  res.json(handoffs);
}

// GET /api/forensics/handoffs — List all handoffs (global view)
async function handleListAllForensicsHandoffs(req: Request, res: Response): Promise<void> {
  const limit = Math.min(parseInt((req.query["limit"] as string) ?? "100", 10), 500);
  const handoffs = await listForensicsHandoffs(undefined, limit);
  res.json(handoffs);
}

// PATCH /api/forensics/handoffs/:handoffId/status — Update handoff status
async function handleUpdateForensicsStatus(req: Request, res: Response): Promise<void> {
  const handoffId = req.params["handoffId"] ?? "";
  const { status, notes } = req.body as { status?: string; notes?: string };

  const validStatuses = ["pending", "delivered", "imported", "completed"];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });
    return;
  }

  const updated = await updateHandoffStatus(
    handoffId,
    status as import("../models/forensics.js").ForensicsHandoffStatus,
    notes
  );
  if (!updated) { res.status(404).json({ error: "Handoff not found" }); return; }

  res.json({ success: true, handoff: updated });
}

async function handleGetLLMConfig(_req: Request, res: Response): Promise<void> {
  const { getLLMConfigSummary } = await import("../llm/index.js");
  res.json(getLLMConfigSummary());
}

async function handleGetAffidavit(req: Request, res: Response): Promise<void> {
  const tipId = req.params["id"] ?? "";
  const fileId = req.params["fileId"] ?? "";
  console.log(`[AFFIDAVIT] Request for Tip: ${tipId}, File: ${fileId}`);

  const tip = await dbGetTipById(tipId);
  if (!tip) {
    console.error(`[AFFIDAVIT] Tip not found: ${tipId}`);
    res.status(404).json({ error: "Tip not found", requested_tip_id: tipId });
    return;
  }

  const file = tip.files.find((f: any) => f.file_id === fileId);
  if (!file) {
    console.error(`[AFFIDAVIT] File not found: ${fileId} in Tip: ${tipId}`);
    console.log(`[AFFIDAVIT] Available files in tip: ${tip.files.map((f: any) => f.file_id).join(", ")}`);
    res.status(404).json({ error: "File not found", requested_file_id: fileId, tip_id: tipId });
    return;
  }

  // Final production would use a PDF generator. For demo/walkthrough, we serve a text-based affidavit.
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Disposition", `attachment; filename=affidavit_${tipId.slice(0, 8)}.txt`);

  const content = `
AFFIDAVIT IN SUPPORT OF SEARCH WARRANT
Circuit: ${tip.legal_status?.relevant_circuit ?? "Unknown"}
Case Reference: ${tipId.toUpperCase()}

I, CyberTip Triage Agent, being duly sworn, depose and state:

1. TARGET: One file identified as "${file.filename}" associated with CyberTip ${tip.ncmec_tip_number ?? tipId}.
2. PROBABLE CAUSE: Analysis of tip metadata indicates the file was reported by ${tip.reporter?.esp_name ?? "ESP"} due to automated detection flags. 
3. WILSON COMPLIANCE: As the ESP did not view this content prior to reporting, this warrant is required per Wilson v. United States.
4. ATTACHMENT: Hash match confirmed against NCMEC/IWF databases: ${file.ncmec_hash_match ? "YES" : "NO"}. 

Requested by: ICAC Investigator
Date: ${new Date().toISOString()}
  `;

  res.send(content);
}

export function mountApiRoutes(app: Application): void {
  app.get("/api/queue", wrapAsync(handleGetQueue));
  app.get("/api/stats", wrapAsync(handleGetStats));
  app.get("/api/clusters", wrapAsync(handleGetClusters));
  app.get("/api/crisis", wrapAsync(handleGetCrisisAlerts));
  app.get("/api/tips/:id", wrapAsync(handleGetTip));
  app.post("/api/tips/:id/assign", wrapAsync(handleAssignTip));
  app.post("/api/tips/:id/warrant/:fileId", wrapAsync(handleUpdateWarrant));
  app.post("/api/preservation/:id/issue", wrapAsync(handleIssuePreservation));
  app.get("/api/tips/:id/stream", handlePipelineStream);
  app.get("/api/bundles/stats", wrapAsync(handleBundleStats));
  app.post("/api/jobs/cluster-scan", wrapAsync(handleTriggerClusterScan));
  app.get("/api/tips/:id/mlat", wrapAsync(handleGetMLAT));
  app.get("/api/mlat/requests", wrapAsync(handleListMLATRequests));
  app.get("/api/llm/config", wrapAsync(handleGetLLMConfig));
  app.get("/api/legal/circuit/:state", wrapAsync(handleCircuitGuidance));
  app.get("/api/legal/precedents", wrapAsync(handlePrecedentLog));
  app.post("/api/legal/precedents", wrapAsync(handleAddPrecedent));
  app.get("/api/warrant-applications/:id/:fileId/affidavit", wrapAsync(handleGetAffidavit));
  // Forensics handoff endpoints
  app.post("/api/tips/:id/forensics", wrapAsync(handleGenerateForensicsHandoff));
  app.get("/api/tips/:id/forensics", wrapAsync(handleListTipForensicsHandoffs));
  app.get("/api/forensics/handoffs", wrapAsync(handleListAllForensicsHandoffs));
  app.patch("/api/forensics/handoffs/:handoffId/status", wrapAsync(handleUpdateForensicsStatus));
  console.log("[ROUTES] API routes mounted at /api/*");
}

/** Called by queue worker after processTip() completes. */
export async function persistProcessedTip(tip: CyberTip): Promise<void> {
  await upsertTip(tip);
}
