/**
 * LLM Configuration
 *
 * Reads LLM_PROVIDER env var and returns the configured provider singleton.
 * All agents call getLLMProvider() — they never import a vendor SDK directly.
 *
 * ── Environment variables ──────────────────────────────────────────────────
 *
 * Required:
 *   LLM_PROVIDER=anthropic|openai|gemini|local   (default: anthropic)
 *
 * API keys (whichever provider you use):
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   OPENAI_API_KEY=sk-...
 *   GEMINI_API_KEY=AIza...
 *   LOCAL_LLM_API_KEY=ollama      (default for Ollama; not needed for most local servers)
 *
 * Local server URL:
 *   LOCAL_LLM_BASE_URL=http://localhost:11434/v1   (Ollama default)
 *   LOCAL_LLM_BASE_URL=http://localhost:1234/v1    (LM Studio)
 *   LOCAL_LLM_BASE_URL=http://host:8000/v1         (vLLM)
 *
 * Model overrides (optional — each provider has sensible defaults):
 *   LLM_MODEL_HIGH=claude-opus-4-6         (or gpt-4o, gemini-1.5-pro, llama3.1:70b)
 *   LLM_MODEL_MEDIUM=claude-sonnet-4-6     (or gpt-4o-mini, gemini-1.5-flash, llama3.1:8b)
 *   LLM_MODEL_FAST=claude-haiku-4-5-20251001
 *
 * Local model names (if not using LLM_MODEL_* overrides):
 *   LOCAL_MODEL_HIGH=llama3.1:70b
 *   LOCAL_MODEL_MEDIUM=llama3.1:8b
 *   LOCAL_MODEL_FAST=llama3.1:8b
 *
 * ── Provider defaults ──────────────────────────────────────────────────────
 *
 *   anthropic:
 *     high   → claude-opus-4-6
 *     medium → claude-sonnet-4-6
 *     fast   → claude-haiku-4-5-20251001
 *
 *   openai:
 *     high   → gpt-4o
 *     medium → gpt-4o-mini
 *     fast   → gpt-4o-mini
 *
 *   gemini:
 *     high   → gemini-1.5-pro
 *     medium → gemini-1.5-flash
 *     fast   → gemini-1.5-flash
 *
 *   local:
 *     high   → llama3.1:70b  (or LOCAL_MODEL_HIGH)
 *     medium → llama3.1:8b   (or LOCAL_MODEL_MEDIUM)
 *     fast   → llama3.1:8b   (or LOCAL_MODEL_FAST)
 *
 * ── Notes on local LLM tool use ───────────────────────────────────────────
 *
 * Tool use (function calling) requires a model that supports it.
 * Recommended models with tool use:
 *   Ollama:    llama3.1, mistral-nemo, qwen2.5, command-r
 *   LM Studio: any GGUF with function-calling in model card
 *   vLLM:      mistralai/Mistral-7B-Instruct-v0.3, meta-llama/Meta-Llama-3.1-8B-Instruct
 *
 * Models WITHOUT tool use will fail on agents that require it (Legal Gate, Linker,
 * Priority, Hash OSINT). Use a tool-capable model or set TOOL_MODE=stub to skip
 * real tool calls in development.
 */

import type { LLMProvider, ProviderName } from "./types.js";
import { AnthropicProvider } from "./providers/anthropic_provider.js";
import { OpenAICompatProvider } from "./providers/openai_compat_provider.js";

// Singleton — created once, reused across all agent calls
let _provider: LLMProvider | null = null;

/**
 * Get the configured LLM provider singleton.
 * Provider is determined by LLM_PROVIDER env var (default: anthropic).
 */
export function getLLMProvider(): LLMProvider {
  if (_provider) return _provider;

  const providerName = (process.env["LLM_PROVIDER"] ?? "anthropic") as ProviderName;

  switch (providerName) {
    case "anthropic":
      _provider = new AnthropicProvider();
      break;
    case "openai":
      _provider = new OpenAICompatProvider("openai");
      break;
    case "gemini":
      _provider = new OpenAICompatProvider("gemini");
      break;
    case "local":
      _provider = new OpenAICompatProvider("local");
      break;
    default:
      console.warn(`[LLM] Unknown provider "${providerName}", falling back to anthropic`);
      _provider = new AnthropicProvider();
  }

  console.log(
    `[LLM] Provider: ${_provider.providerName} | ` +
    `Models: high=${_provider.getModelName("high")}, ` +
    `medium=${_provider.getModelName("medium")}, ` +
    `fast=${_provider.getModelName("fast")}`
  );

  return _provider;
}

/** Reset the singleton — used in tests to swap providers. */
export function resetLLMProvider(): void {
  _provider = null;
}

/**
 * Validate that required API keys are present for the configured provider.
 * Called at startup — logs warnings but doesn't hard-stop (allows dev mode without keys).
 */
export function validateLLMConfig(): { ok: boolean; warnings: string[] } {
  const provider = (process.env["LLM_PROVIDER"] ?? "anthropic") as ProviderName;
  const warnings: string[] = [];

  if (provider === "anthropic" && !process.env["ANTHROPIC_API_KEY"]) {
    warnings.push("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
  }
  if (provider === "openai" && !process.env["OPENAI_API_KEY"]) {
    warnings.push("LLM_PROVIDER=openai but OPENAI_API_KEY is not set");
  }
  if (provider === "gemini" && !process.env["GEMINI_API_KEY"]) {
    warnings.push("LLM_PROVIDER=gemini but GEMINI_API_KEY is not set");
  }
  if (provider === "local") {
    const base = process.env["LOCAL_LLM_BASE_URL"] ?? "http://localhost:11434/v1";
    console.log(`[LLM] Local LLM endpoint: ${base}`);
    // No API key required for most local servers — just a URL
  }

  for (const w of warnings) {
    console.warn(`[LLM] ⚠ ${w}`);
  }

  return { ok: warnings.length === 0, warnings };
}

/**
 * Return a summary of current LLM configuration for the admin UI / health endpoint.
 */
export function getLLMConfigSummary(): {
  provider: string;
  models: { high: string; medium: string; fast: string };
  local_base_url?: string;
} {
  const prov = getLLMProvider();
  return {
    provider: prov.providerName,
    models: {
      high:   prov.getModelName("high"),
      medium: prov.getModelName("medium"),
      fast:   prov.getModelName("fast"),
    },
    ...(prov.providerName === "local"
      ? { local_base_url: process.env["LOCAL_LLM_BASE_URL"] ?? "http://localhost:11434/v1" }
      : {}),
  };
}
