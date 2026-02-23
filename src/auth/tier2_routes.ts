/**
 * Tier 2 API Routes
 *
 * Mounts all Tier 2 endpoints onto the Express app:
 *
 *  2.1 — Preservation Letters (PDF generation + supervisor approval)
 *    POST /api/preservation/generate
 *    POST /api/preservation/:id/approve
 *    GET  /api/preservation/:id/download
 *    GET  /api/preservation/tip/:tipId
 *
 *  2.2 — Warrant Workflow (affidavit, lifecycle, auto-unblock)
 *    POST /api/tips/:id/warrant/apply
 *    GET  /api/tips/:id/warrant/applications
 *    POST /api/warrant/:appId/submit-da
 *    POST /api/warrant/:appId/grant
 *    POST /api/warrant/:appId/deny
 *    GET  /api/warrant/:appId
 *
 *  2.3 — OJJDP Quarterly Export
 *    GET  /api/reports/ojjdp
 *    GET  /api/reports/ojjdp/download
 *
 *  2.4 — Investigator Auth & Officer Management
 *    POST /api/auth/login
 *    POST /api/auth/refresh
 *    POST /api/auth/logout
 *    GET  /api/auth/me
 *    POST /api/auth/change-password
 *    GET  /api/officers
 *    POST /api/officers
 *    GET  /api/officers/:id
 *    PATCH /api/officers/:id/role
 *    DELETE /api/officers/:id
 *    GET  /api/officers/suggest/:tipId
 */

import type { Application, Request, Response } from "express";

// Tier 2.1
import { generatePreservationLetter, type LetterInput } from "../tools/preservation/letter_generator.js";
import { generatePreservationLetterPDF, type AgencyInfo } from "../tools/preservation/letter_pdf.js";
import { issuePreservationRequest, getTipById } from "../db/tips.js";

// Tier 2.2
import {
  openWarrantApplication,
  recordWarrantGrant,
  recordWarrantDenial,
  getWarrantApplications,
  getWarrantApplicationById,
  type WarrantApplication,
} from "../tools/legal/warrant_workflow.js";
import { generateWarrantAffidavit } from "../tools/legal/warrant_affidavit.js";

// Tier 2.3
import { generateOJJDPReport, reportToCSV, type OJJDPReportPeriod } from "../tools/reporting/ojjdp_export.js";

// Tier 2.4
import { login, refreshSession, revokeToken, hashPassword, AuthError } from "./jwt.js";
import { requireRole } from "./middleware.js";
import {
  listOfficers,
  getOfficerById,
  createOfficer,
  updateOfficerRole,
  deactivateOfficer,
  suggestAssignment,
  updatePasswordHash,
} from "../db/officers.js";

import { appendAuditEntry } from "../compliance/audit.js";
import type { CyberTip, TipFile } from "../models/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrapAsync(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => {
      console.error("[TIER2 ROUTES] Error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    });
  };
}

/** Default agency info from environment (overridable per-request) */
function defaultAgencyInfo(overrides: Partial<AgencyInfo> = {}): AgencyInfo {
  return {
    name:          process.env["AGENCY_NAME"]    ?? "Law Enforcement Agency",
    address:       process.env["AGENCY_ADDRESS"] ?? "123 Main St",
    city_state_zip: process.env["AGENCY_CITY"]  ?? "City, ST 00000",
    phone:         process.env["AGENCY_PHONE"]   ?? "(555) 555-0100",
    email:         process.env["AGENCY_LEGAL_EMAIL"] ?? "legal@agency.gov",
    officer_name:  overrides.officer_name ?? "Requesting Officer",
    badge_number:  overrides.badge_number ?? "000",
    ...overrides,
  };
}

// ── 2.1 — Preservation Letter Routes ─────────────────────────────────────────

async function handleGenerateLetter(req: Request, res: Response): Promise<void> {
  const {
    tip_id, esp_name, account_identifiers, jurisdiction,
    priority_tier, additional_context, officer_name, badge_number,
  } = req.body as {
    tip_id?: string;
    esp_name?: string;
    account_identifiers?: string[];
    jurisdiction?: string;
    priority_tier?: "IMMEDIATE" | "URGENT" | "STANDARD" | "MONITOR";
    additional_context?: string;
    officer_name?: string;
    badge_number?: string;
  };

  if (!tip_id || !esp_name || !account_identifiers?.length) {
    res.status(400).json({ error: "tip_id, esp_name, and account_identifiers are required" });
    return;
  }

  // Look up the tip to get its existing preservation requests
  const tip = await getTipById(tip_id);
  if (!tip) { res.status(404).json({ error: "Tip not found" }); return; }

  const tier = priority_tier ?? (tip.priority as any)?.tier ?? "STANDARD";
  const agency = defaultAgencyInfo({ officer_name, badge_number });
  const session = req.session;

  // Find existing preservation request for this tip + ESP, or use a new ID
  const existing = tip.preservation_requests?.find(
    (pr: any) => pr.esp_name === esp_name && pr.status === "draft"
  );
  const requestId = existing?.request_id ?? crypto.randomUUID();

  const input: LetterInput = {
    request_id:           requestId,
    tip_id,
    esp_name,
    account_identifiers,
    jurisdiction:         jurisdiction ?? String((tip as any).jurisdiction_of_tip?.primary ?? "US"),
    priority_tier:        tier as "IMMEDIATE" | "URGENT" | "STANDARD" | "MONITOR",
    additional_context,
    agency: {
      agency_name:        agency.name,
      unit_name:          session?.unit ?? "ICAC Task Force",
      requesting_officer: agency.officer_name,
      badge_number:       agency.badge_number,
      phone:              agency.phone,
      email:              agency.email,
      address:            `${agency.address}, ${agency.city_state_zip}`,
      case_number:        (tip as any).ids_case_number,
    },
  };

  const letter = generatePreservationLetter(input);

  await appendAuditEntry({
    tip_id,
    agent:     "HumanAction",
    timestamp: new Date().toISOString(),
    status:    "success",
    summary:   `Preservation letter generated for ${esp_name} (request ${requestId}).`,
    human_actor: session?.badge_number,
  });

  res.json({
    request_id:        requestId,
    letter_text:       letter.letter_text,
    response_deadline: letter.response_deadline,
    retention_days:    letter.retention_days,
    legal_basis:       letter.legal_basis,
    requires_approval: letter.requires_supervisor_approval,
    tip_id,
    esp_name,
    account_identifiers,
  });
}

async function handleApprovePreservation(req: Request, res: Response): Promise<void> {
  const requestId  = req.params["id"] ?? "";
  const { approved_by } = req.body as { approved_by?: string };
  const session = req.session;
  const approver = approved_by ?? session?.badge_number ?? "unknown";

  const ok = await issuePreservationRequest(requestId, approver);
  if (!ok) { res.status(404).json({ error: "Preservation request not found" }); return; }

  res.json({
    success:    true,
    request_id: requestId,
    issued_at:  new Date().toISOString(),
    approved_by: approver,
    status:     "issued",
  });
}

async function handleDownloadPreservationPDF(req: Request, res: Response): Promise<void> {
  const requestId = req.params["id"] ?? "";
  const session   = req.session;

  // Find the tip containing this preservation request
  // We do a broad search — in production this would be a direct DB lookup
  const { listTips } = await import("../db/tips.js");
  const { tips }     = await listTips({ limit: 1000 });
  const tip          = tips.find((t) =>
    t.preservation_requests?.some((pr: any) => pr.request_id === requestId)
  );

  if (!tip) { res.status(404).json({ error: "Preservation request not found" }); return; }

  const pr = tip.preservation_requests.find((pr: any) => pr.request_id === requestId);
  if (!pr) { res.status(404).json({ error: "Preservation request not found" }); return; }

  const agency = defaultAgencyInfo({
    officer_name: session?.name,
    badge_number: session?.badge_number,
    supervisor_badge: pr.approved_by,
  });

  try {
    const { bytes, page_count } = await generatePreservationLetterPDF(pr, agency);
    res.setHeader("Content-Type",        "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="preservation-${requestId.slice(0,8)}.pdf"`);
    res.setHeader("X-Page-Count",        String(page_count));
    res.send(Buffer.from(bytes));
  } catch (err) {
    console.error("[TIER2] PDF generation failed:", err);
    res.status(500).json({ error: "PDF generation failed", detail: String(err) });
  }
}

async function handleGetTipPreservations(req: Request, res: Response): Promise<void> {
  const tipId = req.params["tipId"] ?? "";
  const tip   = await getTipById(tipId);
  if (!tip) { res.status(404).json({ error: "Tip not found" }); return; }
  res.json(tip.preservation_requests ?? []);
}

// ── 2.2 — Warrant Workflow Routes ─────────────────────────────────────────────

async function handleOpenWarrantApplication(req: Request, res: Response): Promise<void> {
  const tipId   = req.params["id"] ?? "";
  const session = req.session;
  const { da_name, court, override_affidavit } = req.body as {
    da_name?: string;
    court?: string;
    override_affidavit?: string;
  };

  const tip = await getTipById(tipId);
  if (!tip) { res.status(404).json({ error: "Tip not found" }); return; }

  const blockedFiles = (tip.files ?? []).filter((f: TipFile) => f.file_access_blocked);
  if (blockedFiles.length === 0) {
    res.status(400).json({ error: "No blocked files on this tip — warrant not required" });
    return;
  }

  const application = await openWarrantApplication(
    tip,
    session?.badge_number ?? "unknown",
    da_name,
    court
  );

  // If caller provided a custom affidavit, use it (investigator may have edited the draft)
  if (override_affidavit) {
    application.affidavit_draft = override_affidavit;
  }

  // Also generate structured affidavit via the detailed generator
  const detailedAffidavit = generateWarrantAffidavit({
    tip,
    requesting_officer: session?.name ?? "Requesting Officer",
    badge_number:       session?.badge_number ?? "000",
    unit:               session?.unit ?? "ICAC Task Force",
    blocked_files:      blockedFiles,
    da_office:          da_name,
    court_jurisdiction: court,
  });

  await appendAuditEntry({
    tip_id:    tipId,
    agent:     "HumanAction",
    timestamp: new Date().toISOString(),
    status:    "success",
    summary:   `Warrant application ${application.application_id.slice(0,8)} opened for ${blockedFiles.length} blocked file(s).`,
    human_actor: session?.badge_number,
  });

  res.status(201).json({
    application,
    affidavit_structured: detailedAffidavit,
    blocked_file_count:   blockedFiles.length,
  });
}

async function handleGetWarrantApplications(req: Request, res: Response): Promise<void> {
  const tipId = req.params["id"] ?? "";
  const apps  = getWarrantApplications(tipId);
  res.json(apps);
}

async function handleGetWarrantApplication(req: Request, res: Response): Promise<void> {
  const appId = req.params["appId"] ?? "";
  const found = getWarrantApplicationById(appId);
  if (found) { res.json(found); return; }
  res.status(404).json({ error: "Warrant application not found" });
}

async function handleSubmitWarrantToDA(req: Request, res: Response): Promise<void> {
  const appId   = req.params["appId"] ?? "";
  const session = req.session;
  const { da_name } = req.body as { da_name?: string };

  // Find application
  const foundApp = getWarrantApplicationById(appId);
  if (!foundApp) { res.status(404).json({ error: "Application not found" }); return; }

  foundApp.status       = "pending_da_review";
  foundApp.da_name      = da_name ?? foundApp.da_name;
  foundApp.submitted_at = new Date().toISOString();
  foundApp.updated_at   = new Date().toISOString();

  await appendAuditEntry({
    tip_id:    foundApp.tip_id,
    agent:     "HumanAction",
    timestamp: new Date().toISOString(),
    status:    "success",
    summary:   `Warrant application ${appId.slice(0,8)} submitted to DA.`,
    human_actor: session?.badge_number,
  });

  res.json(foundApp);
}

async function handleGrantWarrant(req: Request, res: Response): Promise<void> {
  const appId   = req.params["appId"] ?? "";
  const session = req.session;
  const { warrant_number, granting_judge, approved_by } = req.body as {
    warrant_number?: string;
    granting_judge?: string;
    approved_by?: string;
  };

  if (!warrant_number || !granting_judge) {
    res.status(400).json({ error: "warrant_number and granting_judge are required" });
    return;
  }

  const approver = approved_by ?? session?.badge_number ?? "unknown";
  const updated  = await recordWarrantGrant(appId, warrant_number, granting_judge, approver);

  if (!updated) { res.status(404).json({ error: "Application not found" }); return; }

  await appendAuditEntry({
    tip_id:    updated.tip_id,
    agent:     "HumanAction",
    timestamp: new Date().toISOString(),
    status:    "success",
    summary:   `Warrant GRANTED: ${warrant_number} by ${granting_judge}. ${updated.file_ids.length} file(s) unblocked.`,
    human_actor: approver,
    new_value: { warrant_number, granting_judge, files_unblocked: updated.file_ids.length },
  });

  res.json({
    application:       updated,
    files_unblocked:   updated.file_ids.length,
    message:           `Warrant granted. ${updated.file_ids.length} file(s) are now accessible.`,
  });
}

async function handleDenyWarrant(req: Request, res: Response): Promise<void> {
  const appId   = req.params["appId"] ?? "";
  const session = req.session;
  const { denial_reason } = req.body as { denial_reason?: string };

  if (!denial_reason) {
    res.status(400).json({ error: "denial_reason is required" });
    return;
  }

  const updated = await recordWarrantDenial(appId, denial_reason);
  if (!updated) { res.status(404).json({ error: "Application not found" }); return; }

  await appendAuditEntry({
    tip_id:    updated.tip_id,
    agent:     "HumanAction",
    timestamp: new Date().toISOString(),
    status:    "success",
    summary:   `Warrant DENIED. Reason: ${denial_reason}`,
    human_actor: session?.badge_number,
  });

  res.json({ application: updated, message: "Warrant denied. Files remain blocked." });
}

// ── 2.3 — OJJDP Report Routes ─────────────────────────────────────────────────

async function handleOJJDPReport(req: Request, res: Response): Promise<void> {
  const year     = parseInt(String(req.query["year"]    ?? new Date().getFullYear()), 10);
  const quarter  = parseInt(String(req.query["quarter"] ?? Math.ceil((new Date().getMonth() + 1) / 3)), 10) as 1|2|3|4;
  const tfName   = String(req.query["task_force_name"] ?? process.env["TASK_FORCE_NAME"] ?? "ICAC Task Force");
  const tfId     = String(req.query["task_force_id"]   ?? process.env["TASK_FORCE_ID"]   ?? "TF-000");

  if (![1,2,3,4].includes(quarter)) {
    res.status(400).json({ error: "quarter must be 1, 2, 3, or 4" });
    return;
  }

  const period: OJJDPReportPeriod = { year, quarter: quarter as 1|2|3|4 };
  const report = await generateOJJDPReport(period, tfName, tfId);

  res.json(report);
}

async function handleOJJDPDownload(req: Request, res: Response): Promise<void> {
  const year     = parseInt(String(req.query["year"]    ?? new Date().getFullYear()), 10);
  const quarter  = parseInt(String(req.query["quarter"] ?? Math.ceil((new Date().getMonth() + 1) / 3)), 10) as 1|2|3|4;
  const tfName   = String(req.query["task_force_name"] ?? process.env["TASK_FORCE_NAME"] ?? "ICAC Task Force");
  const tfId     = String(req.query["task_force_id"]   ?? process.env["TASK_FORCE_ID"]   ?? "TF-000");
  const format   = String(req.query["format"] ?? "csv");

  const period: OJJDPReportPeriod = { year, quarter: quarter as 1|2|3|4 };
  const report   = await generateOJJDPReport(period, tfName, tfId);
  const filename = `ojjdp-${tfId}-${year}-Q${quarter}`;

  if (format === "json") {
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.json"`);
    res.json(report);
    return;
  }

  // Default: CSV
  const csv = reportToCSV(report);
  res.setHeader("Content-Type",        "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
  res.send(csv);
}

// ── 2.4 — Auth Routes ─────────────────────────────────────────────────────────

async function handleLogin(req: Request, res: Response): Promise<void> {
  const { badge_number, password } = req.body as { badge_number?: string; password?: string };
  if (!badge_number || !password) {
    res.status(400).json({ error: "badge_number and password are required" });
    return;
  }

  try {
    const result = await login({ badge_number, password });
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(401).json({ error: err.message });
    } else {
      throw err;
    }
  }
}

async function handleRefresh(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Bearer token required" }); return; }

  try {
    const result = await refreshSession(token);
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(401).json({ error: err.message });
    } else {
      throw err;
    }
  }
}

async function handleLogout(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (token) await revokeToken(token);
  res.json({ success: true, message: "Logged out" });
}

async function handleMe(req: Request, res: Response): Promise<void> {
  const session = req.session;
  if (!session) { res.status(401).json({ error: "Not authenticated" }); return; }
  const officer = await getOfficerById(session.officer_id);
  res.json({ session, officer });
}

async function handleChangePassword(req: Request, res: Response): Promise<void> {
  const session = req.session;
  if (!session) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { current_password: _cp, new_password } = req.body as {
    current_password?: string;
    new_password?: string;
  };

  if (!new_password || new_password.length < 12) {
    res.status(400).json({ error: "new_password must be at least 12 characters" });
    return;
  }

  const hash = hashPassword(new_password);
  await updatePasswordHash(session.officer_id, hash);

  res.json({ success: true, message: "Password updated. Please log in again." });
}

// ── 2.4 — Officer Management Routes ──────────────────────────────────────────

async function handleListOfficers(req: Request, res: Response): Promise<void> {
  const { unit, role } = req.query as { unit?: string; role?: string };
  const officers = await listOfficers({ unit, role, active_only: true });
  res.json(officers);
}

async function handleCreateOfficer(req: Request, res: Response): Promise<void> {
  const session = req.session;
  const {
    badge_number, name, rank, unit, role, email, phone,
    specialty, supervisor_id, max_concurrent_cases, password,
  } = req.body as {
    badge_number?: string; name?: string; rank?: string;
    unit?: string; role?: string; email?: string; phone?: string;
    specialty?: string; supervisor_id?: string;
    max_concurrent_cases?: number; password?: string;
  };

  if (!badge_number || !name || !unit || !email) {
    res.status(400).json({ error: "badge_number, name, unit, and email are required" });
    return;
  }

  const passwordHash = password ? hashPassword(password) : undefined;

  const officer = await createOfficer({
    badge_number,
    name,
    rank:                 rank ?? "",
    unit:                 unit as any,
    role:                 (role ?? "investigator") as any,
    email,
    phone,
    specialty:            specialty as any,
    active:               true,
    supervisor_id,
    max_concurrent_cases: max_concurrent_cases ?? 20,
    password_hash:        passwordHash,
  });

  await appendAuditEntry({
    tip_id:    "00000000-0000-0000-0000-000000000000",
    agent:     "HumanAction",
    timestamp: new Date().toISOString(),
    status:    "success",
    summary:   `Officer created: ${badge_number} (${role ?? "investigator"})`,
    human_actor: session?.badge_number,
  });

  res.status(201).json(officer);
}

async function handleGetOfficer(req: Request, res: Response): Promise<void> {
  const officer = await getOfficerById(req.params["id"] ?? "");
  if (!officer) { res.status(404).json({ error: "Officer not found" }); return; }
  res.json(officer);
}

async function handleUpdateOfficerRole(req: Request, res: Response): Promise<void> {
  const session = req.session;
  const { role, unit } = req.body as { role?: string; unit?: string };
  if (!role) { res.status(400).json({ error: "role is required" }); return; }

  const updated = await updateOfficerRole(req.params["id"] ?? "", role as any, unit as any);
  if (!updated) { res.status(404).json({ error: "Officer not found" }); return; }

  await appendAuditEntry({
    tip_id:    "00000000-0000-0000-0000-000000000000",
    agent:     "HumanAction",
    timestamp: new Date().toISOString(),
    status:    "success",
    summary:   `Officer ${updated.badge_number} role changed to ${role}`,
    human_actor: session?.badge_number,
  });

  res.json(updated);
}

async function handleDeactivateOfficer(req: Request, res: Response): Promise<void> {
  const session = req.session;
  const ok = await deactivateOfficer(req.params["id"] ?? "");
  if (!ok) { res.status(404).json({ error: "Officer not found" }); return; }

  await appendAuditEntry({
    tip_id:    "00000000-0000-0000-0000-000000000000",
    agent:     "HumanAction",
    timestamp: new Date().toISOString(),
    status:    "success",
    summary:   `Officer ${req.params["id"]} deactivated`,
    human_actor: session?.badge_number,
  });

  res.json({ success: true, message: "Officer deactivated" });
}

async function handleSuggestAssignment(req: Request, res: Response): Promise<void> {
  const tipId = req.params["tipId"] ?? "";
  const tip   = await getTipById(tipId);
  if (!tip) { res.status(404).json({ error: "Tip not found" }); return; }

  const routingUnit = String((tip.priority as any)?.routing_unit ?? "ICAC");
  const specialty   = String((tip.classification as any)?.offense_category ?? "");

  // Map offense category to specialty
  const specialtyMap: Record<string, string> = {
    CSAM:                  "AIG_CSAM",
    ONLINE_ENTICEMENT:     "SEXTORTION",
    SEXTORTION:            "SEXTORTION",
    CHILD_SEX_TRAFFICKING: "INTERNATIONAL",
  };

  const suggested = await suggestAssignment(
    routingUnit,
    specialtyMap[specialty],
    [] // no conflict exclusions without knowing tip subjects' names
  );

  res.json({
    tip_id:          tipId,
    routing_unit:    routingUnit,
    suggested_officer: suggested,
    specialty_match: suggested?.specialty === specialtyMap[specialty],
  });
}

// ── Mount function ─────────────────────────────────────────────────────────────

export function mountTier2Routes(app: Application): void {
  // 2.1 — Preservation Letters
  app.post("/api/preservation/generate",       wrapAsync(handleGenerateLetter));
  app.post("/api/preservation/:id/approve",    wrapAsync(handleApprovePreservation));
  app.get ("/api/preservation/:id/download",   wrapAsync(handleDownloadPreservationPDF));
  app.get ("/api/preservation/tip/:tipId",     wrapAsync(handleGetTipPreservations));

  // 2.2 — Warrant Workflow
  app.post("/api/tips/:id/warrant/apply",         wrapAsync(handleOpenWarrantApplication));
  app.get ("/api/tips/:id/warrant/applications",  wrapAsync(handleGetWarrantApplications));
  app.get ("/api/warrant/:appId",                 wrapAsync(handleGetWarrantApplication));
  app.post("/api/warrant/:appId/submit-da",       wrapAsync(handleSubmitWarrantToDA));
  app.post("/api/warrant/:appId/grant",           wrapAsync(handleGrantWarrant));
  app.post("/api/warrant/:appId/deny",            wrapAsync(handleDenyWarrant));

  // 2.3 — OJJDP Reports
  app.get("/api/reports/ojjdp",          wrapAsync(handleOJJDPReport));
  app.get("/api/reports/ojjdp/download", wrapAsync(handleOJJDPDownload));

  // 2.4 — Auth
  app.post("/api/auth/login",           wrapAsync(handleLogin));
  app.post("/api/auth/refresh",         wrapAsync(handleRefresh));
  app.post("/api/auth/logout",          wrapAsync(handleLogout));
  app.get ("/api/auth/me",              wrapAsync(handleMe));
  app.post("/api/auth/change-password", wrapAsync(handleChangePassword));

  // 2.4 — Officers (admin/supervisor only for write operations)
  app.get   ("/api/officers",           wrapAsync(handleListOfficers));
  app.post  ("/api/officers",           requireRole("supervisor"), wrapAsync(handleCreateOfficer));
  app.get   ("/api/officers/:id",       wrapAsync(handleGetOfficer));
  app.patch ("/api/officers/:id/role",  requireRole("admin"),      wrapAsync(handleUpdateOfficerRole));
  app.delete("/api/officers/:id",       requireRole("admin"),      wrapAsync(handleDeactivateOfficer));
  app.get   ("/api/officers/suggest/:tipId", wrapAsync(handleSuggestAssignment));

  console.log("[TIER2] Routes mounted: preservation, warrants, OJJDP, auth, officers");
}
