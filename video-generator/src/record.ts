/**
 * Screen Recorder
 *
 * Uses Playwright to record a scripted walkthrough of the running app.
 *
 * Process:
 *   1. Launch headless Chromium with video recording enabled
 *   2. Navigate to the app and wait for it to load
 *   3. For each ScriptCue: execute the action, wait for duration_s
 *   4. Stop recording and save the video
 *
 * The output video has no audio — voiceover is added by the assembler.
 *
 * DEMO_MODE env var injects a small status overlay into the page
 * showing cue timing, which is useful for debugging sync issues.
 */

import { mkdirSync, copyFileSync } from "fs";
import { join } from "path";
import type { DemoScript, ScriptCue, PlaywrightAction, VideoConfig } from "./types.js";

// ── Main entry ────────────────────────────────────────────────────────────────

export async function recordScreen(
  script: DemoScript,
  config: VideoConfig,
  outputDir = "./output"
): Promise<string> {
  mkdirSync(outputDir, { recursive: true });

  // Playwright requires a non-existing dir for recording — use a temp path
  const recordingDir = join(outputDir, "_recording_tmp");
  mkdirSync(recordingDir, { recursive: true });

  const { chromium } = await import("playwright");

  console.log(`[RECORD] Launching browser (${config.width}x${config.height})...`);
  console.log(`[RECORD] Recording ${script.total_duration_s}s walkthrough of ${config.app_url}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      `--window-size=${config.width},${config.height}`,
    ],
  });

  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    recordVideo: {
      dir: recordingDir,
      size: { width: config.width, height: config.height },
    },
    colorScheme: "dark",
  });

  const page = await context.newPage();

  // Inject demo overlay CSS (dimmed progress indicator)
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = `
      #demo-progress {
        position: fixed; bottom: 16px; right: 16px; z-index: 99999;
        background: rgba(0,0,0,0.6); color: #888; font-family: monospace;
        font-size: 11px; padding: 4px 8px; border-radius: 4px;
        pointer-events: none; user-select: none;
      }
    `;
    document.head.appendChild(style);
  });

  // Navigate to app and wait for initial load
  console.log(`[RECORD] Navigating to ${config.app_url}/dashboard`);
  await page.goto(`${config.app_url}/dashboard`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });

  // Inject progress indicator
  await page.evaluate(() => {
    const el = document.createElement("div");
    el.id = "demo-progress";
    el.textContent = "▶ 0:00";
    document.body.appendChild(el);
  });

  // Small pause for page to settle visually
  await page.waitForTimeout(1500);

  // Execute each cue
  console.log(`[RECORD] Executing ${script.cues.length} cues...`);
  const recordingStart = Date.now();

  for (const cue of script.cues) {
    const elapsed = (Date.now() - recordingStart) / 1000;
    const drift = Math.abs(elapsed - cue.time_s);

    // Log timing drift (useful for post-sync debugging)
    if (drift > 1.5) {
      console.warn(
        `[RECORD] Timing drift at cue ${cue.time_s}s: ` +
        `actual=${elapsed.toFixed(1)}s (drift=${drift.toFixed(1)}s)`
      );
    }

    // Update progress overlay
    const mins = Math.floor(cue.time_s / 60);
    const secs = Math.floor(cue.time_s % 60);
    await page.evaluate(
      ({ timeStr }) => {
        const el = document.getElementById("demo-progress");
        if (el) el.textContent = `▶ ${timeStr}`;
      },
      { timeStr: `${mins}:${String(secs).padStart(2, "0")}` }
    );

    // Execute the cue's screen action
    await executeCueAction(page, cue);

    // Wait for cue duration (minus time already spent on action)
    const actionTime = (Date.now() - recordingStart) / 1000 - cue.time_s;
    const remainingWait = Math.max(0, cue.duration_s - actionTime);
    if (remainingWait > 0) {
      await page.waitForTimeout(Math.round(remainingWait * 1000));
    }
  }

  // Ensure we reach total_duration_s
  const totalElapsed = (Date.now() - recordingStart) / 1000;
  const remaining = script.total_duration_s - totalElapsed;
  if (remaining > 0) {
    await page.waitForTimeout(Math.round(remaining * 1000));
  }

  // Stop recording
  const videoPath = await page.video()?.path();
  await context.close();
  await browser.close();

  if (!videoPath) {
    throw new Error("[RECORD] Playwright did not produce a video file");
  }

  // Move to well-known output path
  const finalPath = join(outputDir, "recording.webm");
  copyFileSync(videoPath, finalPath);

  console.log(`[RECORD] Recording saved to ${finalPath}`);
  return finalPath;
}

// ── Action executor ───────────────────────────────────────────────────────────

async function executeCueAction(
  page: import("playwright").Page,
  cue: ScriptCue
): Promise<void> {
  const action = cue.action;

  try {
    switch (action.type) {
      case "navigate":
        if (action.target) {
          await page.goto(action.target, {
            waitUntil: "networkidle",
            timeout: 10_000,
          });
          await page.waitForTimeout(500); // visual settle
        }
        break;

      case "click":
        if (action.target) {
          await page.waitForSelector(action.target, {
            state: "visible",
            timeout: 5_000,
          });
          await page.click(action.target);
          if (action.target.includes(".tip-row")) {
            await page.waitForSelector(".tip-detail-pane", { state: "visible", timeout: 5_000 });
            await page.waitForTimeout(800); // extra settle for animations
          } else {
            await page.waitForTimeout(400);
          }
        }
        break;

      case "hover":
        if (action.target) {
          await page.hover(action.target, { timeout: 5_000 });
        }
        break;

      case "highlight":
        if (action.target) {
          await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (!el) return;
            const existing = document.getElementById("demo-highlight");
            if (existing) existing.remove();
            const rect = el.getBoundingClientRect();
            const highlight = document.createElement("div");
            highlight.id = "demo-highlight";
            highlight.style.cssText = `
              position: fixed;
              top: ${rect.top - 4}px;
              left: ${rect.left - 4}px;
              width: ${rect.width + 8}px;
              height: ${rect.height + 8}px;
              border: 2px solid #2d8cf0;
              border-radius: 4px;
              pointer-events: none;
              z-index: 99998;
              box-shadow: 0 0 12px rgba(45, 140, 240, 0.4);
              animation: pulse 1.5s infinite;
            `;
            document.body.appendChild(highlight);
            // Add pulse keyframes if not present
            if (!document.getElementById("demo-highlight-style")) {
              const style = document.createElement("style");
              style.id = "demo-highlight-style";
              style.textContent = `@keyframes pulse {
                0% { box-shadow: 0 0 0 0 rgba(45,140,240,0.4); }
                70% { box-shadow: 0 0 0 8px rgba(45,140,240,0); }
                100% { box-shadow: 0 0 0 0 rgba(45,140,240,0); }
              }`;
              document.head.appendChild(style);
            }
          }, action.target);
        }
        break;

      case "scroll":
        await page.evaluate((px) => window.scrollBy({ top: px, behavior: "smooth" }), action.scrollPx ?? 300);
        await page.waitForTimeout(600); // smooth scroll animation
        break;

      case "type":
        if (action.target && action.value !== undefined) {
          await page.fill(action.target, action.value);
        }
        break;

      case "wait":
      case "screenshot":
      case "none":
      default:
        // Just hold on current state
        break;
    }
  } catch (err) {
    // Non-fatal — log and continue. Missing selectors are common during demo recording.
    console.warn(
      `[RECORD] Action failed at ${cue.time_s}s (type=${action.type}, target=${action.target ?? "none"}): ` +
      `${err instanceof Error ? err.message : String(err)}`
    );
  }
}
