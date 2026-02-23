import { runTool, type ToolResult } from "../types.js";
import type { DeconflictionResult, DeconflictionProvider } from "./types.js";
import { StubDeconflictionProvider } from "./providers/stub_provider.js";
import { HttpDeconflictionProvider } from "./providers/http_provider.js";

// Re-export for compatibility
export type { DeconflictionResult };

function getProvider(): DeconflictionProvider {
  const toolMode = process.env["TOOL_MODE"];
  const apiUrl = process.env["DECONFLICTION_API_URL"];
  const apiKey = process.env["DECONFLICTION_API_KEY"];

  // Explicit real mode requires configuration
  if (toolMode === "real") {
    if (!apiUrl || !apiKey) {
      throw new Error(
        "De-confliction real implementation requires DECONFLICTION_API_URL and DECONFLICTION_API_KEY environment variables. " +
        "Please configure these for your regional system (e.g., RISSafe, HIDTA)."
      );
    }
    return new HttpDeconflictionProvider(apiUrl, apiKey);
  }

  // Implicit real mode if configured and not explicitly mocked
  if (apiUrl && apiKey && toolMode !== "mock") {
    return new HttpDeconflictionProvider(apiUrl, apiKey);
  }

  // Default to stub
  return new StubDeconflictionProvider();
}

export async function checkDeconfliction(
  identifierType: string,
  value: string,
  jurisdiction: string
): Promise<ToolResult<DeconflictionResult>> {
  return runTool(async () => {
    const provider = getProvider();
    return provider.check(identifierType, value, jurisdiction);
  });
}
