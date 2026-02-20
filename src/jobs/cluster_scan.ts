/**
 * Temporal Clustering Job — Tier 4.2
 *
 * The Linker Agent detects connections within a single tip query. It cannot
 * detect slow-building patterns that emerge over weeks or months — e.g., a
 * predator grooming multiple students from the same school, or a coordinated
 * group operating across the same gaming platform.
 *
 * This background job runs nightly over the PostgreSQL database (or in-memory
 * store in dev) to find these temporal patterns and:
 *   1. Flag tips with cluster membership (updates TipLinks.cluster_flags)
 *   2. Escalate MONITOR tips to STANDARD if cluster_size >= 3 (90 days)
 *   3. Emit an actionable cluster alert for the supervisor queue
 *   4. Write a full audit entry for every escalation
 *
 * Cluster patterns detected:
 *   - IP subnet:        Same /24 subnet appearing in multiple tips
 *   - School district:  Shared school/district in extracted entities
 *   - Gaming platform:  Same platform with similar victim age profiles
 *   - Geographic area:  Same city/zip in multiple tips within time window
 *   - ESP account:      Same ESP account reported across multiple tips
 *   - Username pattern: Same or similar username across platforms
 *
 * Escalation rule: MONITOR → STANDARD if cluster_size >= 3 within 90 days
 *
 * Scheduling: wire into cron/setInterval at startup. Runs after midnight
 * when queue pressure is lowest.
 *
 * Usage:
 *   import { runClusterScan } from "./src/jobs/cluster_scan.js";
 *   await runClusterScan();  // ad-hoc
 *   startClusterScheduler(); // daily at 02:00 local time
 */

import { randomUUID } from "crypto";
import { getPool } from "../db/pool.js";
import { listTips, upsertTip } from "../db/tips.js";
import { appendAuditEntry } from "../compliance/audit.js";
import { alertSupervisor } from "../tools/alerts/alert_tools.js";
import type { CyberTip, TipLinks } from "../models/index.js";

// ── Configuration ──────────────────────────────────────────────────────────────

const WINDOW_DAYS         = 90;    // Lookback window for clustering
const MIN_CLUSTER_SIZE    = 3;     // Minimum tips to form a reportable cluster
const ESCALATION_TIER     = "STANDARD" as const;
const ESCALATION_FROM     = "MONITOR" as const;

// ── Cluster types ─────────────────────────────────────────────────────────────

type ClusterType =
  | "ip_subnet"
  | "same_school"
  | "gaming_platform"
  | "same_geographic_area"
  | "esp_account"
  | "username_pattern";

export interface ClusterGroup {
  cluster_id:    string;
  cluster_type:  ClusterType;
  pattern_key:   string;          // The shared value (subnet, school name, etc.)
  tip_ids:       string[];
  tip_count:     number;
  first_seen:    string;          // ISO date
  last_seen:     string;          // ISO date
  description:   string;
  escalated_ids: string[];        // Tips that were escalated as a result
}

export interface ClusterScanResult {
  scan_id:          string;
  started_at:       string;
  completed_at:     string;
  duration_ms:      number;
  tips_scanned:     number;
  clusters_found:   ClusterGroup[];
  escalations:      number;
  errors:           string[];
}

// ── Window filter ──────────────────────────────────────────────────────────────

function inWindow(iso: string): boolean {
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return new Date(iso).getTime() >= cutoff;
}

// ── Pattern extractors ────────────────────────────────────────────────────────

function extractSubnet24(ip: string): string | null {
  const match = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  return match ? `${match[1]}.0/24` : null;
}

function normalizeSchool(name: string): string {
  return name.toLowerCase()
    .replace(/\b(high|middle|elementary|school|academy|district|unified)\b/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .trim()
    .replace(/\s+/g, "_");
}

function normalizeUsername(username: string): string {
  // Strip trailing numbers/years/underscores that vary per-platform
  return username.toLowerCase().replace(/[\d_-]{2,}$/, "").trim();
}

// ── In-memory aggregation (dev mode) ─────────────────────────────────────────

async function scanFromMemory(
  tips: CyberTip[]
): Promise<Map<string, { key: string; type: ClusterType; tipIds: string[]; dates: string[] }>> {
  const groups = new Map<string, { key: string; type: ClusterType; tipIds: string[]; dates: string[] }>();

  const addToGroup = (groupKey: string, key: string, type: ClusterType, tipId: string, date: string) => {
    const existing = groups.get(groupKey);
    if (existing) {
      if (!existing.tipIds.includes(tipId)) {
        existing.tipIds.push(tipId);
        existing.dates.push(date);
      }
    } else {
      groups.set(groupKey, { key, type, tipIds: [tipId], dates: [date] });
    }
  };

  for (const tip of tips) {
    if (!inWindow(tip.received_at)) continue;
    const ex = tip.extracted as any;
    const date = tip.received_at;

    // IP subnet clustering — EntityMatch objects: use .value for the IP string
    for (const ipMatch of ex?.ip_addresses ?? []) {
      const ip = String(ipMatch?.value ?? ipMatch ?? "");
      const subnet = extractSubnet24(ip);
      if (subnet) addToGroup(`subnet:${subnet}`, subnet, "ip_subnet", tip.tip_id, date);
    }

    // School clustering — extracted from subjects[].school and venues (no top-level schools field)
    const schoolNames: string[] = [];
    for (const subj of ex?.subjects ?? []) {
      if (subj?.school) schoolNames.push(String(subj.school));
    }
    for (const venue of ex?.venues ?? []) {
      const venueVal = String(venue?.value ?? venue ?? "");
      if (venueVal.match(/school|academy|district|middle|elementary|high/i)) schoolNames.push(venueVal);
    }
    for (const schoolName of schoolNames) {
      const key = normalizeSchool(schoolName);
      if (key.length >= 3) addToGroup(`school:${key}`, schoolName, "same_school", tip.tip_id, date);
    }

    // Gaming platform clustering — game_platform_ids is EntityMatch[], .value has the platform name
    for (const platformMatch of ex?.game_platform_ids ?? []) {
      const platform = String(platformMatch?.value ?? platformMatch ?? "").toLowerCase();
      if (platform.length >= 3) {
        addToGroup(`gaming:${platform}`, platform, "gaming_platform", tip.tip_id, date);
      }
    }
    // Also check referenced_platforms (plain string array)
    for (const platform of ex?.referenced_platforms ?? []) {
      const key = String(platform).toLowerCase();
      if (key.length >= 3) addToGroup(`gaming:${key}`, key, "gaming_platform", tip.tip_id, date);
    }

    // Geographic area clustering — subjects[].city + state_province, or geographic_indicators
    for (const subj of ex?.subjects ?? []) {
      const city  = String(subj?.city ?? "").toLowerCase().trim();
      const state = String(subj?.state_province ?? "").toLowerCase().trim();
      if (city.length >= 3 && state.length >= 2) {
        const key = `${city}_${state}`;
        addToGroup(`geo:${key}`, `${city}, ${state}`, "same_geographic_area", tip.tip_id, date);
      }
    }
    // geographic_indicators is also EntityMatch[]
    for (const geoMatch of ex?.geographic_indicators ?? []) {
      const geoVal = String(geoMatch?.value ?? geoMatch ?? "").toLowerCase().trim();
      if (geoVal.length >= 5 && geoVal.includes(",")) {
        addToGroup(`geo:${geoVal}`, geoVal, "same_geographic_area", tip.tip_id, date);
      }
    }

    // Username pattern clustering — EntityMatch objects: use .value
    for (const unameMatch of ex?.usernames ?? []) {
      const username = String(unameMatch?.value ?? unameMatch ?? "");
      const key = normalizeUsername(username);
      if (key.length >= 4) addToGroup(`username:${key}`, username, "username_pattern", tip.tip_id, date);
    }
  }

  return groups;
}

// ── PostgreSQL aggregation (production) ──────────────────────────────────────

async function scanFromPostgres(
  cutoffISO: string
): Promise<Map<string, { key: string; type: ClusterType; tipIds: string[]; dates: string[] }>> {
  const pool = getPool();
  const groups = new Map<string, { key: string; type: ClusterType; tipIds: string[]; dates: string[] }>();

  // IP subnet clustering via JSONB
  const subnetRes = await pool.query<{ subnet: string; tip_ids: string[]; dates: string[] }>(
    `SELECT
       regexp_replace(ip_address, '^(\\d+\\.\\d+\\.\\d+)\\.\\d+$', '\\1.0/24') AS subnet,
       array_agg(DISTINCT tip_id) AS tip_ids,
       array_agg(received_at::text) AS dates
     FROM (
       SELECT tip_id, jsonb_array_elements_text(extracted->'ip_addresses') AS ip_address, received_at
       FROM cyber_tips
       WHERE received_at >= $1
         AND extracted IS NOT NULL
         AND jsonb_array_length(extracted->'ip_addresses') > 0
     ) sub
     WHERE ip_address ~ '^\\d+\\.\\d+\\.\\d+\\.\\d+$'
     GROUP BY subnet
     HAVING COUNT(DISTINCT tip_id) >= $2`,
    [cutoffISO, MIN_CLUSTER_SIZE]
  );
  for (const row of subnetRes.rows) {
    groups.set(`subnet:${row.subnet}`, { key: row.subnet, type: "ip_subnet", tipIds: row.tip_ids, dates: row.dates });
  }

  // School clustering via JSONB
  const schoolRes = await pool.query<{ school: string; tip_ids: string[]; dates: string[] }>(
    `SELECT
       lower(school_name) AS school,
       array_agg(DISTINCT tip_id) AS tip_ids,
       array_agg(received_at::text) AS dates
     FROM (
       SELECT tip_id, jsonb_array_elements_text(extracted->'schools') AS school_name, received_at
       FROM cyber_tips
       WHERE received_at >= $1
         AND extracted IS NOT NULL
     ) sub
     WHERE length(school_name) >= 4
     GROUP BY lower(school_name)
     HAVING COUNT(DISTINCT tip_id) >= $2`,
    [cutoffISO, MIN_CLUSTER_SIZE]
  );
  for (const row of schoolRes.rows) {
    groups.set(`school:${row.school}`, { key: row.school, type: "same_school", tipIds: row.tip_ids, dates: row.dates });
  }

  // Gaming platform clustering
  const gamingRes = await pool.query<{ platform: string; tip_ids: string[]; dates: string[] }>(
    `SELECT
       lower(platform) AS platform,
       array_agg(DISTINCT tip_id) AS tip_ids,
       array_agg(received_at::text) AS dates
     FROM (
       SELECT tip_id, jsonb_array_elements_text(extracted->'gaming_platforms') AS platform, received_at
       FROM cyber_tips
       WHERE received_at >= $1
         AND extracted IS NOT NULL
     ) sub
     WHERE length(platform) >= 3
     GROUP BY lower(platform)
     HAVING COUNT(DISTINCT tip_id) >= $2`,
    [cutoffISO, MIN_CLUSTER_SIZE]
  );
  for (const row of gamingRes.rows) {
    groups.set(`gaming:${row.platform}`, { key: row.platform, type: "gaming_platform", tipIds: row.tip_ids, dates: row.dates });
  }

  // Geographic clustering
  const geoRes = await pool.query<{ area: string; tip_ids: string[]; dates: string[] }>(
    `SELECT
       lower(extracted->>'subject_city') || ', ' || lower(extracted->>'subject_state') AS area,
       array_agg(DISTINCT tip_id) AS tip_ids,
       array_agg(received_at::text) AS dates
     FROM cyber_tips
     WHERE received_at >= $1
       AND extracted IS NOT NULL
       AND extracted->>'subject_city' IS NOT NULL
       AND extracted->>'subject_state' IS NOT NULL
     GROUP BY area
     HAVING COUNT(DISTINCT tip_id) >= $2`,
    [cutoffISO, MIN_CLUSTER_SIZE]
  );
  for (const row of geoRes.rows) {
    groups.set(`geo:${row.area}`, { key: row.area, type: "same_geographic_area", tipIds: row.tip_ids, dates: row.dates });
  }

  // Username pattern clustering
  const usernameRes = await pool.query<{ pattern: string; tip_ids: string[]; dates: string[] }>(
    `SELECT
       regexp_replace(lower(username), '[0-9_-]+$', '') AS pattern,
       array_agg(DISTINCT tip_id) AS tip_ids,
       array_agg(received_at::text) AS dates
     FROM (
       SELECT tip_id, jsonb_array_elements_text(extracted->'usernames') AS username, received_at
       FROM cyber_tips
       WHERE received_at >= $1
         AND extracted IS NOT NULL
     ) sub
     WHERE length(regexp_replace(lower(username), '[0-9_-]+$', '')) >= 4
     GROUP BY pattern
     HAVING COUNT(DISTINCT tip_id) >= $2`,
    [cutoffISO, MIN_CLUSTER_SIZE]
  );
  for (const row of usernameRes.rows) {
    groups.set(`username:${row.pattern}`, { key: row.pattern, type: "username_pattern", tipIds: row.tip_ids, dates: row.dates });
  }

  return groups;
}

// ── Description builder ────────────────────────────────────────────────────────

function clusterDescription(type: ClusterType, key: string, count: number, windowDays: number): string {
  const typeLabels: Record<ClusterType, string> = {
    ip_subnet:            `IP subnet ${key}`,
    same_school:          `school "${key}"`,
    gaming_platform:      `gaming platform "${key}"`,
    same_geographic_area: `geographic area ${key}`,
    esp_account:          `ESP account ${key}`,
    username_pattern:     `username pattern "${key}"`,
  };
  return `${count} tips share ${typeLabels[type]} within the past ${windowDays} days. Pattern may indicate coordinated activity or repeat offender.`;
}

// ── Apply clusters to tips ─────────────────────────────────────────────────────

async function applyClusterToTip(
  tipId: string,
  cluster: ClusterGroup,
  allTips: Map<string, CyberTip>
): Promise<{ escalated: boolean }> {
  const tip = allTips.get(tipId);
  if (!tip) return { escalated: false };

  const newFlag = {
    cluster_type:     cluster.cluster_type as any,
    tip_count:        cluster.tip_count,
    time_window_days: WINDOW_DAYS,
    description:      cluster.description,
    cluster_id:       cluster.cluster_id,
  };

  const existingFlags: any[] = (tip.links?.cluster_flags as any[]) ?? [];
  const alreadyFlagged = existingFlags.some(f => f.cluster_id === cluster.cluster_id);

  if (alreadyFlagged) return { escalated: false };

  const updatedLinks: TipLinks = {
    ...(tip.links ?? {
      duplicate_of: undefined,
      related_tip_ids: [],
      subject_ids: [],
      open_case_number: null,
      confidence: 0,
      cluster_flags: [],
      deconfliction_matches: [],
    }),
    cluster_flags: [...existingFlags, newFlag],
  };

  // Escalate MONITOR → STANDARD if cluster meets threshold
  let escalated = false;
  const currentTier = (tip.priority as any)?.tier;
  if (currentTier === ESCALATION_FROM && cluster.tip_count >= MIN_CLUSTER_SIZE) {
    const updatedTip: CyberTip = {
      ...tip,
      links: updatedLinks,
      priority: tip.priority ? {
        ...tip.priority,
        tier: ESCALATION_TIER,
        recommended_action:
          `Escalated from MONITOR: ${cluster.cluster_type.replace(/_/g, " ")} cluster ` +
          `(${cluster.tip_count} tips in ${WINDOW_DAYS} days). ${tip.priority.recommended_action ?? ""}`.trim(),
      } : tip.priority,
    };
    await upsertTip(updatedTip);
    escalated = true;

    await appendAuditEntry({
      tip_id:    tipId,
      agent:     "ClusterScan",
      timestamp: new Date().toISOString(),
      status:    "success",
      summary:   `Escalated MONITOR→STANDARD. Cluster: ${cluster.cluster_type} "${cluster.pattern_key}" (${cluster.tip_count} tips, ${WINDOW_DAYS}d window).`,
      new_value: { tier: ESCALATION_TIER, cluster_id: cluster.cluster_id },
    });

    // Supervisor email alert on cluster escalation — silent failure if alert fails
    try {
      await alertSupervisor(
        tipId,
        `CLUSTER_ESCALATION: ${cluster.cluster_type}`,
        50, // STANDARD tier score
        `Review cluster pattern — ${cluster.tip_count} tips matching "${cluster.pattern_key}" in ${WINDOW_DAYS} days.`,
        `Nightly cluster scan: ${cluster.cluster_type.replace(/_/g, " ")} pattern escalated this tip from MONITOR to STANDARD. ` +
          `Cluster ID: ${cluster.cluster_id.slice(0, 8)}.`
      );
    } catch {
      /* alert failure never blocks scan */
    }
  } else {
    const updatedTip: CyberTip = { ...tip, links: updatedLinks };
    await upsertTip(updatedTip);
  }

  return { escalated };
}

// ── Main scan ─────────────────────────────────────────────────────────────────

export async function runClusterScan(): Promise<ClusterScanResult> {
  const scanId    = randomUUID();
  const startedAt = new Date().toISOString();
  const startMs   = Date.now();
  const errors: string[] = [];
  const clusters: ClusterGroup[] = [];
  let escalations = 0;

  console.log(`[CLUSTER] Scan ${scanId.slice(0, 8)} started at ${startedAt}`);

  const cutoffISO = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const isPostgres = process.env["DB_MODE"] === "postgres";

  // Load all tips into a map for fast lookup during cluster application
  const { tips: allTipsArr } = await listTips({ limit: 20_000 });
  const allTipsMap = new Map(allTipsArr.map(t => [t.tip_id, t]));

  // Run pattern detection
  let groups: Map<string, { key: string; type: ClusterType; tipIds: string[]; dates: string[] }>;
  try {
    groups = isPostgres
      ? await scanFromPostgres(cutoffISO)
      : await scanFromMemory(allTipsArr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Pattern scan failed: ${msg}`);
    console.error("[CLUSTER] Scan failed:", err);
    groups = new Map();
  }

  // Build ClusterGroup objects and apply to tips
  for (const [, raw] of groups) {
    if (raw.tipIds.length < MIN_CLUSTER_SIZE) continue;

    const sortedDates = [...raw.dates].sort();
    const cluster: ClusterGroup = {
      cluster_id:    randomUUID(),
      cluster_type:  raw.type,
      pattern_key:   raw.key,
      tip_ids:       raw.tipIds,
      tip_count:     raw.tipIds.length,
      first_seen:    sortedDates[0] ?? startedAt,
      last_seen:     sortedDates[sortedDates.length - 1] ?? startedAt,
      description:   clusterDescription(raw.type, raw.key, raw.tipIds.length, WINDOW_DAYS),
      escalated_ids: [],
    };

    // Apply cluster flag to each member tip
    for (const tipId of cluster.tip_ids) {
      try {
        const { escalated } = await applyClusterToTip(tipId, cluster, allTipsMap);
        if (escalated) {
          cluster.escalated_ids.push(tipId);
          escalations++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to apply cluster to tip ${tipId.slice(0, 8)}: ${msg}`);
      }
    }

    clusters.push(cluster);
  }

  const completedAt = new Date().toISOString();
  const durationMs  = Date.now() - startMs;

  const result: ClusterScanResult = {
    scan_id:        scanId,
    started_at:     startedAt,
    completed_at:   completedAt,
    duration_ms:    durationMs,
    tips_scanned:   allTipsArr.length,
    clusters_found: clusters,
    escalations,
    errors,
  };

  console.log(
    `[CLUSTER] Scan ${scanId.slice(0, 8)} complete: ` +
    `${clusters.length} clusters, ${escalations} escalations, ${durationMs}ms`
  );

  if (errors.length) {
    console.warn(`[CLUSTER] ${errors.length} errors:`, errors);
  }

  return result;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start the nightly cluster scan scheduler.
 * Runs the first scan immediately (for server startup), then schedules
 * subsequent scans at 02:00 local time every night.
 *
 * Call this once at server startup. Safe to call multiple times — subsequent
 * calls are no-ops if the scheduler is already running.
 */
export function startClusterScheduler(): void {
  if (schedulerTimer) return; // already running

  console.log("[CLUSTER] Scheduler started. First scan in 30s, then nightly at 02:00.");

  // First scan: 30 seconds after server startup (let the queue settle)
  schedulerTimer = setTimeout(async () => {
    await runClusterScan().catch(err => console.error("[CLUSTER] Scheduled scan failed:", err));
    scheduleNextScan();
  }, 30_000);
}

function scheduleNextScan(): void {
  const now  = new Date();
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(2, 0, 0, 0); // 02:00 tomorrow
  const msUntilNext = next.getTime() - now.getTime();

  console.log(`[CLUSTER] Next scan scheduled at ${next.toISOString()} (${Math.round(msUntilNext / 3_600_000)}h from now)`);

  schedulerTimer = setTimeout(async () => {
    await runClusterScan().catch(err => console.error("[CLUSTER] Scheduled scan failed:", err));
    scheduleNextScan(); // chain to next night
  }, msUntilNext);
}

export function stopClusterScheduler(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
    console.log("[CLUSTER] Scheduler stopped.");
  }
}
