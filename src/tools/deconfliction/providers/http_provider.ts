import { DeconflictionProvider, DeconflictionResult } from "../types.js";

/**
 * Generic HTTP implementation for integrating with real agency systems
 * (e.g., RISSafe, HIDTA) via a proxy or direct API if compatible.
 */
export class HttpDeconflictionProvider implements DeconflictionProvider {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async check(identifierType: string, value: string, jurisdiction: string): Promise<DeconflictionResult> {
    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
        "User-Agent": "CyberTip-Triage-System/1.0",
      },
      body: JSON.stringify({
        identifierType,
        value,
        jurisdiction,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Deconfliction API error (${response.status}): ${errorText}`
      );
    }

    const data = await response.json();

    // Validate response has required fields or map them
    // Assuming the API returns a compatible structure for now.
    // In a real deployment, an adapter layer might be needed here.
    return data as DeconflictionResult;
  }
}
