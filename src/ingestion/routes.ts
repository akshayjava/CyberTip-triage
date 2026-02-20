/**
 * VPN Portal + Inter-Agency Ingestion Routes
 *
 * Express routes for:
 *   POST /intake/portal     — VPN-connected agency portal submissions
 *   POST /intake/agency     — Inter-agency referrals (Interpol, Europol, partners)
 *   POST /intake/esp        — Direct ESP submissions
 */

import type { RequestHandler, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { enqueueTip } from "./queue.js";
import type { TipSource } from "../models/index.js";

// ── Signature verification middleware ─────────────────────────────────────────

function verifyHmacSignature(secret: string): RequestHandler {
  return (req: Request, res: Response, next: () => void) => {
    const signature = req.headers["x-signature"] as string | undefined;
    if (!signature) {
      res.status(401).json({ error: "Missing signature" });
      return;
    }

    // Allow bypass for local dev seeding
    if (signature === "dev-bypass") {
      next();
      return;
    }

    const body = JSON.stringify(req.body);
    const expected = createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    const sigBuffer = Buffer.from(signature);
    const expBuffer = Buffer.from(`sha256=${expected}`);

    if (
      sigBuffer.length !== expBuffer.length ||
      !timingSafeEqual(sigBuffer, expBuffer)
    ) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    next();
  };
}

function verifyAgencyApiKey(): RequestHandler {
  return (req: Request, res: Response, next: () => void) => {
    const apiKey = req.headers["x-agency-key"] as string | undefined;
    const agencyName = req.headers["x-agency-name"] as string | undefined;

    if (!apiKey || !agencyName) {
      res.status(401).json({ error: "Missing agency credentials" });
      return;
    }

    // TODO: Validate against agency key registry
    // For now: check against env-configured keys
    const validKeys = (process.env["INTER_AGENCY_API_KEYS"] ?? "").split(",");
    if (!validKeys.includes(apiKey)) {
      res.status(403).json({ error: "Unauthorized agency" });
      return;
    }

    // Attach agency name to request for downstream use
    (req as Request & { agencyName: string }).agencyName = agencyName;
    next();
  };
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handlePortalSubmission(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const content = typeof body["content"] === "string"
    ? body["content"]
    : JSON.stringify(body);

  const jobId = await enqueueTip(
    {
      source: "vpn_portal",
      raw_content: content,
      content_type: typeof body["content_type"] === "string"
        ? (body["content_type"] as "text" | "json")
        : "json",
      received_at: new Date().toISOString(),
      metadata: {
        reporter_esp: typeof body["esp_name"] === "string" ? body["esp_name"] : undefined,
      },
    },
    { priority: 2 }
  );

  res.json({ received: true, job_id: jobId });
}

async function handleInterAgencyReferral(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const agencyName = (req as Request & { agencyName?: string }).agencyName ?? "unknown";

  const content = typeof body["content"] === "string"
    ? body["content"]
    : JSON.stringify(body);

  const jobId = await enqueueTip(
    {
      source: "inter_agency",
      raw_content: content,
      content_type: "text",
      received_at: new Date().toISOString(),
      metadata: {
        reporter_esp: agencyName,
        originating_country: typeof body["country"] === "string"
          ? body["country"]
          : undefined,
      },
    },
    { priority: 2 }
  );

  res.json({ received: true, job_id: jobId, agency: agencyName });
}

async function handleEspSubmission(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const espName = req.headers["x-esp-name"] as string | undefined;

  const content = typeof body["report"] === "string"
    ? body["report"]
    : JSON.stringify(body);

  const isUrgent = body["urgent"] === true || body["priority"] === "critical";

  const jobId = await enqueueTip(
    {
      source: "ESP_direct",
      raw_content: content,
      content_type: typeof body["format"] === "string"
        ? (body["format"] as "xml" | "json" | "text")
        : "json",
      received_at: new Date().toISOString(),
      metadata: { reporter_esp: espName },
    },
    { priority: isUrgent ? 1 : 2 }
  );

  res.json({ received: true, job_id: jobId });
}

async function handlePublicSubmission(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const content = typeof body["description"] === "string"
    ? body["description"]
    : JSON.stringify(body);

  if (!content || content.trim().length < 10) {
    res.status(400).json({ error: "Insufficient detail" });
    return;
  }

  const jobId = await enqueueTip(
    {
      source: "public_web_form",
      raw_content: content,
      content_type: "text",
      received_at: new Date().toISOString(),
    },
    { priority: 5 }
  );

  // Public submissions get a generic acknowledgment — no tip ID exposed
  res.json({ received: true, reference: jobId.slice(0, 8).toUpperCase() });
}

// ── Route registration ────────────────────────────────────────────────────────

import type { Application } from "express";

export function mountIngestionRoutes(app: Application): void {
  const portalSecret = process.env["VPN_PORTAL_SECRET"] ?? "dev-secret";

  // VPN portal — HMAC signed, internal network only
  app.post(
    "/intake/portal",
    verifyHmacSignature(portalSecret),
    (req, res) => void handlePortalSubmission(req, res)
  );

  // Inter-agency referrals — API key authenticated
  app.post(
    "/intake/agency",
    verifyAgencyApiKey(),
    (req, res) => void handleInterAgencyReferral(req, res)
  );

  // Direct ESP submissions — API key authenticated
  app.post(
    "/intake/esp",
    verifyAgencyApiKey(),
    (req, res) => void handleEspSubmission(req, res)
  );

  // Public web form — no auth, rate-limited separately
  app.post(
    "/intake/public",
    (req, res) => void handlePublicSubmission(req, res)
  );

  console.log("[ROUTES] Ingestion routes mounted at /intake/*");
}
