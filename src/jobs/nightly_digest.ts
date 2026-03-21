/**
 * Nightly Digest Job — P2 Feature
 *
 * Sends a summary email to supervisors every morning (e.g. 06:00).
 * Includes stats for tips received in the last 24 hours.
 */

import { getNightlyDigestStats } from "../db/tips.js";
import { alertSupervisor } from "../tools/alerts/alert_tools.js";

async function sendNightlyDigest() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  console.log(`[DIGEST] Generating report since ${yesterday}...`);

  try {
    // ⚡ Bolt Optimization: Use a targeted DB aggregate query instead of fetching all full tips into memory
    const stats = await getNightlyDigestStats(yesterday);

    if (stats.total === 0) {
      console.log("[DIGEST] No tips in last 24h. Skipping email.");
      return;
    }

    const summary =
      `Nightly Digest (${new Date().toLocaleDateString()}): ` +
      `${stats.total} total tips. ` +
      `Crisis: ${stats.crisis}. ` +
      `Breakdown: ${stats.by_tier.IMMEDIATE} IMM, ${stats.by_tier.URGENT} URG, ${stats.by_tier.STANDARD} STD. ` +
      `Escalations: ${stats.escalated}.`;

    const body =
      `Tips received in last 24h: ${stats.total}\n` +
      `\n` +
      `Crisis Alerts: ${stats.crisis}\n` +
      `Immediate:     ${stats.by_tier.IMMEDIATE}\n` +
      `Urgent:        ${stats.by_tier.URGENT}\n` +
      `Paused:        ${stats.by_tier.PAUSED}\n` +
      `Standard:      ${stats.by_tier.STANDARD}\n` +
      `Monitor:       ${stats.by_tier.MONITOR}\n` +
      `\n` +
      `Cluster Escalations: ${stats.escalated}\n` +
      `\n` +
      `Log in to dashboard for details.`;

    await alertSupervisor(
      "DIGEST",
      "NIGHTLY_DIGEST",
      0,
      "Review overnight activity.",
      summary + "\n\n" + body
    );

    console.log("[DIGEST] Sent successfully.");

  } catch (err) {
    console.error("[DIGEST] Failed:", err);
  }
}

let digestTimer: NodeJS.Timeout | null = null;

export function startDigestScheduler() {
  if (digestTimer) return;

  // Schedule for 06:00 local time
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setDate(now.getDate() + 1); // Tomorrow
    next.setHours(6, 0, 0, 0); // 06:00

    // If it's before 06:00 today, run today
    if (now.getHours() < 6) {
      next.setDate(now.getDate());
    }

    const ms = next.getTime() - now.getTime();
    console.log(`[DIGEST] Next digest scheduled in ${Math.round(ms / 60000)} minutes (${next.toISOString()})`);

    digestTimer = setTimeout(async () => {
      await sendNightlyDigest();
      scheduleNext();
    }, ms);
  };

  scheduleNext();
}
