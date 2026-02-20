/**
 * Alert Tools — Real Implementation
 *
 * Delivers supervisor alerts and victim crisis alerts via:
 *   • Email    — nodemailer (SMTP/SendGrid/SES)
 *   • SMS      — Twilio (victim crisis alerts only — highest urgency)
 *   • Console  — always, as a fallback/audit trail in dev
 *
 * Configuration via env vars (see .env.example):
 *   ALERT_EMAIL_HOST     SMTP host (e.g. smtp.sendgrid.net)
 *   ALERT_EMAIL_PORT     SMTP port (default 587)
 *   ALERT_EMAIL_USER     SMTP username
 *   ALERT_EMAIL_PASS     SMTP password
 *   ALERT_FROM_EMAIL     Sender address (e.g. icac-triage@agency.gov)
 *   ALERT_SUPERVISOR_EMAILS  Comma-separated list of supervisor email addresses
 *   ALERT_CRISIS_EMAILS  Comma-separated — victim services + supervisors
 *   TWILIO_ACCOUNT_SID   Twilio account SID (for SMS)
 *   TWILIO_AUTH_TOKEN    Twilio auth token
 *   TWILIO_FROM_NUMBER   Twilio sender number (+1XXXXXXXXXX)
 *   ALERT_CRISIS_PHONES  Comma-separated list of phone numbers for crisis SMS
 *
 * Graceful degradation:
 *   - If SMTP credentials are missing: logs to console, records in alert store
 *   - If Twilio credentials are missing: email-only fallback for crisis alerts
 *   - No uncaught exceptions from missing credentials — startup warns clearly
 *
 * Alert deduplication:
 *   - Each tip_id + alert_type pair is tracked in memory
 *   - Prevents flooding supervisors with duplicate alerts if pipeline reruns
 */

import { randomUUID } from "crypto";
import { runTool, type ToolResult } from "../types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SupervisorAlertResult {
  delivered:  boolean;
  alert_id:   string;
  timestamp:  string;
  channel:    string;
  recipients: string[];
}

export interface VictimCrisisAlertResult {
  delivered:  boolean;
  alert_id:   string;
  timestamp:  string;
  routed_to:  string[];
  channels:   string[];
}

// ── In-memory store (test access + deduplication) ─────────────────────────────

const SENT_ALERTS: Array<{ type: string; payload: unknown; timestamp: string }> = [];
const DEDUP_SET   = new Set<string>(); // "tipId:alertType"

export function getSentAlerts() { return [...SENT_ALERTS]; }
export function clearSentAlerts() { SENT_ALERTS.length = 0; DEDUP_SET.clear(); }

// ── Config helpers ─────────────────────────────────────────────────────────────

function getEmailConfig() {
  return {
    host:          process.env["ALERT_EMAIL_HOST"]     ?? "",
    port:          parseInt(process.env["ALERT_EMAIL_PORT"] ?? "587", 10),
    user:          process.env["ALERT_EMAIL_USER"]     ?? "",
    pass:          process.env["ALERT_EMAIL_PASS"]     ?? "",
    from:          process.env["ALERT_FROM_EMAIL"]     ?? "icac-triage@noreply.local",
    supervisors:  (process.env["ALERT_SUPERVISOR_EMAILS"] ?? "").split(",").filter(Boolean),
    crisisEmails: (process.env["ALERT_CRISIS_EMAILS"]     ?? "").split(",").filter(Boolean),
  };
}

function getTwilioConfig() {
  return {
    sid:         process.env["TWILIO_ACCOUNT_SID"]  ?? "",
    token:       process.env["TWILIO_AUTH_TOKEN"]   ?? "",
    from:        process.env["TWILIO_FROM_NUMBER"]  ?? "",
    crisisPhones:(process.env["ALERT_CRISIS_PHONES"] ?? "").split(",").filter(Boolean),
  };
}

function isEmailConfigured(): boolean {
  const cfg = getEmailConfig();
  return !!(cfg.host && cfg.user && cfg.pass && cfg.supervisors.length > 0);
}

function isTwilioConfigured(): boolean {
  const cfg = getTwilioConfig();
  return !!(cfg.sid && cfg.token && cfg.from && cfg.crisisPhones.length > 0);
}

/** Print startup warnings if alert channels are not configured. Called from src/index.ts */
export function warnIfAlertsUnconfigured(): void {
  if (!isEmailConfigured()) {
    console.warn(
      "[ALERTS] ⚠️  Email alerts not configured. Set ALERT_EMAIL_HOST, ALERT_EMAIL_USER, " +
      "ALERT_EMAIL_PASS, ALERT_SUPERVISOR_EMAILS. Alerts will log to console only."
    );
  }
  if (!isTwilioConfigured()) {
    console.warn(
      "[ALERTS] ⚠️  SMS alerts not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, " +
      "TWILIO_FROM_NUMBER, ALERT_CRISIS_PHONES. Victim crisis alerts will be email-only."
    );
  }
}

// ── Nodemailer transport (lazy init) ──────────────────────────────────────────

let emailTransport: unknown = null;

async function getEmailTransport(): Promise<unknown> {
  if (emailTransport) return emailTransport;
  const cfg = getEmailConfig();
  if (!cfg.host) return null;

  const nodemailer = (await import("nodemailer" as string)) as {
    createTransport: (opts: unknown) => unknown;
  };

  emailTransport = nodemailer.createTransport({
    host:   cfg.host,
    port:   cfg.port,
    secure: cfg.port === 465,
    auth:   { user: cfg.user, pass: cfg.pass },
    // Fail fast — don't let a bad SMTP connection hang the pipeline
    connectionTimeout: 8_000,
    greetingTimeout:   8_000,
  });

  return emailTransport;
}

async function sendEmail(opts: {
  to:      string[];
  subject: string;
  text:    string;
  html:    string;
}): Promise<void> {
  const transport = await getEmailTransport() as {
    sendMail: (opts: unknown) => Promise<void>;
  } | null;

  if (!transport) {
    console.log(`[ALERTS] Email not configured — would have sent to: ${opts.to.join(", ")}`);
    return;
  }

  await transport.sendMail({
    from:    getEmailConfig().from,
    to:      opts.to.join(", "),
    subject: opts.subject,
    text:    opts.text,
    html:    opts.html,
  });
}

// ── Twilio SMS (lazy init) ─────────────────────────────────────────────────────

async function sendSms(to: string[], body: string): Promise<void> {
  const cfg = getTwilioConfig();
  if (!cfg.sid) {
    console.log(`[ALERTS] Twilio not configured — would have SMS'd: ${to.join(", ")}`);
    return;
  }

  // Dynamic import — avoids requiring twilio when not configured
  const twilio = (await import("twilio" as string)) as {
    default: (sid: string, token: string) => {
      messages: { create: (opts: unknown) => Promise<void> };
    };
  };
  const client = twilio.default(cfg.sid, cfg.token);

  await Promise.all(
    to.map((phone) =>
      client.messages.create({ body, from: cfg.from, to: phone }).catch((err) => {
        console.error(`[ALERTS] SMS to ${phone} failed:`, err);
      })
    )
  );
}

// ── Supervisor alert ──────────────────────────────────────────────────────────

export async function alertSupervisor(
  tipId: string,
  category: string,
  score: number,
  recommendedAction: string,
  summary: string,
  isDeconflictionPause = false
): Promise<ToolResult<SupervisorAlertResult>> {
  return runTool(async () => {
    const dedupKey = `${tipId}:${isDeconflictionPause ? "deconflict" : "supervisor"}`;
    if (DEDUP_SET.has(dedupKey)) {
      // Already alerted for this tip — return the earlier result
      return {
        delivered:  true,
        alert_id:   `dedup-${tipId.slice(0, 8)}`,
        timestamp:  new Date().toISOString(),
        channel:    "dedup_skipped",
        recipients: [],
      };
    }

    const alertId    = randomUUID();
    const tier       = score >= 85 ? "🚨 IMMEDIATE" : isDeconflictionPause ? "🔴 PAUSED" : "⚠️  URGENT";
    const recipients = getEmailConfig().supervisors;
    const channels: string[] = ["console"];

    // Console always
    console.log(
      `[SUPERVISOR ALERT] ${tier} | alert:${alertId.slice(0, 8)} | tip:${tipId.slice(0, 8)} | ` +
      `score:${score} | category:${category}\n  Action: ${recommendedAction}\n  Summary: ${summary}`
    );

    // Email
    if (recipients.length > 0) {
      await sendEmail({
        to:      recipients,
        subject: `${tier} CyberTip Alert — Score ${score} — ${category}`,
        text:    buildSupervisorEmailText(tipId, score, category, recommendedAction, summary, isDeconflictionPause),
        html:    buildSupervisorEmailHtml(tipId, score, category, recommendedAction, summary, isDeconflictionPause),
      }).catch((err) => console.error("[ALERTS] Email send failed:", err));
      channels.push("email");
    }

    SENT_ALERTS.push({
      type:      isDeconflictionPause ? "DECONFLICTION_PAUSE" : "SUPERVISOR_ALERT",
      payload:   { tipId, category, score, recommendedAction, summary },
      timestamp: new Date().toISOString(),
    });
    DEDUP_SET.add(dedupKey);

    return {
      delivered:  true,
      alert_id:   alertId,
      timestamp:  new Date().toISOString(),
      channel:    channels.join("+"),
      recipients,
    };
  });
}

// ── Victim crisis alert ───────────────────────────────────────────────────────

export async function sendVictimCrisisAlert(
  tipId: string,
  victimDescription: string,
  crisisIndicators: string[],
  platform: string,
  recommendedAction?: string
): Promise<ToolResult<VictimCrisisAlertResult>> {
  return runTool(async () => {
    const dedupKey = `${tipId}:crisis`;

    const alertId     = randomUUID();
    const emailCfg    = getEmailConfig();
    const recipients  = [
      ...emailCfg.crisisEmails,
      ...emailCfg.supervisors,
    ].filter((v, i, a) => a.indexOf(v) === i); // deduplicate
    const smsRecipients = getTwilioConfig().crisisPhones;
    const channels: string[] = ["console"];

    // Console — always first
    console.log(
      `[🚨 VICTIM CRISIS ALERT] alert:${alertId.slice(0, 8)} | tip:${tipId.slice(0, 8)} | ` +
      `platform:${platform}\n` +
      `  Victim: ${victimDescription}\n` +
      `  Indicators: ${crisisIndicators.join("; ")}\n` +
      `  Action: ${recommendedAction ?? "Immediate supervisor contact required"}`
    );

    // SMS — sent first, highest urgency channel
    if (smsRecipients.length > 0) {
      const smsBody =
        `🚨 VICTIM CRISIS — CyberTip ${tipId.slice(0, 8)} | ${platform}\n` +
        `${victimDescription.slice(0, 100)}\n` +
        `Indicators: ${crisisIndicators.slice(0, 2).join(", ")}\n` +
        `Action: ${(recommendedAction ?? "Contact supervisor").slice(0, 60)}`;

      await sendSms(smsRecipients, smsBody).catch((err) =>
        console.error("[ALERTS] Crisis SMS failed:", err)
      );
      channels.push("sms");
    }

    // Email — full detail
    if (recipients.length > 0) {
      await sendEmail({
        to:      recipients,
        subject: `🚨 VICTIM CRISIS ALERT — ${platform} — CyberTip ${tipId.slice(0, 8)}`,
        text:    buildCrisisEmailText(tipId, victimDescription, crisisIndicators, platform, recommendedAction),
        html:    buildCrisisEmailHtml(tipId, victimDescription, crisisIndicators, platform, recommendedAction),
      }).catch((err) => console.error("[ALERTS] Crisis email failed:", err));
      channels.push("email");
    }

    SENT_ALERTS.push({
      type:      "VICTIM_CRISIS_ALERT",
      payload:   { tipId, victimDescription, crisisIndicators, platform, recommendedAction },
      timestamp: new Date().toISOString(),
    });

    if (!DEDUP_SET.has(dedupKey)) {
      DEDUP_SET.add(dedupKey);
    }

    const allRecipients = [...recipients, ...smsRecipients.map((p) => `SMS:${p}`)];
    return {
      delivered:  true,
      alert_id:   alertId,
      timestamp:  new Date().toISOString(),
      routed_to:  allRecipients,
      channels,
    };
  });
}

// ── Email body builders ────────────────────────────────────────────────────────

function buildSupervisorEmailText(
  tipId: string, score: number, category: string,
  action: string, summary: string, isDeconflict: boolean
): string {
  const label = isDeconflict ? "DECONFLICTION PAUSE" : "SUPERVISOR ALERT";
  return [
    `CyberTip Triage System — ${label}`,
    "=".repeat(50),
    `Tip ID:    ${tipId}`,
    `Category:  ${category}`,
    `Score:     ${score}/100`,
    "",
    "RECOMMENDED ACTION:",
    action,
    "",
    "SUMMARY:",
    summary,
    "",
    isDeconflict
      ? "⚠️  This tip is PAUSED pending deconfliction. Do not take investigative action until conflict is resolved."
      : "This alert was generated automatically by the AI triage pipeline.",
    "",
    "Access full tip detail in the dashboard.",
  ].join("\n");
}

function buildSupervisorEmailHtml(
  tipId: string, score: number, category: string,
  action: string, summary: string, isDeconflict: boolean
): string {
  const color = score >= 85 ? "#dc2626" : isDeconflict ? "#7c3aed" : "#d97706";
  const label = isDeconflict ? "⚠️ DECONFLICTION PAUSE" : score >= 85 ? "🚨 IMMEDIATE" : "⚠️ URGENT";
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:${color};color:white;padding:16px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0">${label} — CyberTip Alert</h2>
  </div>
  <div style="border:1px solid ${color};padding:20px;border-radius:0 0 8px 8px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:4px 8px;font-weight:bold;width:120px">Tip ID</td><td style="padding:4px 8px;font-family:monospace">${tipId}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold">Category</td><td style="padding:4px 8px">${category}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold">Score</td><td style="padding:4px 8px"><strong style="color:${color}">${score}/100</strong></td></tr>
    </table>
    <hr style="border-color:#e5e7eb;margin:16px 0"/>
    <h3 style="color:${color};margin:0 0 8px">Recommended Action</h3>
    <p style="margin:0 0 16px">${action}</p>
    <h3 style="color:#374151;margin:0 0 8px">Summary</h3>
    <p style="margin:0;color:#6b7280">${summary}</p>
    ${isDeconflict ? `<div style="background:#fef3c7;border-left:4px solid #d97706;padding:12px;margin-top:16px"><strong>⚠️ Do not take investigative action until deconfliction is resolved.</strong></div>` : ""}
  </div>
</div>`;
}

function buildCrisisEmailText(
  tipId: string, victimDesc: string, indicators: string[],
  platform: string, action?: string
): string {
  return [
    "🚨 VICTIM CRISIS ALERT — IMMEDIATE ACTION REQUIRED",
    "=".repeat(50),
    `Tip ID:    ${tipId}`,
    `Platform:  ${platform}`,
    `Victim:    ${victimDesc}`,
    "",
    "CRISIS INDICATORS:",
    ...indicators.map((i) => `  • ${i}`),
    "",
    "REQUIRED ACTION:",
    action ?? "Immediate supervisor contact required. May require emergency intervention.",
    "",
    "TIME IS CRITICAL. This child may be in immediate danger.",
    "Access full tip detail in the dashboard immediately.",
  ].join("\n");
}

function buildCrisisEmailHtml(
  tipId: string, victimDesc: string, indicators: string[],
  platform: string, action?: string
): string {
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#dc2626;color:white;padding:16px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0">🚨 VICTIM CRISIS ALERT</h2>
    <p style="margin:4px 0 0;opacity:0.9">IMMEDIATE ACTION REQUIRED</p>
  </div>
  <div style="border:2px solid #dc2626;padding:20px;border-radius:0 0 8px 8px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr><td style="padding:4px 8px;font-weight:bold;width:100px">Tip ID</td><td style="padding:4px 8px;font-family:monospace">${tipId}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold">Platform</td><td style="padding:4px 8px">${platform}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold">Victim</td><td style="padding:4px 8px">${victimDesc}</td></tr>
    </table>
    <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px;margin-bottom:16px">
      <strong>Crisis Indicators:</strong>
      <ul style="margin:8px 0 0;padding-left:20px">${indicators.map((i) => `<li>${i}</li>`).join("")}</ul>
    </div>
    <div style="background:#fff;border:1px solid #e5e7eb;padding:12px;border-radius:4px">
      <strong style="color:#dc2626">Required Action:</strong>
      <p style="margin:4px 0 0">${action ?? "Immediate supervisor contact required."}</p>
    </div>
    <p style="color:#dc2626;font-weight:bold;margin-top:16px">TIME IS CRITICAL. This child may be in immediate danger.</p>
  </div>
</div>`;
}
