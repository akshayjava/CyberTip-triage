/**
 * ESP Data Retention Windows
 *
 * Updated for the REPORT Act (Pub. L. 118-58, signed May 7, 2024):
 *   18 U.S.C. § 2258A now requires ESPs to preserve CyberTip report contents
 *   for a MINIMUM of ONE YEAR (365 days), up from 90 days.
 *   ESPs may voluntarily retain longer to combat OSEAC.
 *
 * These windows represent the PLATFORM DATA retention estimate —
 * i.e., how long account/message data exists before the ESP deletes it
 * under their own policies. This is separate from, but informed by, the
 * REPORT Act's 1-year preservation mandate for the tip report itself.
 *
 * REPORT Act compliance note: For tips received after May 7, 2024, all
 * ESPs subject to 18 U.S.C. § 2258A are legally required to preserve the
 * report contents for at least 365 days. Issue 2703(f) letters immediately
 * regardless of these windows to lock underlying account data.
 *
 * WARNING: Actual retention varies. Issue preservation request immediately —
 * 18 U.S.C. § 2703(f) requests are free and take effect immediately.
 * Verified against platform transparency reports as of Q1 2025.
 */

export const REPORT_ACT_MIN_DAYS = 365; // 18 U.S.C. § 2258A(h) as amended

export const ESP_RETENTION_WINDOWS: Record<string, number> = {
  // Meta properties — REPORT Act-compliant (365d minimum for tip content)
  // Platform account/message data may delete sooner; tip report content is 365d
  "Meta/Facebook": 365,
  "Meta/Instagram": 365,
  "Meta/WhatsApp": 365, // E2EE limits message content; metadata preserved 365d
  Facebook: 365,
  Instagram: 365,
  WhatsApp: 365,

  // Google — generally long retention; 365d for REPORT Act tips
  "Google/Gmail": 365,
  "Google/YouTube": 365,
  "Google/Drive": 365,
  "Google/Photos": 365,
  Gmail: 365,
  YouTube: 365,

  // Microsoft
  "Microsoft/Teams": 365,
  "Microsoft/OneDrive": 365,
  "Microsoft/Outlook": 365,
  Teams: 365,

  // Apple
  "Apple/iCloud": 365,
  iCloud: 365,

  // Platforms with historically SHORT platform-data retention
  // REPORT Act applies to the tip report (365d) but underlying data may delete sooner
  // Issue 2703(f) immediately for these
  "X/Twitter": 90,   // Account data: ~30-90d; tip report: 365d. URGENT
  Twitter: 90,
  Snapchat: 90,      // Chat content deletes quickly; account metadata 365d
  Telegram: 30,      // Limited US cooperation; account data minimal. CRITICAL URGENCY
  Signal: 0,         // No server-side metadata; no practical retention
  Kik: 90,

  // Other major platforms — REPORT Act applies
  Discord: 365,
  TikTok: 365,
  Reddit: 365,
  Twitch: 365,
  LinkedIn: 365,
  Pinterest: 365,
  BeReal: 180,       // Smaller platform; estimate
  Yubo: 180,         // Teen platform; estimate

  // Gaming platforms — important grooming vectors
  Steam: 365,
  Xbox: 365,
  PlayStation: 365,
  "Nintendo/Switch": 180, // Limited account data retention
  Roblox: 365,
  Fortnite: 365,
  Minecraft: 365,

  // Fallback — use REPORT Act minimum as conservative default for REPORT Act tips
  // For pre-May 2024 tips, prior 90-day window applied; use 365d going forward
  default: 365,
};

/**
 * Get the estimated data retention window in days for an ESP.
 * Returns the default (90 days) if the ESP is not in the known list.
 */
export function getRetentionDays(espName: string): number {
  // Try exact match first
  if (espName in ESP_RETENTION_WINDOWS) {
    return ESP_RETENTION_WINDOWS[espName] as number;
  }

  // Try case-insensitive partial match
  const lower = espName.toLowerCase();
  for (const [key, days] of Object.entries(ESP_RETENTION_WINDOWS)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      return days;
    }
  }

  return ESP_RETENTION_WINDOWS["default"] as number;
}

/**
 * Compute the estimated date when ESP data will expire.
 * Returns ISO date string (YYYY-MM-DD).
 */
export function getRetentionDeadline(espName: string, receivedAt: string): string {
  const days = getRetentionDays(espName);
  const deadline = new Date(receivedAt);
  deadline.setDate(deadline.getDate() + days);
  return deadline.toISOString().split("T")[0] as string;
}

/**
 * Compute days remaining until ESP data expires.
 * Negative value means data has already expired.
 */
export function getDaysUntilExpiry(deadline: string): number {
  const now = new Date();
  const exp = new Date(deadline);
  return Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Returns true if preservation should be flagged as urgent.
 * Threshold: 14 days or fewer remaining.
 */
export function isPreservationUrgent(deadline: string): boolean {
  return getDaysUntilExpiry(deadline) <= 14;
}
