/**
 * Script Generator
 *
 * Uses Claude to generate a structured, timed demo script as JSON.
 * The script drives both Playwright (screen actions) and TTS (narration).
 *
 * Output: scripts/generated_<timestamp>.json
 */

import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { DemoScript, ScriptCue } from "./types.js";

// ── System prompt ─────────────────────────────────────────────────────────────

const SCRIPT_SYSTEM_PROMPT = `You are a product demo scriptwriter for law enforcement software.

You create concise, compelling 90-second demo scripts for CyberTip Triage — an AI-powered 
triage system for ICAC (Internet Crimes Against Children) task forces.

The script must be structured as a JSON object with timestamped cues that drive both
screen recording (Playwright actions) and text-to-speech narration simultaneously.

AUDIENCE: ICAC investigators and supervisors evaluating whether to adopt this tool.
Their biggest pain points: tip volume overwhelm, legal compliance risk, manual prioritization.

TONE: Professional, authoritative, understated. No hype. Let the product speak.
LE audiences distrust salesiness — lead with problems they recognize.

PRODUCT FEATURES TO COVER:
1. Dashboard showing incoming tips with tier priority (IMMEDIATE, URGENT, PAUSED, STANDARD, MONITOR)
2. Wilson compliance: automatic file blocking when ESP didn't view files (Fourth Amendment)
3. AI priority scoring with victim crisis detection
4. Warrant workflow — apply, track, auto-unblock on grant
5. Bundle deduplication — viral incidents collapse to one tip
6. Circuit-specific legal guidance per tip

CSS SELECTORS AVAILABLE IN THE APP:
- .tip-row               — a row in the tip queue
- .tip-row:first-child   — first tip in queue
- .tier-badge            — priority tier badge (P1_CRITICAL etc)
- .file-blocked          — a file blocked by Wilson compliance
- .warrant-btn           — apply for warrant button
- .legal-note            — the legal analysis text
- .cluster-alert         — cluster detection banner
- .stats-card            — dashboard stats cards
- #tier-filter-IMMEDIATE  — filter button for immediate tier
- .tip-detail-pane       — the right-hand detail panel

NAVIGATION URLs (base: http://localhost:3000):
- /dashboard             — main investigator dashboard
- /dashboard#queue       — tip queue panel
- /tier4                 — supervisor/admin panel
- /mobile                — mobile on-call interface

OUTPUT FORMAT — respond ONLY with valid JSON matching this exact schema:
{
  "title": "string",
  "description": "string",
  "total_duration_s": number,
  "target_audience": "string",
  "cues": [
    {
      "time_s": number,
      "duration_s": number,
      "narration": "string (1-2 sentences, natural spoken English)",
      "action": {
        "type": "navigate" | "click" | "hover" | "wait" | "scroll" | "highlight" | "screenshot" | "none",
        "target": "string (URL or CSS selector)",
        "scrollPx": number (optional, for scroll actions)
      },
      "caption": "string (optional, short caption overlay)",
      "badge": "string (optional, feature label badge)"
    }
  ],
  "metadata": {
    "product": "CyberTip Triage",
    "version": "1.0.0-demo",
    "generated_at": "ISO timestamp",
    "model_used": "claude-opus-4-6"
  }
}

TIMING RULES:
- total_duration_s must be between 85-100 seconds
- Each cue's duration_s should match roughly how long narration takes to speak (~130 words/min)
- All time_s values must be sequential, no gaps larger than 1s
- Last cue must end at total_duration_s (time_s + duration_s = total_duration_s)
- First cue starts at time_s: 0
- Include 12-15 cues for a 90s video

NARRATION STYLE:
- Speak in present tense ("the system automatically blocks...")
- Use specific LE terminology (ESP, NCMEC, Wilson ruling, ICAC)
- Each cue's narration should be completable in duration_s seconds at normal speaking pace
- Total word count across all narrations: 180-220 words

Do not include any explanation outside the JSON object. Return only valid JSON.`;

// ── Script generation ─────────────────────────────────────────────────────────

export async function generateScript(
  outputDir = "./scripts"
): Promise<{ script: DemoScript; path: string }> {
  console.log("[SCRIPT] Generating demo script with Claude...");

  const client = new Anthropic({
    apiKey: process.env["ANTHROPIC_API_KEY"],
  });

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    system: SCRIPT_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          "Generate a 90-second ICAC demo script for CyberTip Triage. " +
          "Focus on the pain points: tip volume, Wilson compliance risk, and prioritization. " +
          "Use the dashboard and show at least one blocked file and the warrant workflow. " +
          `Set generated_at to: ${new Date().toISOString()}`,
      },
    ],
  });

  const raw = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim()
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "");

  let script: DemoScript;
  try {
    script = JSON.parse(raw) as DemoScript;
  } catch (err) {
    throw new Error(
      `Claude returned invalid JSON for script: ${err instanceof Error ? err.message : String(err)}\n\nRaw output:\n${raw.slice(0, 500)}`
    );
  }

  // Validate minimum structure
  if (!script.cues || script.cues.length < 5) {
    throw new Error(`Script has too few cues: ${script.cues?.length ?? 0}`);
  }

  // Ensure output dir exists
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const scriptPath = join(outputDir, `script_${ts}.json`);
  const latestPath = join(outputDir, "latest.json");

  writeFileSync(scriptPath, JSON.stringify(script, null, 2));
  writeFileSync(latestPath, JSON.stringify(script, null, 2));

  console.log(
    `[SCRIPT] Generated ${script.cues.length} cues, ${script.total_duration_s}s total`
  );
  console.log(`[SCRIPT] Saved to ${scriptPath}`);

  return { script, path: scriptPath };
}

// ── Load existing script ──────────────────────────────────────────────────────

export function loadScript(scriptPath?: string): DemoScript {
  const path = scriptPath ?? "./scripts/latest.json";
  if (!existsSync(path)) {
    throw new Error(
      `Script not found at ${path}. Run with --script-only first, or omit --record-only.`
    );
  }
  const { readFileSync } = require("fs");
  return JSON.parse(readFileSync(path, "utf-8")) as DemoScript;
}

// ── Narration helpers ─────────────────────────────────────────────────────────

/** Join all narration text for TTS (in cue order). */
export function buildFullNarration(script: DemoScript): string {
  return script.cues.map((c: ScriptCue) => c.narration).join(" ");
}

/** Word count estimate for the full narration. */
export function estimateWordCount(script: DemoScript): number {
  return buildFullNarration(script).split(/\s+/).length;
}

/** Estimate audio duration from word count (130 wpm average spoken pace). */
export function estimateAudioDuration(script: DemoScript): number {
  return Math.ceil((estimateWordCount(script) / 130) * 60);
}
