/**
 * Nightly Digest Job — FEAT-014
 *
 * Sends a shift-change summary email to supervisors every morning at 06:00.
 * Covers tips received in the last 12 hours so the overnight window is captured.
 *
 * Delivered via the existing alertSupervisor mechanism (email + console fallback).
 * No new dependencies — uses listTips, getTipStats, alertSupervisor.
 */

import { listTips, getTipStats, getNightlyDigestStats } from "../db/tips.js";
import { alertSupervisor } from "../tools/alerts/alert_tools.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("DIGEST");

const WINDOW_HOURS = 12;

async function sendNightlyDigest(): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  log.info(`Generating shift-change digest for window since ${windowStart}`);

  try {
    // ⚡ Bolt Optimization: Use getNightlyDigestStats to push counts and categorizations
    // down to the database instead of fetching 1000 full tip records into Node.js memory.
    const digestStats = await getNightlyDigestStats(windowStart);

    // ── Overall system stats (all-time totals for context) ────────────────────
    const stats = await getTipStats();

    if (digestStats.total === 0) {
      log.info("No tips received in the last 12 hours — skipping digest email.");
      return;
    }

    // ── Fetch detailed tips for the email ─────────────────────────────────────
    // Only fetch the high-priority tips needed for the detailed list, instead of all tips.
    // ⚡ Bolt Optimization: Fetch IMMEDIATE and URGENT tips concurrently to reduce sequential I/O latency.
    const [{ tips: immediateList }, { tips: urgentList }] = await Promise.all([
      listTips({
        since: windowStart,
        tier: "IMMEDIATE",
        limit: 50,
        exclude_body: true,
        exclude_files: true,
      }),
      listTips({
        since: windowStart,
        tier: "URGENT",
        limit: 50,
        exclude_body: true,
        exclude_files: true,
      })
    ]);

    // Collect high-priority tip summaries for the detailed section.
    const immediateTips = immediateList.map(tip => ({
      tip_id:   tip.tip_id,
      score:    tip.priority?.score ?? 0,
      category: tip.classification?.primary_offense ?? "Unknown",
    }));

    const urgentTips = urgentList.map(tip => ({
      tip_id:   tip.tip_id,
      score:    tip.priority?.score ?? 0,
      category: tip.classification?.primary_offense ?? "Unknown",
    }));

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
      `New tips received:     ${digestStats.total}`,
      `Crisis alerts:         ${digestStats.crisis}`,
      `Cluster escalations:   ${digestStats.escalated}`,
      "",
      "BREAKDOWN BY TIER (shift):",
      `  IMMEDIATE:  ${digestStats.by_tier["IMMEDIATE"]}`,
      `  URGENT:     ${digestStats.by_tier["URGENT"]}`,
      `  STANDARD:   ${digestStats.by_tier["STANDARD"]}`,
      `  MONITOR:    ${digestStats.by_tier["MONITOR"]}`,
      `  PAUSED:     ${digestStats.by_tier["PAUSED"]}`,
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
      `Shift-change digest: ${digestStats.total} new tips in the last ${WINDOW_HOURS}h — ` +
      `${digestStats.by_tier["IMMEDIATE"]} IMMEDIATE, ${digestStats.by_tier["URGENT"]} URGENT, ` +
      `${digestStats.crisis} crisis alert(s), ${digestStats.escalated} cluster escalation(s).`;

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
      `Digest sent — ${digestStats.total} tips, ${digestStats.by_tier["IMMEDIATE"]} IMMEDIATE, ` +
      `${digestStats.by_tier["URGENT"]} URGENT, ${digestStats.crisis} crisis, ${digestStats.escalated} escalations.`
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
