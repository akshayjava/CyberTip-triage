/**
 * Nightly Digest Job — FEAT-014
 *
 * Sends a shift-change summary email to supervisors every morning at 06:00.
 * Covers tips received in the last 12 hours so the overnight window is captured.
 *
 * Delivered via the existing alertSupervisor mechanism (email + console fallback).
 * No new dependencies — uses listTips, getTipStats, alertSupervisor.
 */

import { listTips, getTipStats } from "../db/tips.js";
import { alertSupervisor } from "../tools/alerts/alert_tools.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("DIGEST");

const WINDOW_HOURS = 12;

async function sendNightlyDigest(): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  log.info(`Generating shift-change digest for window since ${windowStart}`);

  try {
    // ── Fetch tips received in the last 12 hours ───────────────────────────────
    // Exclude body/files to keep memory usage low — we only need priority metadata.
    const { tips } = await listTips({
      since: windowStart,
      limit: 1000,
      exclude_body: true,
      exclude_files: true,
    });

    // ── Overall system stats (all-time totals for context) ────────────────────
    const stats = await getTipStats();

    if (tips.length === 0) {
      log.info("No tips received in the last 12 hours — skipping digest email.");
      return;
    }

    // ── Bucket overnight tips by tier ─────────────────────────────────────────
    const counts: Record<string, number> = {
      IMMEDIATE: 0,
      URGENT: 0,
      STANDARD: 0,
      MONITOR: 0,
      PAUSED: 0,
      pending: 0,
    };

    let crisisCount = 0;
    let clusterEscalationCount = 0;

    // Collect high-priority tip summaries for the detailed section.
    const immediateTips: Array<{ tip_id: string; score: number; category: string }> = [];
    const urgentTips:    Array<{ tip_id: string; score: number; category: string }> = [];

    for (const tip of tips) {
      const tier = (tip.priority?.tier ?? "pending") as keyof typeof counts;
      if (counts[tier] !== undefined) {
        counts[tier] = (counts[tier] ?? 0) + 1;
      } else {
        counts["pending"] = (counts["pending"] ?? 0) + 1;
      }

      if (tip.priority?.victim_crisis_alert === true) {
        crisisCount++;
      }

      // Proxy for cluster escalations: tip has cluster flags and is above MONITOR tier.
      const clusterFlags = (tip.links?.cluster_flags as unknown[]) ?? [];
      if (clusterFlags.length > 0 && tier !== "MONITOR" && tier !== "PAUSED") {
        clusterEscalationCount++;
      }

      // Collect IMMEDIATE tips for the detailed listing.
      if (tier === "IMMEDIATE") {
        immediateTips.push({
          tip_id:   tip.tip_id,
          score:    tip.priority?.score ?? 0,
          category: tip.classification?.primary_offense ?? "Unknown",
        });
      }

      // Collect URGENT tips for the detailed listing.
      if (tier === "URGENT") {
        urgentTips.push({
          tip_id:   tip.tip_id,
          score:    tip.priority?.score ?? 0,
          category: tip.classification?.primary_offense ?? "Unknown",
        });
      }
    }

    // ── Build plain-text email body ───────────────────────────────────────────
    const dateLabel = now.toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const windowLabel = `last ${WINDOW_HOURS} hours`;

    const lines: string[] = [
      `CyberTip Triage — Shift-Change Digest`,
      `${dateLabel} — generated at ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`,
      "=".repeat(52),
      "",
      `SHIFT ACTIVITY (${windowLabel})`,
      "-".repeat(36),
      `New tips received:     ${tips.length}`,
      `Crisis alerts:         ${crisisCount}`,
      `Cluster escalations:   ${clusterEscalationCount}`,
      "",
      "BREAKDOWN BY TIER (shift):",
      `  IMMEDIATE:  ${counts["IMMEDIATE"]}`,
      `  URGENT:     ${counts["URGENT"]}`,
      `  STANDARD:   ${counts["STANDARD"]}`,
      `  MONITOR:    ${counts["MONITOR"]}`,
      `  PAUSED:     ${counts["PAUSED"]}`,
    ];

    // Detailed IMMEDIATE tip listing
    if (immediateTips.length > 0) {
      lines.push("", "IMMEDIATE TIPS REQUIRING IMMEDIATE ATTENTION:", "-".repeat(44));
      for (const t of immediateTips) {
        lines.push(
          `  Tip ${t.tip_id.slice(0, 8)}  score=${t.score}/100  ${t.category}`
        );
      }
    }

    // Detailed URGENT tip listing
    if (urgentTips.length > 0) {
      lines.push("", "URGENT TIPS:", "-".repeat(12));
      for (const t of urgentTips) {
        lines.push(
          `  Tip ${t.tip_id.slice(0, 8)}  score=${t.score}/100  ${t.category}`
        );
      }
    }

    // System-wide totals for context
    lines.push(
      "",
      "SYSTEM-WIDE TOTALS (all time):",
      "-".repeat(31),
      `  Total tips:     ${stats.total}`,
      `  Crisis alerts:  ${stats.crisis_alerts}`,
      `  Blocked (Wilson): ${stats.blocked}`,
      `  IMMEDIATE:      ${stats.by_tier["IMMEDIATE"] ?? 0}`,
      `  URGENT:         ${stats.by_tier["URGENT"] ?? 0}`,
      `  STANDARD:       ${stats.by_tier["STANDARD"] ?? 0}`,
      `  MONITOR:        ${stats.by_tier["MONITOR"] ?? 0}`,
      `  PAUSED:         ${stats.by_tier["PAUSED"] ?? 0}`,
      "",
      "Log in to the dashboard to review all pending tips.",
    );

    const emailBody = lines.join("\n");

    // One-line summary used as the alertSupervisor "summary" argument.
    const briefSummary =
      `Shift-change digest: ${tips.length} new tips in the last ${WINDOW_HOURS}h — ` +
      `${counts["IMMEDIATE"]} IMMEDIATE, ${counts["URGENT"]} URGENT, ` +
      `${crisisCount} crisis alert(s), ${clusterEscalationCount} cluster escalation(s).`;

    // alertSupervisor routes through the same SMTP transport and console fallback
    // used by all supervisor alerts — no new sending code required.
    await alertSupervisor(
      "DIGEST",
      "SHIFT_CHANGE_DIGEST",
      0,
      "Review shift tip activity in the dashboard.",
      briefSummary + "\n\n" + emailBody,
    );

    log.info(
      `Digest sent — ${tips.length} tips, ${counts["IMMEDIATE"]} IMMEDIATE, ` +
      `${counts["URGENT"]} URGENT, ${crisisCount} crisis, ${clusterEscalationCount} escalations.`
    );

  } catch (err) {
    log.error("Failed to send shift-change digest:", err);
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let digestTimer: NodeJS.Timeout | null = null;

export function startDigestScheduler(): void {
  if (digestTimer) return;

  const scheduleNext = () => {
    const now  = new Date();
    const next1 = new Date(now);
    next1.setHours(6, 0, 0, 0); // 06:00 today
    const next2 = new Date(now);
    next2.setHours(18, 0, 0, 0); // 18:00 today

    let next = next1;
    if (now.getTime() >= next2.getTime()) {
      next = new Date(now);
      next.setDate(next.getDate() + 1);
      next.setHours(6, 0, 0, 0);
    } else if (now.getTime() >= next1.getTime()) {
      next = next2;
    }

    const ms = next.getTime() - now.getTime();
    log.info(
      `Next digest scheduled in ${Math.round(ms / 60_000)} minutes (${next.toISOString()})`
    );

    digestTimer = setTimeout(async () => {
      await sendNightlyDigest();
      scheduleNext(); // reschedule for the next shift change
    }, ms);
  };

  scheduleNext();
}
