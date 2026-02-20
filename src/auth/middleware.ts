/**
 * Auth Middleware — Express request guard (Tier 2.4, fully implemented)
 *
 * Usage in src/index.ts:
 *   import { authMiddleware } from "./auth/middleware.js";
 *   app.use("/api", authMiddleware);           // Protects all /api/* routes
 *
 * Public routes exempted from auth:
 *   /api/auth/login, /api/auth/refresh, /health, /health/detailed
 *
 * CJIS § 5.6.2.1: Sessions expire after 30 minutes of inactivity.
 * This is tracked via the last_active_at field in the JWT payload.
 */

import type { Request, Response, NextFunction } from "express";
import { verifyToken, hasRole, canAccessUnit, extractBearer, type AuthSession, type OfficerRole } from "./jwt.js";

// Extend Express Request to carry the decoded session
declare module "express" {
  interface Request {
    session?: AuthSession;
  }
}

// Routes that don't require authentication
const PUBLIC_ROUTES = new Set([
  "/api/auth/login",
  "/api/auth/refresh",
  "/health",
  "/health/detailed",
]);

const INACTIVITY_MS = 30 * 60 * 1000; // CJIS: 30 minutes

/**
 * Main auth middleware. Attach to app.use("/api", authMiddleware) after
 * setting AUTH_ENABLED=true in .env.
 *
 * When AUTH_ENABLED is not set, passes through with a warning — allows
 * development without credentials configured.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Bypass for public routes
  const routePath = (req as { path?: string }).path ?? req.url ?? "";
  if (PUBLIC_ROUTES.has(routePath)) { next(); return; }

  // Bypass when auth is not enabled (dev mode)
  if (process.env["AUTH_ENABLED"] !== "true") {
    // Attach a synthetic dev session so downstream code can read role
    req.session = {
      officer_id:           "dev-officer",
      badge_number:         "DEV-001",
      name:                 "Development Officer",
      role:                 "admin",    // Full access in dev
      unit:                 "ICAC",
      specialty:            null,
      max_concurrent_cases: 999,
      jti:                  "dev-jti",
      iat:                  Math.floor(Date.now() / 1000),
      exp:                  Math.floor(Date.now() / 1000) + 28800,
      last_active_at:       new Date().toISOString(),
    };
    next();
    return;
  }

  const token = extractBearer(req.headers["authorization"]);
  if (!token) {
    res.status(401).json({ error: "Authentication required", code: "NO_TOKEN" });
    return;
  }

  const session = await verifyToken(token);
  if (!session) {
    res.status(401).json({ error: "Invalid or expired token", code: "BAD_TOKEN" });
    return;
  }

  // CJIS 30-minute inactivity check
  const inactiveMs = Date.now() - new Date(session.last_active_at).getTime();
  if (inactiveMs > INACTIVITY_MS) {
    res.status(403).json({
      error: "Session expired due to inactivity (CJIS 30-minute policy). Please log in again.",
      code: "INACTIVITY_TIMEOUT",
    });
    return;
  }

  // Update last_active_at for sliding window
  req.session = { ...session, last_active_at: new Date().toISOString() };
  next();
}

/**
 * Require a minimum role. Must be used after authMiddleware.
 *
 * Usage:
 *   router.delete("/api/officers/:id", requireRole("admin"), handler);
 */
export function requireRole(required: OfficerRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const session = req.session;
    if (!session) { res.status(401).json({ error: "Not authenticated" }); return; }
    if (!hasRole(session.role, required)) {
      res.status(403).json({
        error: `This action requires ${required} role or higher`,
        your_role: session.role,
        code: "INSUFFICIENT_ROLE",
      });
      return;
    }
    next();
  };
}

/**
 * Require access to a specific unit.
 * Commanders and admins pass unconditionally.
 */
export function requireUnitAccess(unitParam: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const session = req.session;
    if (!session) { res.status(401).json({ error: "Not authenticated" }); return; }
    const targetUnit = req.params[unitParam] ?? req.query[unitParam];
    if (targetUnit && !canAccessUnit(session, String(targetUnit))) {
      res.status(403).json({
        error: `Access to unit ${targetUnit} requires supervisor or higher role`,
        code: "UNIT_ACCESS_DENIED",
      });
      return;
    }
    next();
  };
}
