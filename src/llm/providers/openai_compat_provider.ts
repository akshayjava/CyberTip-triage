/**
 * OpenAI-Compatible Provider
 *
 * Uses native fetch — no SDK dependency required.
 * Works with any server that speaks the OpenAI chat completions API:
 *
 *   openai  — https://api.openai.com/v1
 *   gemini  — https://generativelanguage.googleapis.com/v1beta/openai/
 *   local   — http://localhost:11434/v1  (Ollama)
 *             http://localhost:1234/v1   (LM Studio)
 *             http://host:8000/v1        (vLLM)
 *             http://localhost:1337/v1   (Jan)
 *
 * tool_choice "required" is supported on OpenAI only; falls back to "auto"
 * on Gemini and local models. Local models without tool-call support should
 * set TOOL_MODE=stub to bypass real tool calls.
 */

import type { LLMProvider, AgentCallOptions, ModelRole, ToolDefinition } from "../types.js";

// ── Minimal OpenAI REST types (no SDK needed) ─────────────────────────────────

interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: OAIToolCall[];
}

interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OAIResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: OAIToolCall[];
    };
    finish_reason: string;
  }>;
}

// ── Model defaults ────────────────────────────────────────────────────────────

const DEFAULT_MODELS: Record<"openai" | "gemini" | "local", Record<ModelRole, string>> = {
  openai: { high: "gpt-4o",         medium: "gpt-4o-mini",      fast: "gpt-4o-mini" },
  gemini: { high: "gemini-1.5-pro", medium: "gemini-1.5-flash", fast: "gemini-1.5-flash" },
  local: {
    high:   process.env["LOCAL_MODEL_HIGH"]   ?? "llama3.1:70b",
    medium: process.env["LOCAL_MODEL_MEDIUM"] ?? "llama3.1:8b",
    fast:   process.env["LOCAL_MODEL_FAST"]   ?? "llama3.1:8b",
  },
};

const BASE_URLS: Record<"openai" | "gemini" | "local", string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  local:  process.env["LOCAL_LLM_BASE_URL"] ?? "http://localhost:11434/v1",
};

export type OpenAICompatBackend = "openai" | "gemini" | "local";

export class OpenAICompatProvider implements LLMProvider {
  readonly providerName: string;
  private readonly backend: OpenAICompatBackend;
  private readonly modelMap: Record<ModelRole, string>;
  private readonly baseURL: string;
  private readonly apiKey: string;

  constructor(backend: OpenAICompatBackend) {
    this.backend = backend;
    this.providerName = backend;
    this.baseURL = BASE_URLS[backend];
    this.modelMap = {
      high:   process.env["LLM_MODEL_HIGH"]   ?? DEFAULT_MODELS[backend].high,
      medium: process.env["LLM_MODEL_MEDIUM"] ?? DEFAULT_MODELS[backend].medium,
      fast:   process.env["LLM_MODEL_FAST"]   ?? DEFAULT_MODELS[backend].fast,
    };
    if (backend === "openai") {
      this.apiKey = process.env["OPENAI_API_KEY"] ?? "";
    } else if (backend === "gemini") {
      this.apiKey = process.env["GEMINI_API_KEY"] ?? "";
    } else {
      this.apiKey = process.env["LOCAL_LLM_API_KEY"] ?? "ollama";
    }
  }

  getModelName(role: ModelRole): string {
    return this.modelMap[role];
  }

  async runAgent(opts: AgentCallOptions): Promise<string> {
    const {
      role, system, userMessage, tools, executeToolCall,
      maxTokens = 2048, maxIterations = 10,
      requireToolUse = false, timeoutMs = 90_000,
    } = opts;

    const model = this.getModelName(role);
    const openaiTools = tools?.map(toOpenAITool);
    const supportsRequired = this.backend === "openai";

    const messages: OAIMessage[] = [
      { role: "system", content: system },
      { role: "user",   content: userMessage },
    ];

    let response = await this.callAPI(model, messages, maxTokens, openaiTools, {
      toolChoice: requireToolUse && supportsRequired ? "required" : "auto",
      timeoutMs,
    });

    let iterations = 0;
    while (
      response.choices[0]?.finish_reason === "tool_calls" &&
      iterations < maxIterations
    ) {
      iterations++;
      const assistantMsg = response.choices[0].message;
      const toolCalls = assistantMsg.tool_calls ?? [];

      messages.push({ role: "assistant", content: assistantMsg.content, tool_calls: toolCalls });

      for (const tc of toolCalls) {
        let resultContent: string;
        try {
          const input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          const result = executeToolCall
            ? await executeToolCall(tc.function.name, input)
            : { error: "No tool executor provided" };
          resultContent = JSON.stringify(result);
        } catch (err) {
          resultContent = JSON.stringify({ error: String(err) });
        }
        messages.push({ role: "tool", tool_call_id: tc.id, content: resultContent });
      }

      response = await this.callAPI(model, messages, maxTokens, openaiTools, {
        toolChoice: "auto", timeoutMs,
      });
    }

    const text = response.choices[0]?.message?.content ?? "";
    if (!text.trim()) {
      throw new Error(
        `${this.backend} ${model}: empty response (finish_reason=${response.choices[0]?.finish_reason})`
      );
    }
    return text.trim();
  }

  private async callAPI(
    model: string,
    messages: OAIMessage[],
    maxTokens: number,
    tools: Array<{ type: "function"; function: { name: string; description: string; parameters: unknown } }> | undefined,
    opts: { toolChoice: string; timeoutMs: number }
  ): Promise<OAIResponse> {
    const body: Record<string, unknown> = { model, max_tokens: maxTokens, messages };
    if (tools && tools.length > 0) {
      body["tools"] = tools;
      body["tool_choice"] = opts.toolChoice;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const res = await fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`${this.backend} API error ${res.status}: ${errText.slice(0, 200)}`);
      }

      return await res.json() as OAIResponse;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`${this.backend} ${model} timed out after ${opts.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toOpenAITool(tool: ToolDefinition): {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
} {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  };
}
