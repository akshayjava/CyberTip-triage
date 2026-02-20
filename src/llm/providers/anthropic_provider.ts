/**
 * Anthropic Provider
 *
 * Implements LLMProvider using the Anthropic SDK.
 * Handles the Claude-specific agentic loop format:
 *   - tool_use content blocks in assistant turn
 *   - tool_result blocks in user turn
 *   - stop_reason === "tool_use" check
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, AgentCallOptions, ModelRole, ToolDefinition } from "../types.js";

// Default model strings — overridable via env vars
const DEFAULT_MODELS: Record<ModelRole, string> = {
  high:   process.env["LLM_MODEL_HIGH"]   ?? "claude-opus-4-6",
  medium: process.env["LLM_MODEL_MEDIUM"] ?? "claude-sonnet-4-6",
  fast:   process.env["LLM_MODEL_FAST"]   ?? "claude-haiku-4-5-20251001",
};

export class AnthropicProvider implements LLMProvider {
  readonly providerName = "anthropic";

  private readonly client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env["ANTHROPIC_API_KEY"],
    });
  }

  getModelName(role: ModelRole): string {
    return DEFAULT_MODELS[role];
  }

  async runAgent(opts: AgentCallOptions): Promise<string> {
    const {
      role,
      system,
      userMessage,
      tools,
      executeToolCall,
      maxTokens = 2048,
      maxIterations = 10,
      requireToolUse = false,
      timeoutMs = 90_000,
    } = opts;

    const model = this.getModelName(role);
    const anthropicTools: Anthropic.Tool[] | undefined = tools?.map(toAnthropicTool);

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userMessage },
    ];

    // First call — optionally require tool use
    let response = await withTimeout(
      this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages,
        ...(anthropicTools ? { tools: anthropicTools } : {}),
        ...(requireToolUse && anthropicTools
          ? { tool_choice: { type: "required" } }
          : anthropicTools
          ? { tool_choice: { type: "auto" } }
          : {}),
      }),
      timeoutMs,
      `Anthropic ${model} (${role}) timed out after ${timeoutMs}ms`
    );

    // Agentic loop
    let iterations = 0;
    while (response.stop_reason === "tool_use" && iterations < maxIterations) {
      iterations++;

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      // Execute all tool calls (in parallel where safe)
      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (block) => {
          let resultContent: string;
          try {
            const result = executeToolCall
              ? await executeToolCall(block.name, block.input as Record<string, unknown>)
              : { error: "No tool executor provided" };
            resultContent = JSON.stringify(result);
          } catch (err) {
            resultContent = JSON.stringify({ error: String(err) });
          }
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: resultContent,
          };
        })
      );

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });

      response = await withTimeout(
        this.client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages,
          ...(anthropicTools ? { tools: anthropicTools, tool_choice: { type: "auto" } } : {}),
        }),
        timeoutMs,
        `Anthropic ${model} tool-loop timed out at iteration ${iterations}`
      );
    }

    // Extract final text
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (!text.trim()) {
      throw new Error(`Anthropic ${model}: no text in final response (stop_reason=${response.stop_reason})`);
    }

    return text.trim();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert generic ToolDefinition to Anthropic.Tool format. */
function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  };
}

/** Race a promise against a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(label)), ms)
    ),
  ]);
}
