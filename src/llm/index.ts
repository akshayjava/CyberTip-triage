/**
 * LLM Provider — Public API
 *
 * Agents import from here. Never import from a vendor SDK directly.
 *
 * Usage:
 *   import { getLLMProvider, type AgentCallOptions } from "../llm/index.js";
 *
 *   const text = await getLLMProvider().runAgent({
 *     role: "high",
 *     system: MY_SYSTEM_PROMPT,
 *     userMessage: buildContext(tip),
 *     tools: [TOOL_DEFINITIONS.check_deconfliction],
 *     executeToolCall: handleToolCall,
 *   });
 */

export { getLLMProvider, resetLLMProvider, validateLLMConfig, getLLMConfigSummary } from "./config.js";
export type { LLMProvider, AgentCallOptions, ModelRole, ToolDefinition, ProviderName } from "./types.js";
