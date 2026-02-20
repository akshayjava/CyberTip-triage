/**
 * Video Generator — Shared Types
 *
 * The ScriptCue is the central data structure that drives both
 * Playwright (screen recording) and TTS (voiceover timing).
 * Generate once, use everywhere.
 */

// ── Script types ──────────────────────────────────────────────────────────────

export interface PlaywrightAction {
  /** Playwright method to call */
  type:
    | "navigate"      // page.goto(url)
    | "click"         // page.click(selector)
    | "hover"         // page.hover(selector)
    | "wait"          // page.waitForTimeout(ms)
    | "scroll"        // page.evaluate(scroll)
    | "highlight"     // inject a CSS highlight ring on selector
    | "type"          // page.fill(selector, value)
    | "screenshot"    // just capture — no interaction
    | "none";         // voiceover only, no UI interaction

  /** CSS selector or URL depending on type */
  target?: string;

  /** Value for "type" action */
  value?: string;

  /** Scroll distance in px (positive = down) */
  scrollPx?: number;
}

export interface ScriptCue {
  /** Start time in seconds from beginning of video */
  time_s: number;

  /** How long this cue lasts (used to pace screen recording) */
  duration_s: number;

  /** Spoken narration for this cue */
  narration: string;

  /** Screen action to perform at time_s */
  action: PlaywrightAction;

  /**
   * Optional caption text override.
   * If omitted, narration text is used as the caption.
   */
  caption?: string;

  /**
   * Visual annotation rendered as an overlay badge.
   * Shown bottom-left during this cue.
   */
  badge?: string;
}

export interface DemoScript {
  title: string;
  description: string;
  total_duration_s: number;
  target_audience: string;
  cues: ScriptCue[];

  /** Metadata for the final video */
  metadata: {
    product: string;
    version: string;
    generated_at: string;
    model_used: string;
  };
}

// ── Config types ──────────────────────────────────────────────────────────────

export interface VideoConfig {
  /** Base URL of the running CyberTip Triage app */
  app_url: string;

  /** Video dimensions */
  width: number;
  height: number;

  /** Frames per second for output video */
  fps: number;

  /** TTS provider: "elevenlabs" | "openai" | "none" (silent) */
  tts_provider: "elevenlabs" | "openai" | "none";

  /** ElevenLabs voice ID (if using EL) */
  elevenlabs_voice_id: string;

  /** OpenAI TTS voice (if using OpenAI TTS) */
  openai_voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

  /** Output file path */
  output_path: string;

  /** Whether to keep intermediate files for debugging */
  keep_intermediates: boolean;

  /** Paths for intro/outro — omit to use generated title cards */
  intro_video?: string;
  outro_video?: string;
}

export const DEFAULT_CONFIG: VideoConfig = {
  app_url:               process.env["APP_URL"]        ?? "http://localhost:3000",
  width:                 1920,
  height:                1080,
  fps:                   30,
  tts_provider:          (process.env["TTS_PROVIDER"]  ?? "openai") as VideoConfig["tts_provider"],
  elevenlabs_voice_id:   process.env["ELEVENLABS_VOICE_ID"] ?? "21m00Tcm4TlvDq8ikWAM", // Rachel
  openai_voice:          "nova",
  output_path:           "./output/demo.mp4",
  keep_intermediates:    process.env["KEEP_INTERMEDIATES"] === "true",
};

// ── Generation result types ───────────────────────────────────────────────────

export interface GenerationResult {
  script_path:      string;
  recording_path:   string;
  voiceover_path:   string;
  captions_path:    string;
  final_video_path: string;
  duration_s:       number;
  generated_at:     string;
}
