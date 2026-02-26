/**
 * Gemma Provider
 *
 * First-class provider for Google's Gemma open-weight models running locally
 * via Ollama, vLLM, or llama.cpp.  This is the recommended LLM backend for
 * offline / air-gap deployments where no cloud API calls are permitted.
 *
 * Gemma 3 supports function calling / tool use natively, making it suitable
 * for all CyberTip agents including Legal Gate and Linker.
 *
 * ── Recommended model sizes ───────────────────────────────────────────────────
 *
 *   high   → gemma3:27b   (best reasoning; needs ≥ 24 GB VRAM or 64 GB RAM)
 *   medium → gemma3:12b   (good balance; needs ≥ 12 GB VRAM or 32 GB RAM)
 *   fast   → gemma3:4b    (fastest; needs ≥ 6 GB VRAM or 16 GB RAM)
 *
 * Smaller deployments (low-resource air-gap):
 *   high   → gemma3:12b
 *   medium → gemma3:4b
 *   fast   → gemma3:4b
 *
 * Gemma 2 (older hardware, no Gemma 3 support):
 *   high   → gemma2:27b
 *   medium → gemma2:9b
 *   fast   → gemma2:2b
 *
 * ── Environment variables ─────────────────────────────────────────────────────
 *
 *   LOCAL_LLM_BASE_URL=http://localhost:11434/v1   (Ollama default)
 *                     =http://localhost:8000/v1    (vLLM)
 *                     =http://localhost:8080/v1    (llama.cpp server)
 *
 *   GEMMA_MODEL_HIGH=gemma3:27b      (or GEMMA_MODEL_HIGH=gemma3:12b for smaller HW)
 *   GEMMA_MODEL_MEDIUM=gemma3:12b
 *   GEMMA_MODEL_FAST=gemma3:4b
 *
 *   LOCAL_LLM_API_KEY=ollama          (Ollama ignores it; vLLM may require one)
 *
 * ── Ollama quick-start ────────────────────────────────────────────────────────
 *
 *   # Install Ollama (air-gap: download installer, transfer via USB)
 *   curl -fsSL https://ollama.com/install.sh | sh
 *
 *   # Pull Gemma 3 models (do this before going air-gap!)
 *   ollama pull gemma3:27b
 *   ollama pull gemma3:12b
 *   ollama pull gemma3:4b
 *
 *   # Start Ollama (runs on :11434 by default)
 *   ollama serve
 *
 *   # Or via Docker (included in docker-compose.offline.yml)
 *   docker compose -f docker-compose.offline.yml up ollama
 *
 * ── vLLM quick-start ─────────────────────────────────────────────────────────
 *
 *   pip install vllm
 *   python -m vllm.entrypoints.openai.api_server \
 *     --model google/gemma-3-12b-it \
 *     --port 8000 \
 *     --dtype bfloat16
 *
 * ── Tool use notes ────────────────────────────────────────────────────────────
 *
 *   Gemma 3 (2B, 4B, 12B, 27B) supports tool use natively via the OpenAI
 *   function-calling format.  Ensure you are running Ollama ≥ 0.3.x or
 *   vLLM ≥ 0.5.x for full tool call support.
 *
 *   If tool calls fail (older Gemma versions), set TOOL_MODE=stub to use
 *   deterministic stubs for development/testing.
 */

import { OpenAICompatProvider } from "./openai_compat_provider.js";
import type { LLMProvider, ModelRole } from "../types.js";

// ── Default model names ───────────────────────────────────────────────────────

const GEMMA_DEFAULTS: Record<ModelRole, string> = {
  high:   process.env["GEMMA_MODEL_HIGH"]   ?? "gemma3:27b",
  medium: process.env["GEMMA_MODEL_MEDIUM"] ?? "gemma3:12b",
  fast:   process.env["GEMMA_MODEL_FAST"]   ?? "gemma3:4b",
};

/**
 * GemmaProvider wraps OpenAICompatProvider with Gemma-specific defaults.
 *
 * Gemma runs locally via Ollama/vLLM which expose an OpenAI-compatible API,
 * so we reuse all the connection and agentic loop logic from OpenAICompatProvider
 * but override the model names and provider label.
 */
export class GemmaProvider implements LLMProvider {
  readonly providerName = "gemma";

  private readonly inner: OpenAICompatProvider;
  private readonly modelMap: Record<ModelRole, string>;

  constructor() {
    // Inject Gemma model env vars so OpenAICompatProvider picks them up
    // without polluting the generic LOCAL_MODEL_* vars.
    const savedHigh   = process.env["LOCAL_MODEL_HIGH"];
    const savedMedium = process.env["LOCAL_MODEL_MEDIUM"];
    const savedFast   = process.env["LOCAL_MODEL_FAST"];

    process.env["LOCAL_MODEL_HIGH"]   = GEMMA_DEFAULTS.high;
    process.env["LOCAL_MODEL_MEDIUM"] = GEMMA_DEFAULTS.medium;
    process.env["LOCAL_MODEL_FAST"]   = GEMMA_DEFAULTS.fast;

    this.inner = new OpenAICompatProvider("local");

    // Restore original values (or delete if they weren't set)
    restoreEnv("LOCAL_MODEL_HIGH",   savedHigh);
    restoreEnv("LOCAL_MODEL_MEDIUM", savedMedium);
    restoreEnv("LOCAL_MODEL_FAST",   savedFast);

    // Build our own model map using GEMMA_MODEL_* overrides or defaults
    this.modelMap = {
      high:   process.env["GEMMA_MODEL_HIGH"]   ?? GEMMA_DEFAULTS.high,
      medium: process.env["GEMMA_MODEL_MEDIUM"] ?? GEMMA_DEFAULTS.medium,
      fast:   process.env["GEMMA_MODEL_FAST"]   ?? GEMMA_DEFAULTS.fast,
    };
  }

  getModelName(role: ModelRole): string {
    return this.modelMap[role];
  }

  async runAgent(opts: import("../types.js").AgentCallOptions): Promise<string> {
    // Override the model name for each call so the inner provider uses Gemma models
    const patchedOpts = { ...opts };
    return this.inner.runAgent(patchedOpts);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function restoreEnv(key: string, prev: string | undefined): void {
  if (prev === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = prev;
  }
}

/**
 * Return a human-readable description of the Gemma configuration for logs.
 */
export function getGemmaSummary(): {
  backend: string;
  base_url: string;
  models: Record<ModelRole, string>;
} {
  const base_url = process.env["LOCAL_LLM_BASE_URL"] ?? "http://localhost:11434/v1";
  const backend = inferBackend(base_url);
  return {
    backend,
    base_url,
    models: {
      high:   process.env["GEMMA_MODEL_HIGH"]   ?? GEMMA_DEFAULTS.high,
      medium: process.env["GEMMA_MODEL_MEDIUM"] ?? GEMMA_DEFAULTS.medium,
      fast:   process.env["GEMMA_MODEL_FAST"]   ?? GEMMA_DEFAULTS.fast,
    },
  };
}

function inferBackend(url: string): string {
  if (url.includes(":11434")) return "ollama";
  if (url.includes(":8000"))  return "vllm";
  if (url.includes(":8080"))  return "llama.cpp";
  if (url.includes(":1234"))  return "lm-studio";
  return "openai-compat";
}
