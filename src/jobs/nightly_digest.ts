/**
 * Nightly Digest Job — P2 Feature
 *
 * Sends a summary email to supervisors every morning (e.g. 06:00).
 * Includes stats for tips received in the last 24 hours.
 */

import { listTips } from "../db/tips.js";
import { alertSupervisor } from "../tools/alerts/alert_tools.js";

async function sendNightlyDigest() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  console.log(`[DIGEST] Generating report since ${yesterday}...`);

  try {
    const { tips } = await listTips({ since: yesterday, limit: 1000 });

    if (tips.length === 0) {
      console.log("[DIGEST] No tips in last 24h. Skipping email.");
      return;
    }

    const counts = {
      IMMEDIATE: 0,
      URGENT: 0,
      STANDARD: 0,
      PAUSED: 0,
      MONITOR: 0,
      pending: 0,
      crisis: 0,
      escalated: 0
    };

    for (const tip of tips) {
      const tier = (tip.priority?.tier ?? "pending") as keyof typeof counts;
      if (counts[tier] !== undefined) counts[tier]++;

      if (tip.priority?.victim_crisis_alert) counts.crisis++;

      // Check for escalation (if we had an audit log query we could be precise,
      // here we proxy by checking if it has cluster flags and is STANDARD/URGENT)
      if ((tip.links?.cluster_flags as any[])?.length && tip.priority?.tier !== "MONITOR") {
        counts.escalated++;
      }
    }

    const summary =
      `Nightly Digest (${new Date().toLocaleDateString()}): ` +
      `${tips.length} total tips. ` +
      `Crisis: ${counts.crisis}. ` +
      `Breakdown: ${counts.IMMEDIATE} IMM, ${counts.URGENT} URG, ${counts.STANDARD} STD. ` +
      `Escalations: ${counts.escalated}.`;

    const body =
      `Tips received in last 24h: ${tips.length}\n` +
      `\n` +
      `Crisis Alerts: ${counts.crisis}\n` +
      `Immediate:     ${counts.IMMEDIATE}\n` +
      `Urgent:        ${counts.URGENT}\n` +
      `Paused:        ${counts.PAUSED}\n` +
      `Standard:      ${counts.STANDARD}\n` +
      `Monitor:       ${counts.MONITOR}\n` +
      `\n` +
      `Cluster Escalations: ${counts.escalated}\n` +
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
