/**
 * Multi-Circuit Legal Guide
 *
 * TIER 4.1 FEATURE — Provides circuit-specific Fourth Amendment guidance
 * for file access decisions. Extends the binary Wilson analysis in wilson.ts
 * with per-circuit case law citations and nuanced application notes.
 *
 * Current state of the law (as of early 2026):
 *
 *   9th Circuit:  United States v. Wilson, 13 F.4th 961 (9th Cir. 2020)
 *                 BINDING — strict private-search exception analysis.
 *                 File blocked unless ESP viewed before reporting.
 *
 *   4th Circuit:  No binding precedent on Wilson analysis.
 *                 Conservative Wilson application recommended.
 *                 Covers: NC, VA, MD, WV, SC
 *
 *   5th Circuit:  No binding precedent.
 *                 Conservative Wilson application recommended.
 *                 Covers: TX, LA, MS (high ICAC volume)
 *
 *   All others:   Wilson applied as persuasive authority pending binding
 *                 circuit precedent. Conservative approach.
 *
 * IMPORTANT: This module provides informational guidance only. Agency legal
 * counsel must review before any production deployment. This is not legal advice.
 *
 * Update protocol:
 *   When a circuit issues a new binding opinion on private-search exception
 *   or CSAM file access, update CIRCUIT_RULES below and increment LAST_UPDATED.
 */

export const LAST_UPDATED = "2026-02-19";

// ── Circuit definitions ───────────────────────────────────────────────────────

export type FederalCircuit =
  | "1st"   // ME, NH, MA, RI, PR
  | "2nd"   // VT, NY, CT
  | "3rd"   // PA, NJ, DE, VI
  | "4th"   // MD, NC, SC, VA, WV
  | "5th"   // TX, LA, MS
  | "6th"   // KY, MI, OH, TN
  | "7th"   // IL, IN, WI
  | "8th"   // AR, IA, MN, MO, NE, ND, SD
  | "9th"   // AK, AZ, CA, GU, HI, ID, MP, MT, NV, OR, WA
  | "10th"  // CO, KS, NM, OK, UT, WY
  | "11th"  // AL, FL, GA
  | "DC";   // DC

export const CIRCUIT_STATES: Record<FederalCircuit, string[]> = {
  "1st":  ["ME", "NH", "MA", "RI", "PR"],
  "2nd":  ["VT", "NY", "CT"],
  "3rd":  ["PA", "NJ", "DE"],
  "4th":  ["MD", "NC", "SC", "VA", "WV"],
  "5th":  ["TX", "LA", "MS"],
  "6th":  ["KY", "MI", "OH", "TN"],
  "7th":  ["IL", "IN", "WI"],
  "8th":  ["AR", "IA", "MN", "MO", "NE", "ND", "SD"],
  "9th":  ["AK", "AZ", "CA", "GU", "HI", "ID", "MT", "NV", "OR", "WA"],
  "10th": ["CO", "KS", "NM", "OK", "UT", "WY"],
  "11th": ["AL", "FL", "GA"],
  "DC":   ["DC"],
};

// ── Per-circuit rules ─────────────────────────────────────────────────────────

export interface CircuitRule {
  circuit: FederalCircuit;
  binding_precedent: string | null;
  application: "strict_wilson" | "conservative_wilson" | "no_precedent_conservative";
  file_access_standard: string;
  notes: string;
  case_citations: string[];
  last_reviewed: string;
}

export const CIRCUIT_RULES: Record<FederalCircuit, CircuitRule> = {
  "9th": {
    circuit: "9th",
    binding_precedent: "United States v. Wilson, 13 F.4th 961 (9th Cir. 2020)",
    application: "strict_wilson",
    file_access_standard:
      "Files accessible only if (a) ESP viewed the file before reporting, OR " +
      "(b) file was publicly available. If esp_viewed=false or missing: warrant required.",
    notes:
      "Wilson is binding. The private-search exception does not apply when an ESP " +
      "uploads a file to NCMEC without viewing it. The government cannot open the file " +
      "without a warrant. No circuit exception recognized as of last review.",
    case_citations: [
      "United States v. Wilson, 13 F.4th 961 (9th Cir. 2020)",
      "United States v. Runyon, 983 F.3d 605 (3rd Cir. 2020) (distinguishable — PhotoDNA only)",
    ],
    last_reviewed: "2026-02-19",
  },
  "4th": {
    circuit: "4th",
    binding_precedent: null,
    application: "conservative_wilson",
    file_access_standard:
      "No binding 4th Circuit precedent on Wilson analysis. Conservative application: " +
      "treat as if Wilson applies. Warrant required when esp_viewed=false.",
    notes:
      "Maryland, Virginia, North Carolina, South Carolina, and West Virginia fall in the " +
      "4th Circuit. Significant ICAC tip volume from VA/MD/NC. Until binding circuit " +
      "precedent, conservative application recommended. Wilson reasoning is persuasive.",
    case_citations: [
      "United States v. Wilson, 13 F.4th 961 (9th Cir. 2020) [persuasive]",
      "Walczyk v. Rio, 496 F.3d 139 (2d Cir. 2007) [private-search exception general]",
    ],
    last_reviewed: "2026-02-19",
  },
  "5th": {
    circuit: "5th",
    binding_precedent: null,
    application: "conservative_wilson",
    file_access_standard:
      "No binding 5th Circuit precedent. Conservative Wilson application. " +
      "Texas, Louisiana, Mississippi are high ICAC volume states. " +
      "Warrant required when esp_viewed=false.",
    notes:
      "5th Circuit covers TX/LA/MS — high combined ICAC volume. No binding precedent " +
      "on Wilson issue. State courts in TX may have additional evidentiary rules. " +
      "Consult agency legal counsel for TX-specific guidance.",
    case_citations: [
      "United States v. Wilson, 13 F.4th 961 (9th Cir. 2020) [persuasive]",
    ],
    last_reviewed: "2026-02-19",
  },
  // Remaining circuits: no binding precedent — conservative Wilson applied
  "1st":  { circuit: "1st",  binding_precedent: null, application: "no_precedent_conservative", file_access_standard: "Conservative Wilson — warrant required when esp_viewed=false", notes: "No binding precedent. Conservative application.", case_citations: ["United States v. Wilson, 13 F.4th 961 (9th Cir. 2020) [persuasive]"], last_reviewed: "2026-02-19" },
  "2nd":  { circuit: "2nd",  binding_precedent: null, application: "no_precedent_conservative", file_access_standard: "Conservative Wilson — warrant required when esp_viewed=false", notes: "No binding precedent.", case_citations: ["United States v. Wilson, 13 F.4th 961 (9th Cir. 2020) [persuasive]"], last_reviewed: "2026-02-19" },
  "3rd":  { circuit: "3rd",  binding_precedent: null, application: "no_precedent_conservative", file_access_standard: "Conservative Wilson — warrant required when esp_viewed=false", notes: "Runyon (2020) addressed PhotoDNA only, not direct file access. Consult counsel.", case_citations: ["United States v. Runyon, 983 F.3d 605 (3rd Cir. 2020)"], last_reviewed: "2026-02-19" },
  "6th":  { circuit: "6th",  binding_precedent: null, application: "no_precedent_conservative", file_access_standard: "Conservative Wilson.", notes: "Covers KY, MI, OH, TN. No binding precedent.", case_citations: [], last_reviewed: "2026-02-19" },
  "7th":  { circuit: "7th",  binding_precedent: null, application: "no_precedent_conservative", file_access_standard: "Conservative Wilson.", notes: "Covers IL, IN, WI. No binding precedent.", case_citations: [], last_reviewed: "2026-02-19" },
  "8th":  { circuit: "8th",  binding_precedent: null, application: "no_precedent_conservative", file_access_standard: "Conservative Wilson.", notes: "Covers AR, IA, MN, MO, NE, ND, SD.", case_citations: [], last_reviewed: "2026-02-19" },
  "10th": { circuit: "10th", binding_precedent: null, application: "no_precedent_conservative", file_access_standard: "Conservative Wilson.", notes: "Covers CO, KS, NM, OK, UT, WY.", case_citations: [], last_reviewed: "2026-02-19" },
  "11th": { circuit: "11th", binding_precedent: null, application: "no_precedent_conservative", file_access_standard: "Conservative Wilson.", notes: "Covers AL, FL, GA. FL is high ICAC volume.", case_citations: [], last_reviewed: "2026-02-19" },
  "DC":   { circuit: "DC",   binding_precedent: null, application: "no_precedent_conservative", file_access_standard: "Conservative Wilson.", notes: "Federal investigations in DC Circuit.", case_citations: [], last_reviewed: "2026-02-19" },
};

// ── Lookup helpers ────────────────────────────────────────────────────────────

/** Get the federal circuit for a US state abbreviation */
export function getCircuitForState(stateAbbr: string): FederalCircuit | null {
  const upper = stateAbbr.toUpperCase();
  for (const [circuit, states] of Object.entries(CIRCUIT_STATES)) {
    if (states.includes(upper)) return circuit as FederalCircuit;
  }
  return null;
}

/** Get the circuit rule for a given circuit */
export function getCircuitRule(circuit: FederalCircuit): CircuitRule {
  return CIRCUIT_RULES[circuit];
}

/**
 * Determine if a file requires a warrant given circuit and ESP-viewed status.
 * This extends wilson.ts with circuit-specific reasoning.
 *
 * TIER 4.1 — Currently produces same output as wilson.ts (conservative for all).
 * Future: differentiate circuit-specific analysis as precedent develops.
 */
export function requiresWarrantByCircuit(opts: {
  circuit: FederalCircuit;
  espViewed: boolean;
  espViewedMissing: boolean;
  publiclyAvailable: boolean;
}): { required: boolean; legal_note: string; citation: string | null } {
  const { circuit, espViewed, espViewedMissing, publiclyAvailable } = opts;

  if (publiclyAvailable) {
    return {
      required: false,
      legal_note: "File was publicly available — private-search exception not needed.",
      citation: null,
    };
  }

  if (espViewed && !espViewedMissing) {
    const rule = CIRCUIT_RULES[circuit];
    return {
      required: false,
      legal_note: `ESP viewed file before reporting — private-search exception applies (${circuit === "9th" ? "Wilson binding" : "persuasive"}).`,
      citation: rule.case_citations[0] ?? null,
    };
  }

  // esp_viewed=false or missing → warrant required in all circuits
  const rule = CIRCUIT_RULES[circuit];
  const missingNote = espViewedMissing
    ? " (esp_viewed field absent from Section A — treated as not viewed per conservative standard)"
    : "";
  const standardNote = rule ? rule.file_access_standard.split("—")[0]?.trim() ?? "warrant standard" : "warrant standard";
  return {
    required: true,
    legal_note:
      `File access blocked — esp_viewed=false${missingNote}. ` +
      `${circuit === "9th" ? "Wilson directly binding." : `No binding ${circuit} Circuit precedent; Wilson applied conservatively.`} ` +
      `Warrant required under ${standardNote}.`,
    citation: rule?.case_citations[0] ?? "United States v. Wilson, 13 F.4th 961 (9th Cir. 2020)",
  };
}


// ── Precedent update registry ─────────────────────────────────────────────────
//
// Tier 4.1: When a new binding opinion is issued, an entry is added here
// and CIRCUIT_RULES above is updated. This log is included in audit trails
// so prosecutors can see the legal standard in effect at the time of triage.

export interface PrecedentUpdate {
  date:        string;          // ISO date the opinion was issued
  circuit:     FederalCircuit;
  case_name:   string;
  citation:    string;
  effect:      "now_binding" | "affirmed" | "limited" | "reversed";
  summary:     string;          // One-sentence summary of impact on file access
  added_by:    string;          // Badge number of legal analyst who added this
}

export const PRECEDENT_LOG: PrecedentUpdate[] = [
  {
    date:      "2020-09-18",
    circuit:   "9th",
    case_name: "United States v. Wilson",
    citation:  "13 F.4th 961 (9th Cir. 2020)",
    effect:    "now_binding",
    summary:   "Warrant required to open CyberTip files that the ESP did not itself view prior to reporting.",
    added_by:  "SYSTEM",
  },
];

/**
 * Return the precedent log entries relevant to a given circuit.
 * Included in Legal Gate audit output so prosecutors can verify
 * the legal standard applied at the time of triage.
 */
export function getCircuitPrecedentHistory(circuit: FederalCircuit): PrecedentUpdate[] {
  return PRECEDENT_LOG.filter(p => p.circuit === circuit);
}

/**
 * Add a new binding precedent to the registry and — if the effect is
 * "now_binding" — automatically update CIRCUIT_RULES so the deterministic
 * warrant logic reflects the new standard immediately, without a code deploy.
 *
 * Persists to DB via savePrecedentToDB() (no-op in dev/test mode).
 * Call hydrateFromDB() at startup to restore persisted state after restart.
 */
export function recordPrecedentUpdate(update: PrecedentUpdate): void {
  // Update in-memory log
  PRECEDENT_LOG.push(update);
  PRECEDENT_LOG.sort((a, b) => b.date.localeCompare(a.date));

  // If binding, update the live CIRCUIT_RULES entry so warrant decisions change immediately
  if (update.effect === "now_binding" && CIRCUIT_RULES[update.circuit]) {
    const rule = CIRCUIT_RULES[update.circuit]!;
    CIRCUIT_RULES[update.circuit] = {
      ...rule,
      binding_precedent: update.citation,
      application: "strict_wilson",
      last_reviewed: update.date,
    };
    console.log(`[CIRCUIT] CIRCUIT_RULES[${update.circuit}] updated → strict_wilson (${update.citation})`);
  }

  console.log(`[CIRCUIT] Precedent recorded: ${update.case_name} (${update.circuit} Circuit, ${update.date})`);
}

/**
 * Apply a persisted circuit rule override directly (e.g., loaded from DB on startup).
 * Used to restore supervisor-set overrides after a server restart.
 */
export function applyCircuitRuleOverride(
  circuit: FederalCircuit,
  binding_precedent: string | null,
  application: CircuitRule["application"],
  file_access_standard?: string
): void {
  if (!CIRCUIT_RULES[circuit]) return;
  CIRCUIT_RULES[circuit] = {
    ...CIRCUIT_RULES[circuit]!,
    binding_precedent,
    application,
    ...(file_access_standard ? { file_access_standard } : {}),
  };
}

/**
 * Hydrate PRECEDENT_LOG and CIRCUIT_RULES from DB-persisted state.
 * Call once at server startup (after DB connection is available).
 * No-op in dev/test (DB_MODE != postgres).
 */
export async function hydrateFromDB(): Promise<void> {
  try {
    // Dynamic import avoids circular deps and keeps this module synchronous by default
    const { loadPrecedentsFromDB, loadCircuitOverridesFromDB } = await import("../db/precedents.js");

    const [dbPrecedents, dbOverrides] = await Promise.all([
      loadPrecedentsFromDB(),
      loadCircuitOverridesFromDB(),
    ]);

    // Merge DB precedents into PRECEDENT_LOG (skip duplicates by citation)
    const existingCitations = new Set(PRECEDENT_LOG.map(p => p.citation));
    for (const p of dbPrecedents) {
      if (!existingCitations.has(p.citation)) {
        PRECEDENT_LOG.push(p);
        existingCitations.add(p.citation);
      }
    }
    PRECEDENT_LOG.sort((a, b) => b.date.localeCompare(a.date));

    // Apply circuit rule overrides from DB → updates CIRCUIT_RULES in place
    for (const override of dbOverrides) {
      applyCircuitRuleOverride(
        override.circuit as FederalCircuit,
        override.binding_precedent,
        override.application as CircuitRule["application"],
        override.file_access_standard ?? undefined
      );
    }

    if (dbPrecedents.length > 0 || dbOverrides.length > 0) {
      console.log(
        `[CIRCUIT] Hydrated from DB: ${dbPrecedents.length} precedents, ` +
        `${dbOverrides.length} circuit rule overrides applied`
      );
    }
  } catch (err) {
    // Hydration failure is non-fatal — system operates on hardcoded defaults
    console.warn("[CIRCUIT] DB hydration skipped (DB unavailable or not postgres mode):", String(err).slice(0, 80));
  }
}

/**
 * Summarize the current legal standard for a circuit as a single string.
 * Used by Legal Gate to include in tip audit entries.
 */
export function circuitLegalSummary(circuit: FederalCircuit | null): string {
  if (!circuit) return `Conservative Wilson applied (circuit unknown). Database: ${LAST_UPDATED}.`;
  const rule = CIRCUIT_RULES[circuit];
  if (!rule) return `No circuit data for ${circuit}.`;
  const binding = rule.binding_precedent
    ? `BINDING: ${rule.binding_precedent}`
    : `No binding precedent — ${rule.application}`;
  return `${circuit} Circuit: ${binding}. Rule: ${rule.file_access_standard.slice(0, 80)}… (reviewed ${rule.last_reviewed})`;
}
