/**
 * LLM Provider Abstraction — Types
 *
 * Provider-agnostic types used by all agents. Agents import from here,
 * never from a specific vendor SDK. The concrete provider is injected
 * at runtime via getLLMProvider() in config.ts.
 *
 * Supported providers:
 *   anthropic  — Claude (Opus / Sonnet / Haiku)
 *   openai     — GPT-4o / GPT-4o-mini
 *   gemini     — Gemini 1.5 Pro / Flash (via OpenAI-compatible endpoint)
 *   local      — Any OpenAI-compatible server (Ollama, LM Studio, vLLM, etc.)
 *   gemma      — Google Gemma models via local Ollama/vLLM (offline/air-gap mode)
 *
 * Model tiers map to provider-specific models:
 *   high   — Opus / GPT-4o / Gemini 1.5 Pro   — used by: Legal Gate, Classifier, Priority
 *   medium — Sonnet / GPT-4o-mini / Flash       — used by: Linker
 *   fast   — Haiku / GPT-4o-mini / Flash        — used by: Intake, Extraction, Hash OSINT
 */

// ── Tool definition (provider-agnostic, matches Anthropic format internally) ──

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ── Model tier ────────────────────────────────────────────────────────────────

/** Role-based model selection — agents specify intent, not model names. */
export type ModelRole = "high" | "medium" | "fast";

// ── Agent call options ────────────────────────────────────────────────────────

export interface AgentCallOptions {
  /** Model quality tier. "high" = most capable, "fast" = quickest/cheapest. */
  role: ModelRole;

  /** System prompt for this agent. */
  system: string;

  /** User message (tip content, analysis request, etc.). */
  userMessage: string;

  /** Tools available to the model. If omitted, no tool use occurs. */
  tools?: ToolDefinition[];

  /**
   * Executes a tool call and returns the result.
   * Required when tools are provided.
   */
  executeToolCall?: (
    name: string,
    input: Record<string, unknown>
  ) => Promise<unknown>;

  /** Max output tokens. Default: 2048. */
  maxTokens?: number;

  /**
   * Max agentic loop iterations before giving up.
   * Default: 10. Prevents infinite loops.
   */
  maxIterations?: number;

  /**
   * Require the model to call a tool on the FIRST turn.
   * Equivalent to Anthropic's tool_choice: { type: "required" }.
   * Supported by Anthropic and OpenAI. Falls back to "auto" for others.
   */
  requireToolUse?: boolean;

  /**
   * Timeout in milliseconds for each individual LLM API call.
   * Default: 90000 (90s). Prevents pipeline stalls on hung connections.
   */
  timeoutMs?: number;
}

// ── Provider interface ────────────────────────────────────────────────────────

export interface LLMProvider {
  /**
   * Run an agent call (with optional agentic tool-use loop).
   * Returns the final text response after all tool calls complete.
   * Throws on unrecoverable error — caller handles retries.
   */
  runAgent(opts: AgentCallOptions): Promise<string>;

  /** Resolve model name for a given role (useful for audit logging). */
  getModelName(role: ModelRole): string;

  /** Provider identifier for logs and audit trail. */
  readonly providerName: string;
}

// ── Provider names ────────────────────────────────────────────────────────────

export type ProviderName = "anthropic" | "openai" | "gemini" | "local" | "gemma";
