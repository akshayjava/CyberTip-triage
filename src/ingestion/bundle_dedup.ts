/**
 * Bundle Deduplication Engine — Tier 3.2
 *
 * PROBLEM: NCMEC began bundling viral incidents in 2024. A single YouTube
 * video reported across 20,000 users generates 20,000 identical CyberTips,
 * each with the same URL, hash, and subject. Without deduplication, this:
 *   - Floods the investigator queue
 *   - Wastes 20,000× the AI pipeline budget
 *   - Buries genuinely unique tips under duplicates
 *
 * SOLUTION: Canonical tip system.
 *   1. First tip for a bundle becomes the CANONICAL record.
 *   2. Subsequent tips with the same bundle fingerprint are:
 *      a. Detected before pipeline runs (saves API cost)
 *      b. Their incident count is folded into the canonical tip
 *      c. They are stored as DEDUPLICATED status (for audit trail)
 *      d. The canonical tip's bundled_incident_count is updated
 *
 * FINGERPRINTING: A bundle is identified by hashing the combination of:
 *   - ESP name (who reported)
 *   - Primary file hash (what was reported)
 *   - Subject URL or platform (where the content lives)
 *   - Incident date (within a 7-day window)
 *
 * SCORING: Bundle size does NOT change severity. A viral YouTube video
 * reported 50,000 times is no more severe than if reported once.
 * (The score is already P1 because it's CSAM — volume is irrelevant.)
 *
 * QUEUE DISPLAY: Shows "BUNDLE: 2,847 reports" badge instead of
 * flooding 2,847 rows into the queue.
 */

import { createHash } from "crypto";
import { listTips, upsertTip, getTipById } from "../db/tips.js";
import { appendAuditEntry } from "../compliance/audit.js";
import type { CyberTip } from "../models/index.js";

// ── Bundle fingerprinting ─────────────────────────────────────────────────────

export interface BundleSignature {
  esp_name: string;
  primary_hash?: string;         // First file hash (SHA-256 preferred)
  subject_url?: string;          // URL/platform being reported
  incident_date_week: string;    // ISO date of the MONDAY of the incident week
}

/** Convert any date to the ISO date of its Monday (7-day dedup window) */
function toWeekStart(iso: string): string {
  const d = new Date(iso);
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Generate a stable 16-hex fingerprint for a bundle */
export function bundleFingerprint(sig: BundleSignature): string {
  const key = [
    sig.esp_name.toLowerCase().trim(),
    sig.primary_hash?.toLowerCase() ?? "",
    sig.subject_url?.toLowerCase().replace(/^https?:\/\//, "").split("?")[0] ?? "",
    sig.incident_date_week,
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** Extract a BundleSignature from a CyberTip */
export function extractSignature(tip: CyberTip): BundleSignature {
  const cls = tip.classification as any;
  const ex  = tip.extracted as any;

  const espName =
    cls?.esp_name ??
    (tip.reporter as any)?.esp_name ??
    tip.source ??
    "unknown";

  const primaryHash =
    tip.files?.[0]?.hash_sha256 ??
    tip.files?.[0]?.hash_md5 ??
    tip.files?.[0]?.photodna_hash;

  const subjectUrl =
    ex?.urls?.[0] ??
    ex?.platforms?.[0] ??
    undefined;

  return {
    esp_name:            String(espName),
    primary_hash:        primaryHash,
    subject_url:         subjectUrl,
    incident_date_week:  toWeekStart(tip.received_at),
  };
}

// ── Deduplication result ──────────────────────────────────────────────────────

export type BundleCheckResult =
  | { is_duplicate: false; canonical_tip_id: null; fingerprint: string }
  | { is_duplicate: true;  canonical_tip_id: string; fingerprint: string; canonical_count: number };

// ── In-memory fingerprint cache (fast path before DB) ─────────────────────────

const fingerprintCache = new Map<string, string>(); // fingerprint → canonical tip_id

/** Pre-warm the cache from the database at startup */
export async function warmBundleCache(): Promise<void> {
  try {
    const { tips } = await listTips({ is_bundled: true, limit: 5000, exclude_body: true });
    for (const tip of tips) {
      const sig = extractSignature(tip);
      const fp  = bundleFingerprint(sig);
      if (!fingerprintCache.has(fp)) {
        fingerprintCache.set(fp, tip.tip_id);
      }
    }
    console.log(`[BUNDLE] Cache warmed with ${fingerprintCache.size} bundle fingerprints.`);
  } catch (err) {
    console.warn("[BUNDLE] Cache warm failed (non-fatal):", err);
  }
}

// ── Main deduplication check ──────────────────────────────────────────────────

/**
 * Check whether an incoming tip is a duplicate of an existing bundle.
 * Call this BEFORE running the triage pipeline — it's cheap and prevents
 * wasting 8 LLM calls on a tip that's already been processed.
 *
 * @param incoming - The new tip (may not yet be persisted)
 * @returns BundleCheckResult
 */
export async function checkBundleDuplicate(incoming: CyberTip): Promise<BundleCheckResult> {
  if (!incoming.is_bundled) {
    return { is_duplicate: false, canonical_tip_id: null, fingerprint: "" };
  }

  const sig = extractSignature(incoming);
  const fp  = bundleFingerprint(sig);

  // Fast path: in-memory cache
  const cachedCanonical = fingerprintCache.get(fp);
  if (cachedCanonical && cachedCanonical !== incoming.tip_id) {
    const canonical = await getTipById(cachedCanonical);
    if (canonical) {
      return {
        is_duplicate:      true,
        canonical_tip_id:  cachedCanonical,
        fingerprint:       fp,
        canonical_count:   canonical.bundled_incident_count ?? 1,
      };
    }
    // Cache miss (tip was deleted?): remove stale entry
    fingerprintCache.delete(fp);
  }

  // Slow path: scan DB for matching fingerprint
  const { tips } = await listTips({ is_bundled: true, limit: 5000, exclude_body: true });
  for (const existing of tips) {
    if (existing.tip_id === incoming.tip_id) continue;

    const existingSig = extractSignature(existing);
    const existingFp  = bundleFingerprint(existingSig);

    if (existingFp === fp) {
      fingerprintCache.set(fp, existing.tip_id);
      return {
        is_duplicate:      true,
        canonical_tip_id:  existing.tip_id,
        fingerprint:       fp,
        canonical_count:   existing.bundled_incident_count ?? 1,
      };
    }
  }

  // First time we've seen this fingerprint — this IS the canonical tip
  fingerprintCache.set(fp, incoming.tip_id);
  return { is_duplicate: false, canonical_tip_id: null, fingerprint: fp };
}

// ── Fold duplicate into canonical ─────────────────────────────────────────────

/**
 * When a duplicate bundle arrives, fold its incident count into the canonical
 * tip and mark the duplicate as deduplicated. Neither tip is deleted — the
 * duplicate maintains a full audit trail record.
 */
export async function foldDuplicateIntoCanonical(
  duplicate: CyberTip,
  canonicalId: string,
  newIncidentCount: number
): Promise<void> {
  const canonical = await getTipById(canonicalId);
  if (!canonical) {
    console.warn(`[BUNDLE] Canonical tip ${canonicalId} not found during fold — skipping.`);
    return;
  }

  const previousCount = canonical.bundled_incident_count ?? 1;
  const updatedCount  = previousCount + (duplicate.bundled_incident_count ?? 1);

  // Update canonical tip incident count
  const updatedCanonical: CyberTip = {
    ...canonical,
    bundled_incident_count: updatedCount,
  };
  await upsertTip(updatedCanonical);

  // Mark duplicate as deduplicated
  const markedDuplicate: CyberTip = {
    ...duplicate,
    status: "duplicate",
    links: {
      ...duplicate.links,
      duplicate_of: canonicalId,
      confidence: 1.0,
      related_tip_ids: [],
      subject_ids: [],
      open_case_number: null,
      cluster_flags: [],
      deconfliction_matches: [],
    },
  };
  await upsertTip(markedDuplicate);

  // Audit both sides
  await appendAuditEntry({
    tip_id:    canonicalId,
    agent:     "BundleDedup",
    timestamp: new Date().toISOString(),
    status:    "success",
    summary:   `Bundle count updated: ${previousCount} → ${updatedCount} incidents. Folded tip ${duplicate.tip_id.slice(0, 8)}.`,
    new_value: { bundled_incident_count: updatedCount },
  });

  await appendAuditEntry({
    tip_id:    duplicate.tip_id,
    agent:     "BundleDedup",
    timestamp: new Date().toISOString(),
    status:    "success",
    summary:   `Deduplicated. Canonical tip: ${canonicalId.slice(0, 8)}. Incident count folded.`,
    new_value: { status: "duplicate", duplicate_of: canonicalId },
  });

  console.log(
    `[BUNDLE] Folded ${duplicate.tip_id.slice(0, 8)} into canonical ${canonicalId.slice(0, 8)}. ` +
    `New count: ${updatedCount}`
  );
}

// ── Pipeline gate function ────────────────────────────────────────────────────

/**
 * Drop-in pre-pipeline check. Returns true if the tip should be processed
 * normally, false if it was deduplicated and should be skipped.
 *
 * Usage (in queue worker / orchestrator):
 *   if (!await shouldProcessTip(tip)) return; // skip pipeline
 */
export async function shouldProcessTip(tip: CyberTip): Promise<boolean> {
  if (!tip.is_bundled) return true;

  const result = await checkBundleDuplicate(tip);
  if (!result.is_duplicate) return true;

  // Fold and skip
  await foldDuplicateIntoCanonical(tip, result.canonical_tip_id, result.canonical_count);
  return false;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface BundleStats {
  unique_bundles:    number;
  total_incidents:   number;
  largest_bundle:    { tip_id: string; count: number } | null;
  cache_size:        number;
}

export async function getBundleStats(): Promise<BundleStats> {
  const { tips } = await listTips({ is_bundled: true, limit: 10_000, exclude_body: true });
  const bundles  = tips.filter((t: CyberTip) => t.status !== "duplicate");

  let largest: { tip_id: string; count: number } | null = null;
  let totalIncidents = 0;

  for (const b of bundles) {
    const count = b.bundled_incident_count ?? 1;
    totalIncidents += count;
    if (!largest || count > largest.count) {
      largest = { tip_id: b.tip_id, count };
    }
  }

  return {
    unique_bundles:  bundles.length,
    total_incidents: totalIncidents,
    largest_bundle:  largest,
    cache_size:      fingerprintCache.size,
  };
}
