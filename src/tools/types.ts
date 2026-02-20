/**
 * Shared types for all tool implementations.
 * Every tool returns ToolResult<T> — never throws directly.
 */

export interface ToolResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  latency_ms: number;
}

/** Input from Anthropic tool_use content block */
export interface ToolCallInput {
  name: string;
  input: Record<string, unknown>;
}

/** Helper to time a tool call and wrap it in ToolResult */
export async function runTool<T>(
  fn: () => Promise<T>
): Promise<ToolResult<T>> {
  const start = Date.now();
  try {
    const data = await fn();
    return { success: true, data, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - start,
    };
  }
}
