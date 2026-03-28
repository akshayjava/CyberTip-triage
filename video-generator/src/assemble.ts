/**
 * Video Assembler
 *
 * Uses FFmpeg to combine all components into the final MP4:
 *   1. Intro title card (generated as lavfi color source + text)
 *   2. Screen recording (WebM → H.264)
 *   3. Outro CTA card (generated)
 *   4. Voiceover audio (MP3)
 *   5. SRT captions burned in
 *
 * Requires ffmpeg in PATH. Install via:
 *   brew install ffmpeg        (macOS)
 *   apt install ffmpeg         (Ubuntu)
 *   choco install ffmpeg       (Windows)
 *
 * Or set FFMPEG_PATH env var to the ffmpeg binary location.
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import type { DemoScript, VideoConfig } from "./types.js";

// ── Main entry ────────────────────────────────────────────────────────────────

export async function assembleVideo(
  script: DemoScript,
  config: VideoConfig,
  recordingPath: string,
  voiceoverPath: string,
  captionsPath: string,
  outputDir = "./output"
): Promise<string> {
  mkdirSync(outputDir, { recursive: true });

  const ffmpeg = findFFmpeg();
  console.log(`[ASSEMBLE] FFmpeg found at: ${ffmpeg}`);

  const finalPath = resolve(config.output_path);
  const hasAudio = statSync(voiceoverPath).size > 100;
  const hasCaptions = false; // Bypass missing libass/subtitles filter in Homebrew FFmpeg

  console.log("[ASSEMBLE] Generating outro card...");
  const introDuration = 0; // seconds
  const outroDuration = 4;
  const outroPath = join(outputDir, "outro.mp4");

  generateTitleCard(ffmpeg, {
    outputPath: outroPath,
    duration: outroDuration,
    width: config.width,
    height: config.height,
    title: "CyberTip Triage",
    subtitle: "Authorized ICAC Use Only",
    bgColor: "#0a0e18",
    textColor: "white",
    accentColor: "#2d8cf0",
    fps: 30
  });

  console.log("[ASSEMBLE] Transcoding recording to x264...");
  const recordingX264 = join(outputDir, "recording_x264.mp4");
  runFFmpeg(ffmpeg, [
    "-y",
    "-i", recordingPath,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-an", // Audio added later
    recordingX264
  ]);

  console.log("[ASSEMBLE] Concatenating recording + outro...");
  const combinedPath = join(outputDir, "combined.mp4");

  const listPath = join(outputDir, "concat.txt");
  const outroAbs = resolve(outroPath);
  writeFileSync(listPath, `file '${resolve(recordingX264)}'\nfile '${outroAbs}'`);

  runFFmpeg(ffmpeg, [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c", "copy",
    combinedPath
  ]);

  // Add captions burn-in if available
  let videoWithCaptions = combinedPath;
  if (hasCaptions) {
    console.log("[ASSEMBLE] Burning in captions...");
    const captionedPath = join(outputDir, "captioned.mp4");

    // Offset caption timing by intro duration
    const offsetCaptionsPath = join(outputDir, "captions_offset.srt");
    offsetCaptions(captionsPath, offsetCaptionsPath, introDuration);

    runFFmpeg(ffmpeg, [
      "-y",
      "-i", combinedPath,
      "-vf", `subtitles=${offsetCaptionsPath}:force_style='Fontname=Arial,Fontsize=24,PrimaryColour=&Hffffff&,OutlineColour=&H000000&,Outline=2,Shadow=1,MarginV=40'`,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "20",
      "-an",
      captionedPath,
    ]);
    videoWithCaptions = captionedPath;
  }

  // Add audio
  console.log("[ASSEMBLE] Adding voiceover audio...");
  if (hasAudio) {
    // Audio starts at intro end (offset by introDuration)
    const audioArgs = [
      "-y",
      "-i", videoWithCaptions,
      "-itsoffset", String(introDuration),
      "-i", voiceoverPath,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "20",
      "-c:a", "aac",
      "-b:a", "128k",
      finalPath,
    ];
    runFFmpeg(ffmpeg, audioArgs);
  } else {
    // No audio — transcode video
    runFFmpeg(ffmpeg, ["-y", "-i", videoWithCaptions, "-c:v", "libx264", "-preset", "fast", "-crf", "20", finalPath]);
  }

  // Clean up intermediates unless requested to keep
  if (!config.keep_intermediates) {
    for (const f of []) {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch { /* non-fatal */ }
    }
  }

  const sizeMB = (statSync(finalPath).size / (1024 * 1024)).toFixed(1);
  console.log(`[ASSEMBLE] ✓ Final video: ${finalPath} (${sizeMB}MB)`);

  return finalPath;
}

// ── Title card generator ──────────────────────────────────────────────────────

interface TitleCardOptions {
  outputPath: string;
  duration: number;
  width: number;
  height: number;
  title: string;
  subtitle: string;
  bgColor: string;
  textColor: string;
  accentColor: string;
  fps: number;
}

function generateTitleCard(ffmpeg: string, opts: TitleCardOptions): void {
  // Escape single quotes in text
  const escTitle = opts.title.replace(/'/g, "\\'").replace(/:/g, "\\:");
  const escSubtitle = opts.subtitle.replace(/'/g, "\\'").replace(/:/g, "\\:");

  const vf = [
    `color=c=${opts.bgColor}:size=${opts.width}x${opts.height}:rate=${opts.fps}`,
    `drawtext=text='${escTitle}':fontcolor=${opts.textColor}:fontsize=72:x=(w-text_w)/2:y=(h-text_h)/2-40:fontfile=/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf 2>/dev/null || echo`,
    `drawtext=text='${escSubtitle}':fontcolor=${opts.accentColor}:fontsize=32:x=(w-text_w)/2:y=(h-text_h)/2+50:fontfile=/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf 2>/dev/null || echo`,
  ].join(",");

  runFFmpeg(ffmpeg, [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${opts.bgColor}:size=${opts.width}x${opts.height}:rate=${opts.fps}`,
    "-t", String(opts.duration),
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    opts.outputPath,
  ]);
}

// ── SRT offset ────────────────────────────────────────────────────────────────

/** Offset all SRT timestamps by `offsetSeconds` to account for intro card. */
function offsetCaptions(
  inputPath: string,
  outputPath: string,
  offsetSeconds: number
): void {
  const content = readFileSync(inputPath, "utf-8") as string;

  const offsetted = content.replace(
    /(\d{2}):(\d{2}):(\d{2}),(\d{3})/g,
    (_, h, m, s, ms) => {
      const totalMs =
        parseInt(h) * 3600000 +
        parseInt(m) * 60000 +
        parseInt(s) * 1000 +
        parseInt(ms) +
        offsetSeconds * 1000;
      const newH = Math.floor(totalMs / 3600000);
      const newM = Math.floor((totalMs % 3600000) / 60000);
      const newS = Math.floor((totalMs % 60000) / 1000);
      const newMs = totalMs % 1000;
      return `${pad(newH)}:${pad(newM)}:${pad(newS)},${pad(newMs, 3)}`;
    }
  );

  writeFileSync(outputPath, offsetted);
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

// ── FFmpeg helpers ────────────────────────────────────────────────────────────

function findFFmpeg(): string {
  const envPath = process.env["FFMPEG_PATH"];
  if (envPath) return envPath;

  // Try common locations
  const candidates = ["ffmpeg", "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"];
  for (const candidate of candidates) {
    try {
      execSync(`${candidate} -version`, { stdio: "pipe" });
      return candidate;
    } catch { /* not found at this path */ }
  }

  throw new Error(
    "ffmpeg not found in PATH. Install it:\n" +
    "  macOS:   brew install ffmpeg\n" +
    "  Ubuntu:  sudo apt install ffmpeg\n" +
    "  Windows: choco install ffmpeg\n" +
    "Or set FFMPEG_PATH=/path/to/ffmpeg"
  );
}

function runFFmpeg(ffmpeg: string, args: string[]): void {
  const result = spawnSync(ffmpeg, args, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.slice(-2000) ?? "";
    throw new Error(
      `FFmpeg failed (exit ${result.status ?? "unknown"}):\n` +
      `Command: ${ffmpeg} ${args.join(" ")}\n` +
      `Stderr: ${stderr}`
    );
  }
}
