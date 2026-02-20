/**
 * Officer Data Model (Tier 2.4)
 *
 * Represents an authenticated investigator with role-based access control.
 * Roles enforce data access at the API layer — not just the UI.
 */

import { z } from "zod";

export const OfficerRoleSchema = z.enum([
  "analyst",        // Read-only within assigned unit
  "investigator",   // Read-write own assigned tips; read unit tips
  "supervisor",     // Full unit access; can see cross-unit summaries
  "commander",      // Full read access; approve legal processes
  "admin",          // Full access including officer management
]);
export type OfficerRole = z.infer<typeof OfficerRoleSchema>;

export const UnitCodeSchema = z.enum([
  "ICAC",
  "FINANCIAL_CRIMES",
  "CYBER",
  "JTTF",
  "GENERAL_INV",
  "SUPERVISOR",
]);
export type UnitCode = z.infer<typeof UnitCodeSchema>;

export const OfficerSpecialtySchema = z.enum([
  "AIG_CSAM",      // AI-Generated CSAM specialist
  "INTERNATIONAL", // Cross-border / MLAT specialist
  "SEXTORTION",    // Online sextortion specialist
  "UNDERCOVER",    // Online undercover operations
  "FORENSICS",     // Digital forensics
  "GENERAL",       // General ICAC investigator
]).optional();

export const OfficerSchema = z.object({
  officer_id:           z.string().uuid(),
  badge_number:         z.string().min(1),
  name:                 z.string().min(1),
  rank:                 z.string().min(1),
  unit:                 UnitCodeSchema,
  role:                 OfficerRoleSchema,
  email:                z.string().email(),
  phone:                z.string().optional(),
  specialty:            OfficerSpecialtySchema,
  active:               z.boolean(),
  supervisor_id:        z.string().uuid().optional(),
  max_concurrent_cases: z.number().int().positive().optional(),
  assigned_tip_ids:     z.array(z.string().uuid()),
  created_at:           z.string().datetime(),
  updated_at:           z.string().datetime().optional(),
  last_login_at:        z.string().datetime().optional(),

  // Auth — NEVER returned in API responses
  password_hash:        z.string().optional(), // bcrypt hash — stripped before returning
});
export type Officer = z.infer<typeof OfficerSchema>;

// Public officer view — strips auth fields by reconstructing schema without password_hash
export const OfficerPublicSchema = z.object({
  officer_id:           z.string().uuid(),
  badge_number:         z.string().min(1),
  name:                 z.string().min(1),
  rank:                 z.string().min(1),
  unit:                 UnitCodeSchema,
  role:                 OfficerRoleSchema,
  email:                z.string().email(),
  phone:                z.string().optional(),
  specialty:            OfficerSpecialtySchema,
  active:               z.boolean(),
  supervisor_id:        z.string().uuid().optional(),
  max_concurrent_cases: z.number().int().positive().optional(),
  assigned_tip_ids:     z.array(z.string().uuid()),
  created_at:           z.string().datetime(),
  updated_at:           z.string().datetime().optional(),
  last_login_at:        z.string().datetime().optional(),
});
export type OfficerPublic = z.infer<typeof OfficerPublicSchema>;

// Auth session embedded in JWT
export const AuthSessionSchema = z.object({
  officer_id:   z.string().uuid(),
  badge_number: z.string(),
  name:         z.string(),
  role:         OfficerRoleSchema,
  unit:         UnitCodeSchema,
  specialty:    OfficerSpecialtySchema,
  exp:          z.number(),  // Unix timestamp
  iat:          z.number(),  // Issued at
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

// Role access levels (higher = more access)
export const ROLE_LEVEL: Record<OfficerRole, number> = {
  analyst:       1,
  investigator:  2,
  supervisor:    3,
  commander:     4,
  admin:         5,
};

export function hasRole(session: AuthSession, minimumRole: OfficerRole): boolean {
  return (ROLE_LEVEL[session.role] ?? 0) >= (ROLE_LEVEL[minimumRole] ?? 0);
}

/** Routing units accessible to each role */
export function canAccessUnit(session: AuthSession, targetUnit: string): boolean {
  if (session.role === "admin" || session.role === "commander") return true;
  if (session.role === "supervisor") return session.unit === targetUnit;
  // analyst / investigator: own unit only
  return session.unit === targetUnit;
}
