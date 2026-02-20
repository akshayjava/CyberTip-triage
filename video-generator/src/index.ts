import "dotenv/config";
/**
 * CyberTip Triage — Automated Demo Video Generator
 *
 * Orchestrates all stages of video generation:
 *   1. Seed demo data into the running app
 *   2. Generate timed script with Claude
 *   3. Generate voiceover audio (ElevenLabs or OpenAI TTS)
 *   4. Generate SRT captions from script
 *   5. Record screen with Playwright following script cues
 *   6. Assemble final MP4 with FFmpeg
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   # Full pipeline (recommended first run)
 *   npm run generate
 *
 *   # Skip stages you've already run (uses cached intermediates)
 *   npm run generate -- --skip-seed
 *   npm run generate -- --skip-script
 *   npm run generate -- --record-only
 *   npm run generate -- --assemble-only
 *
 *   # Run only a specific stage
 *   npm run generate -- --script-only
 *   npm run generate -- --voice-only
 *   npm run generate -- --record-only
 *   npm run generate -- --assemble-only
 *
 * ── Required env vars ──────────────────────────────────────────────────────
 *
 *   APP_URL=http://localhost:3000   (default)
 *   ANTHROPIC_API_KEY=sk-ant-...
 *
 *   # For voiceover (pick one):
 *   TTS_PROVIDER=openai && OPENAI_API_KEY=sk-...
 *   TTS_PROVIDER=elevenlabs && ELEVENLABS_API_KEY=... && ELEVENLABS_VOICE_ID=...
 *   TTS_PROVIDER=none   (silent video)
 *
 * ── Output ─────────────────────────────────────────────────────────────────
 *
 *   output/
 *     voiceover.mp3       — TTS audio
 *     recording.webm      — Raw Playwright recording
 *     captions.srt        — Timed subtitles
 *     demo.mp4            — Final assembled video  ← share this
 *
 *   scripts/
 *     latest.json         — Most recent generated script
 *     script_<ts>.json    — Timestamped script archives
 */

import { existsSync } from "fs";
import { resolve } from "path";
import { DEFAULT_CONFIG } from "./types.js";
import { generateScript } from "./script.js";
import { generateVoiceover, generateCaptions } from "./voiceover.js";
import { recordScreen } from "./record.js";
import { assembleVideo } from "./assemble.js";
import { seedDemoData } from "./seed.js";
import type { DemoScript, GenerationResult } from "./types.js";

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = {
  scriptOnly:   args.includes("--script-only"),
  voiceOnly:    args.includes("--voice-only"),
  recordOnly:   args.includes("--record-only"),
  assembleOnly: args.includes("--assemble-only"),
  skipSeed:     args.includes("--skip-seed"),
  skipScript:   args.includes("--skip-script"),
  skipVoice:    args.includes("--skip-voice"),
  skipRecord:   args.includes("--skip-record"),
};

const OUTPUT_DIR  = "./output";
const SCRIPTS_DIR = "./scripts";

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n🎬  CyberTip Triage — Demo Video Generator");
  console.log("─".repeat(50));

  const config = { ...DEFAULT_CONFIG };

  // ── Stage 0: Seed demo data ─────────────────────────────────────────────────
  if (!flags.skipSeed && !flags.scriptOnly && !flags.voiceOnly && !flags.assembleOnly) {
    console.log("\n[0/5] Seeding demo data...");
    try {
      await seedDemoData(config.app_url);
    } catch (err) {
      console.warn(
        `[SEED] Warning: seeding failed (${err instanceof Error ? err.message : String(err)}). ` +
        `Continuing — dashboard may appear empty.`
      );
    }
  }

  // ── Stage 1: Generate script ────────────────────────────────────────────────
  let script: DemoScript;
  let scriptPath: string;

  if (flags.assembleOnly || flags.recordOnly || flags.skipScript) {
    // Load existing script
    const latestPath = resolve(SCRIPTS_DIR, "latest.json");
    if (!existsSync(latestPath)) {
      die("No script found. Run without --skip-script first.");
    }
    const { readFileSync } = await import("fs");
    script = JSON.parse(readFileSync(latestPath, "utf-8")) as DemoScript;
    scriptPath = latestPath;
    console.log(`\n[1/5] Using existing script: ${scriptPath}`);
    console.log(`      ${script.cues.length} cues, ${script.total_duration_s}s`);
  } else {
    console.log("\n[1/5] Generating script with Claude...");
    ({ script, path: scriptPath } = await generateScript(SCRIPTS_DIR));
    if (flags.scriptOnly) {
      console.log("\n✓ Script generated. Run without --script-only to continue.\n");
      printScriptSummary(script);
      return;
    }
  }

  printScriptSummary(script);

  // ── Stage 2: Generate voiceover ─────────────────────────────────────────────
  let voiceoverPath = resolve(OUTPUT_DIR, "voiceover.mp3");

  if (!flags.assembleOnly && !flags.recordOnly && !flags.skipVoice) {
    console.log(`\n[2/5] Generating voiceover (${config.tts_provider})...`);
    voiceoverPath = await generateVoiceover(script, config, OUTPUT_DIR);
    if (flags.voiceOnly) {
      console.log("\n✓ Voiceover generated.\n");
      return;
    }
  } else {
    console.log(`\n[2/5] Using existing voiceover: ${voiceoverPath}`);
  }

  // ── Stage 3: Generate captions ──────────────────────────────────────────────
  console.log("\n[3/5] Generating captions...");
  const captionsPath = generateCaptions(script, OUTPUT_DIR);

  // ── Stage 4: Record screen ──────────────────────────────────────────────────
  let recordingPath = resolve(OUTPUT_DIR, "recording.webm");

  if (!flags.assembleOnly && !flags.skipRecord) {
    console.log("\n[4/5] Recording screen with Playwright...");
    recordingPath = await recordScreen(script, config, OUTPUT_DIR);
    if (flags.recordOnly) {
      console.log("\n✓ Recording complete.\n");
      return;
    }
  } else {
    if (!existsSync(recordingPath)) {
      die(`Recording not found at ${recordingPath}. Run without --assemble-only first.`);
    }
    console.log(`\n[4/5] Using existing recording: ${recordingPath}`);
  }

  // ── Stage 5: Assemble ───────────────────────────────────────────────────────
  console.log("\n[5/5] Assembling final video with FFmpeg...");
  const finalPath = await assembleVideo(
    script,
    config,
    recordingPath,
    voiceoverPath,
    captionsPath,
    OUTPUT_DIR
  );

  // ── Done ────────────────────────────────────────────────────────────────────
  const result: GenerationResult = {
    script_path:      scriptPath,
    recording_path:   recordingPath,
    voiceover_path:   voiceoverPath,
    captions_path:    captionsPath,
    final_video_path: finalPath,
    duration_s:       script.total_duration_s,
    generated_at:     new Date().toISOString(),
  };

  console.log("\n" + "─".repeat(50));
  console.log("✅  Demo video generated successfully!\n");
  console.log(`   Video:    ${result.final_video_path}`);
  console.log(`   Duration: ${result.duration_s}s`);
  console.log(`   Script:   ${result.script_path}`);
  console.log(`   Captions: ${result.captions_path}\n`);

  // Save generation manifest
  const { writeFileSync } = await import("fs");
  writeFileSync(
    resolve(OUTPUT_DIR, "manifest.json"),
    JSON.stringify(result, null, 2)
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function printScriptSummary(script: DemoScript): void {
  console.log(`      Title: "${script.title}"`);
  console.log(`      Cues:  ${script.cues.length} | Duration: ${script.total_duration_s}s`);
  console.log(`      Audience: ${script.target_audience}`);
  if (process.env["VERBOSE"]) {
    console.log("\n      Cue summary:");
    for (const cue of script.cues) {
      const t = String(cue.time_s).padStart(3);
      const d = String(cue.duration_s).padStart(2);
      const action = cue.action.type.padEnd(10);
      const narration = cue.narration.slice(0, 60) + (cue.narration.length > 60 ? "..." : "");
      console.log(`        ${t}s +${d}s  ${action}  "${narration}"`);
    }
  }
}

function die(message: string): never {
  console.error(`\n❌  ${message}\n`);
  process.exit(1);
}

// ── Run ───────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("\n❌  Generation failed:");
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
