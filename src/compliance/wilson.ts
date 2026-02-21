/**
 * Wilson Ruling Compliance Helpers
 *
 * United States v. Wilson, 9th Cir. 2021 (18-50440):
 * Law enforcement CANNOT open files from a CyberTip without a warrant if
 * the reporting ESP did not itself open and view those specific files.
 * Hash matching alone does NOT constitute a "private search" exception.
 *
 * These functions are the single source of truth for warrant logic.
 * All agents must use these — no inline warrant logic anywhere else.
 */

import type { TipFile, LegalStatus, WarrantStatus } from "../models/index.js";
import { requiresWarrantByCircuit, type FederalCircuit } from "./circuit_guide.js";

// ── Core warrant decision ─────────────────────────────────────────────────────

/**
 * Compute whether a warrant is required before opening this file.
 *
 * Conservative rule: if esp_viewed flag is absent or ambiguous, treat as false.
 * A false positive (block when not needed) causes delay.
 * A false negative (open when blocked) collapses a prosecution.
 *
 * TIER 4.1 UPDATE: Accepts optional circuit parameter. If provided, uses
 * circuit-specific logic from circuit_guide.ts.
 */
export function computeWarrantRequired(
  file: Pick<TipFile, "esp_viewed" | "esp_viewed_missing" | "publicly_available">,
  circuit?: FederalCircuit | string | null
): boolean {
  // If circuit info is available, delegate to Tier 4.1 logic
  if (circuit && typeof circuit === "string" && /^\d+(st|nd|rd|th)|DC$/.test(circuit)) {
    // Basic validation to match FederalCircuit type (simplified)
    const result = requiresWarrantByCircuit({
      circuit: circuit as FederalCircuit,
      espViewed: file.esp_viewed,
      espViewedMissing: file.esp_viewed_missing,
      publiclyAvailable: file.publicly_available,
    });
    return result.required;
  }

  // Fallback: Conservative default logic (Pre-Tier 4.1)

  // If ESP viewed the file, private search occurred — no warrant needed
  if (file.esp_viewed === true && !file.esp_viewed_missing) {
    return false;
  }

  // If flag is missing, treat conservatively as not-viewed
  const effectivelyViewed = file.esp_viewed === true && !file.esp_viewed_missing;

  if (effectivelyViewed) return false;

  // Not viewed + not publicly available = warrant required
  if (!file.publicly_available) return true;

  // Not viewed + publicly available = borderline; flag for review but don't auto-clear
  // Returning true here is the conservative default per Wilson
  return true;
}

/**
 * Compute initial file_access_blocked value.
 * Blocked by default; cleared only when warrant not required OR warrant granted.
 */
export function computeFileAccessBlocked(
  file: Pick<
    TipFile,
    "esp_viewed" | "esp_viewed_missing" | "publicly_available" | "warrant_status"
  >,
  circuit?: FederalCircuit | string | null
): boolean {
  const warrantRequired = computeWarrantRequired(file, circuit);

  if (!warrantRequired) return false;

  // Warrant required — blocked unless already granted
  return file.warrant_status !== "granted";
}

// ── Assertion (throws on violation) ─────────────────────────────────────────

/**
 * Assert a file is accessible before any code tries to use its content.
 * Throws a hard error if the file is blocked — ensures no accidental bypass.
 */
export function assertFileAccessible(file: TipFile): void {
  if (file.file_access_blocked) {
    throw new WilsonBlockedError(
      file.file_id,
      file.warrant_status,
      file.warrant_required
    );
  }
}

export class WilsonBlockedError extends Error {
  constructor(
    public readonly file_id: string,
    public readonly warrant_status: WarrantStatus,
    public readonly warrant_required: boolean
  ) {
    super(
      `File ${file_id} is blocked. ` +
        `warrant_required=${warrant_required}, warrant_status=${warrant_status}. ` +
        `A warrant must be obtained and recorded before accessing this file.`
    );
    this.name = "WilsonBlockedError";
  }
}

// ── Legal note builder ───────────────────────────────────────────────────────

interface CircuitInfo {
  name: string;
  binding: boolean;
  note: string;
}

const CIRCUIT_MAP: Record<string, CircuitInfo> = {
  // 9th Circuit states — Wilson binding
  AK: { name: "9th Circuit", binding: true, note: "Wilson is binding precedent here." },
  AZ: { name: "9th Circuit", binding: true, note: "Wilson is binding precedent here." },
  CA: { name: "9th Circuit", binding: true, note: "Wilson is binding precedent here." },
  HI: { name: "9th Circuit", binding: true, note: "Wilson is binding precedent here." },
  ID: { name: "9th Circuit", binding: true, note: "Wilson is binding precedent here." },
  MT: { name: "9th Circuit", binding: true, note: "Wilson is binding precedent here." },
  NV: { name: "9th Circuit", binding: true, note: "Wilson is binding precedent here." },
  OR: { name: "9th Circuit", binding: true, note: "Wilson is binding precedent here." },
  WA: { name: "9th Circuit", binding: true, note: "Wilson is binding precedent here." },
};

export function getCircuitInfo(stateOrJurisdiction: string): CircuitInfo {
  const upper = stateOrJurisdiction.toUpperCase();
  return (
    CIRCUIT_MAP[upper] ?? {
      name: "unknown circuit",
      binding: false,
      note:
        "Wilson (9th Cir. 2021) is persuasive but not binding here. " +
        "Consult your US Attorney's office before opening unviewed files.",
    }
  );
}

/**
 * Build a plain-English legal note for the investigator.
 * Describes exactly what they can and cannot do with each file.
 */
export function buildLegalNote(
  files: TipFile[],
  jurisdictionState?: string
): string {
  const circuit = jurisdictionState
    ? getCircuitInfo(jurisdictionState)
    : {
        name: "your circuit",
        binding: false,
        note: "Consult your US Attorney's office before opening any unviewed files.",
      };

  const accessible = files.filter((f) => !f.file_access_blocked);
  const blocked = files.filter((f) => f.file_access_blocked);
  const appliedWarrant = blocked.filter((f) => f.warrant_status === "applied");
  const deniedWarrant = blocked.filter((f) => f.warrant_status === "denied");

  const parts: string[] = [];

  if (accessible.length > 0) {
    parts.push(
      `${accessible.length} file(s) are accessible: the ESP confirmed it viewed ` +
        `these files before reporting, satisfying the private-search exception under Wilson.`
    );
  }

  if (blocked.length > 0) {
    parts.push(
      `${blocked.length} file(s) are BLOCKED per United States v. Wilson (${circuit.name}, 2021): ` +
        `the ESP did not view these files, so opening them requires a warrant. ` +
        circuit.note
    );
  }

  if (appliedWarrant.length > 0) {
    parts.push(
      `${appliedWarrant.length} file(s) require a warrant (application pending). ` +
        `Hash matches constitute probable cause. Files will unlock automatically when you record the granted warrant number.`
    );
  }

  if (deniedWarrant.length > 0) {
    parts.push(
      `${deniedWarrant.length} file(s) had warrant applications DENIED. ` +
        `Do not open these files. Contact your legal advisor.`
    );
  }

  return parts.join(" ");
}

// ── LegalStatus builder ──────────────────────────────────────────────────────

/**
 * Build a complete LegalStatus object from a tip's files.
 * Called by the Legal Gate Agent after computing warrant fields on each file.
 */
export function buildLegalStatus(
  files: TipFile[],
  jurisdictionState?: string
): LegalStatus {
  const filesRequiringWarrant = files
    .filter((f) => f.warrant_required)
    .map((f) => f.file_id);

  const allWarrantsResolved = filesRequiringWarrant.every((fid) => {
    const file = files.find((f) => f.file_id === fid);
    return (
      file?.warrant_status === "granted" || file?.warrant_status === "denied"
    );
  });

  const anyFilesAccessible = files.some((f) => !f.file_access_blocked);

  const circuit = jurisdictionState
    ? getCircuitInfo(jurisdictionState)
    : undefined;

  return {
    files_requiring_warrant: filesRequiringWarrant,
    all_warrants_resolved: allWarrantsResolved,
    any_files_accessible: anyFilesAccessible,
    legal_note: buildLegalNote(files, jurisdictionState),
    relevant_circuit: circuit?.name,
    exigent_circumstances_claimed: false,
  };
}
