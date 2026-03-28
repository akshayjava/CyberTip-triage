/**
 * Voiceover Generator
 *
 * Generates MP3 audio from the script narration.
 *
 * Providers (set TTS_PROVIDER env var):
 *   elevenlabs  — Best quality. Requires ELEVENLABS_API_KEY.
 *   openai      — Good quality, cheaper. Requires OPENAI_API_KEY.
 *   none        — Skips audio. Video will be silent (useful for testing recording).
 *
 * The output is a single MP3 covering the full narration in sequence.
 * Cue timing is maintained by inserting pauses between narration segments.
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import type { DemoScript, VideoConfig } from "./types.js";

// ── Main entry ────────────────────────────────────────────────────────────────

export async function generateVoiceover(
  script: DemoScript,
  config: VideoConfig,
  outputDir = "./output"
): Promise<string> {
  mkdirSync(outputDir, { recursive: true });

  const voiceoverPath = join(outputDir, "voiceover.mp3");

  if (config.tts_provider === "none") {
    console.log("[VOICE] TTS_PROVIDER=none — skipping voiceover generation");
    // Write a 1-byte placeholder so downstream code doesn't fail
    writeFileSync(voiceoverPath, Buffer.alloc(0));
    return voiceoverPath;
  }

  console.log(`[VOICE] Generating voiceover via ${config.tts_provider}...`);

  // Build full narration with SSML pauses between cues
  // Each pause is sized to match the cue's on-screen action time
  const fullText = buildNarrationWithPauses(script);

  if (config.tts_provider === "elevenlabs") {
    await generateElevenLabs(fullText, config, voiceoverPath);
  } else {
    await generateOpenAITTS(fullText, config, voiceoverPath);
  }

  console.log(`[VOICE] Voiceover saved to ${voiceoverPath}`);
  return voiceoverPath;
}

// ── Narration builder ─────────────────────────────────────────────────────────

/**
 * Builds the full narration text with timing pauses between cues.
 *
 * For ElevenLabs: uses SSML <break> tags
 * For OpenAI TTS: uses "..." ellipsis pauses (no SSML support)
 *
 * We calculate the pause duration between cues as the gap between
 * (previous_cue.time_s + previous_cue.duration_s) and current_cue.time_s.
 */
function buildNarrationWithPauses(
  script: DemoScript,
  format: "ssml" | "plain" = "ssml"
): string {
  const cues = script.cues;
  const parts: string[] = [];

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (!cue) continue;

    parts.push(cue.narration);

    // Calculate pause before next cue
    const next = cues[i + 1];
    if (next) {
      const speakEnd = cue.time_s + cue.duration_s;
      const pauseMs = Math.max(0, Math.round((next.time_s - speakEnd) * 1000));
      if (pauseMs > 200) {
        if (format === "ssml") {
          parts.push(`<break time="${pauseMs}ms"/>`);
        } else {
          // Rough approximation: one "..." ≈ 500ms pause
          const dots = Math.max(1, Math.round(pauseMs / 500));
          parts.push("...".repeat(dots));
        }
      }
    }
  }

  const body = parts.join(" ");

  if (format === "ssml") {
    return `<speak>${body}</speak>`;
  }
  return body;
}

// ── ElevenLabs ────────────────────────────────────────────────────────────────

async function generateElevenLabs(
  ssmlText: string,
  config: VideoConfig,
  outputPath: string
): Promise<void> {
  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY not set. Set TTS_PROVIDER=openai to use OpenAI TTS instead."
    );
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenlabs_voice_id}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: ssmlText,
      model_id: "eleven_turbo_v2",
      voice_settings: {
        stability: 0.65,
        similarity_boost: 0.75,
        style: 0.1,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${err}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, buffer);

  console.log(`[VOICE] ElevenLabs: ${(buffer.length / 1024).toFixed(0)}KB audio generated`);
}

// ── OpenAI TTS ────────────────────────────────────────────────────────────────

async function generateOpenAITTS(
  text: string,
  config: VideoConfig,
  outputPath: string
): Promise<void> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set. Set TTS_PROVIDER=none to skip voiceover.");
  }

  // Plain text for OpenAI (no SSML)
  const plainText = text
    .replace(/<speak>/g, "")
    .replace(/<\/speak>/g, "")
    .replace(/<break time="\d+ms"\/>/g, "... ")
    .trim();

  const { OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });

  const mp3 = await client.audio.speech.create({
    model: "tts-1-hd",
    voice: config.openai_voice,
    input: plainText,
    response_format: "mp3",
  });

  const buffer = Buffer.from(await mp3.arrayBuffer());
  writeFileSync(outputPath, buffer);

  console.log(`[VOICE] OpenAI TTS: ${(buffer.length / 1024).toFixed(0)}KB audio generated`);
}

// ── Timing analysis ───────────────────────────────────────────────────────────

/**
 * Estimate audio duration from the script.
 * Used by the assembler to sync video length to audio.
 */
export function estimateVoiceoverDuration(script: DemoScript): number {
  // 130 words per minute average speaking pace
  const words = script.cues
    .map((c) => c.narration.split(/\s+/).length)
    .reduce((a, b) => a + b, 0);
  return Math.ceil((words / 130) * 60);
}

// ── Captions (SRT) ────────────────────────────────────────────────────────────

/**
 * Generate an SRT captions file from the script.
 * Uses the narration text and cue timing directly — no Whisper needed
 * since we control the script.
 */
export function generateCaptions(
  script: DemoScript,
  outputDir = "./output"
): string {
  mkdirSync(outputDir, { recursive: true });
  const captionsPath = join(outputDir, "captions.srt");

  const lines: string[] = [];
  let index = 1;

  for (const cue of script.cues) {
    const captionText = cue.caption ?? cue.narration;

    // Split long captions into ~7 word chunks for readability
    const chunks = splitCaption(captionText, 7);
    const chunkDuration = cue.duration_s / chunks.length;

    for (let i = 0; i < chunks.length; i++) {
      const start = cue.time_s + i * chunkDuration;
      const end = start + chunkDuration - 0.1;

      lines.push(String(index++));
      lines.push(`${toSrtTime(start)} --> ${toSrtTime(end)}`);
      lines.push(chunks[i] ?? "");
      lines.push("");
    }
  }

  writeFileSync(captionsPath, lines.join("\n"));
  console.log(`[VOICE] Captions saved to ${captionsPath}`);
  return captionsPath;
}

/** Format seconds as SRT timestamp HH:MM:SS,mmm */
function toSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Split a sentence into chunks of ~n words */
function splitCaption(text: string, wordsPerChunk: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
  }
  return chunks;
}
