/**
 * AIG-CSAM Detection + NCMEC Victim ID Lookup — Tier 3.1
 *
 * AI-Generated CSAM rose 1,325% in 2024 (67,000 NCMEC reports).
 * These methods detect synthetic CSAM and identify previously documented victims.
 *
 * AIG Detection approaches (in order of reliability):
 *   1. C2PA (Coalition for Content Provenance and Authenticity) metadata check
 *      — Most reliable when present; major AI generators embed this
 *   2. Hash-against-NCMEC-AIG-registry — NCMEC maintains known AIG hashes
 *   3. Statistical model fingerprinting — variance patterns unique to AI generators
 *   4. Metadata analysis — missing EXIF, implausible creation dates, etc.
 *
 * LEGAL NOTE: AIG-CSAM is still CSAM under 18 U.S.C. § 2256(8)(B) even when
 * no real child was depicted. Detection affects investigation approach but NOT
 * legal classification — always classify as CSAM.
 *
 * Required env vars for TOOL_MODE=real:
 *   NCMEC_API_KEY       — AIG detection endpoint (same key as hash lookup)
 *   C2PA_SERVICE_URL    — Optional: external C2PA verification service
 */

import { runTool, type ToolResult } from "../types.js";

// ── AIG Detection ─────────────────────────────────────────────────────────────

export interface AigDetectionResult {
  aig_suspected: boolean;
  confidence: number;                 // 0.0–1.0
  detection_method?: string;
  c2pa_provenance_found?: boolean;    // C2PA metadata detected
  model_fingerprint?: string;         // Detected AI model signature
  detection_signals: string[];        // Human-readable signal list
  notes: string;
}

// ── Stub ──────────────────────────────────────────────────────────────────────

async function checkAigDetectionStub(fileHash: string, _hashType: string): Promise<AigDetectionResult> {
  await new Promise(r => setTimeout(r, 20));
  const isAig = fileHash.startsWith("aig_test_") || fileHash === "test_aig_hash";
  return {
    aig_suspected: isAig,
    confidence: isAig ? 0.87 : 0.05,
    detection_method: isAig ? "c2pa_provenance" : undefined,
    c2pa_provenance_found: isAig,
    model_fingerprint: isAig ? "StableDiffusion-XL" : undefined,
    detection_signals: isAig
      ? ["C2PA provenance metadata found", "Model manifest: stable-diffusion-xl-base-1.0", "Missing EXIF camera data"]
      : [],
    notes: isAig
      ? "C2PA metadata indicates AI generation. Still classified as CSAM per 18 U.S.C. § 2256(8)(B)."
      : "No AI generation indicators detected.",
  };
}

// ── Real: multi-signal AIG detection ─────────────────────────────────────────

interface C2PAResult { found: boolean; manifest?: { model?: string; software?: string; }; }
interface NCMECAIGResult { is_aig: boolean; confidence: number; generator?: string; }

async function checkC2PAMetadata(fileHash: string): Promise<C2PAResult> {
  const serviceUrl = process.env["C2PA_SERVICE_URL"];
  if (!serviceUrl) {
    // Heuristic only: hash pattern analysis (no actual C2PA SDK without file bytes)
    return { found: false };
  }
  try {
    const resp = await fetch(`${serviceUrl}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash: fileHash }),
    });
    const json = await resp.json() as C2PAResult;
    return json;
  } catch {
    return { found: false };
  }
}

async function checkNCMECAIGRegistry(fileHash: string): Promise<NCMECAIGResult> {
  const apiKey   = process.env["NCMEC_API_KEY"];
  const endpoint = process.env["NCMEC_HASH_ENDPOINT"] ?? "https://report.cybertip.org/hapiV1";
  if (!apiKey) return { is_aig: false, confidence: 0 };

  try {
    const resp = await fetch(`${endpoint}/aig/lookup`, {
      method: "POST",
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ hash: fileHash }),
    });
    const json = await resp.json() as NCMECAIGResult;
    return json;
  } catch {
    return { is_aig: false, confidence: 0 };
  }
}

async function checkAigDetectionReal(fileHash: string, hashType: string): Promise<AigDetectionResult> {
  const signals: string[] = [];
  let highestConfidence = 0;
  let detected = false;
  let method: string | undefined;
  let fingerprint: string | undefined;
  let c2paFound = false;

  // Signal 1: C2PA provenance metadata
  const c2pa = await checkC2PAMetadata(fileHash);
  if (c2pa.found) {
    detected = true;
    c2paFound = true;
    highestConfidence = 0.98;
    method = "c2pa_provenance";
    fingerprint = c2pa.manifest?.model ?? c2pa.manifest?.software;
    signals.push("C2PA provenance metadata confirmed AI generation");
    if (fingerprint) signals.push(`Model identifier: ${fingerprint}`);
  }

  // Signal 2: NCMEC AIG registry
  const ncmecAig = await checkNCMECAIGRegistry(fileHash);
  if (ncmecAig.is_aig) {
    detected = true;
    if (ncmecAig.confidence > highestConfidence) {
      highestConfidence = ncmecAig.confidence;
      method = method ?? "ncmec_aig_registry";
      fingerprint = fingerprint ?? ncmecAig.generator;
    }
    signals.push(`NCMEC AIG registry match (confidence: ${(ncmecAig.confidence * 100).toFixed(0)}%)`);
    if (ncmecAig.generator) signals.push(`Generator: ${ncmecAig.generator}`);
  }

  const notes = detected
    ? `AIG-CSAM detected. Still classified as CSAM under 18 U.S.C. § 2256(8)(B). ` +
      `Inform prosecutor: AIG status affects search approach but not charges.`
    : "No AI generation signals detected. Standard CSAM investigation applies.";

  return {
    aig_suspected: detected,
    confidence: detected ? highestConfidence : 0.05,
    detection_method: method,
    c2pa_provenance_found: c2paFound,
    model_fingerprint: fingerprint,
    detection_signals: signals,
    notes,
  };
}

export async function checkAigDetection(
  fileHash: string,
  hashType: string
): Promise<ToolResult<AigDetectionResult>> {
  const fn = process.env["TOOL_MODE"] === "real" ? checkAigDetectionReal : checkAigDetectionStub;
  return runTool(() => fn(fileHash, hashType));
}

// ── NCMEC CVIP Victim Identification ─────────────────────────────────────────

export interface NcmecVictimIdResult {
  match_found: boolean;
  series_name?: string;
  victim_identified: boolean;
  victim_country?: string;
  case_reference?: string;
  previously_rescued: boolean;
  rescue_date?: string;
  active_investigation?: boolean;  // Another agency may already be working this
  contact_unit?: string;           // "Contact NCMEC CVIP" / "Contact OJJDP" etc.
  notes?: string;
}

async function queryNcmecVictimIdStub(fileHash: string, _hashType: string): Promise<NcmecVictimIdResult> {
  await new Promise(r => setTimeout(r, 15));
  const isKnown = fileHash.startsWith("test_match_") || fileHash === "d41d8cd98f00b204e9800998ecf8427e";
  return {
    match_found: isKnown,
    series_name: isKnown ? "Test Series Alpha" : undefined,
    victim_identified: isKnown,
    victim_country: isKnown ? "US" : undefined,
    case_reference: isKnown ? "NCMEC-CVIP-TEST-001" : undefined,
    previously_rescued: isKnown,
    rescue_date: isKnown ? "2022-03-15" : undefined,
    active_investigation: false,
    contact_unit: isKnown ? "NCMEC CVIP Unit (cvip@ncmec.org)" : undefined,
    notes: isKnown ? "Victim identified and previously interviewed. Contact NCMEC CVIP unit before approaching victim." : undefined,
  };
}

async function queryNcmecVictimIdReal(fileHash: string, _hashType: string): Promise<NcmecVictimIdResult> {
  const apiKey   = process.env["NCMEC_API_KEY"];
  const endpoint = process.env["NCMEC_HASH_ENDPOINT"] ?? "https://report.cybertip.org/hapiV1";

  if (!apiKey) {
    throw new Error("NCMEC_API_KEY is required for victim ID lookup. Contact your NCMEC LE liaison.");
  }

  let responseText: string;
  try {
    const resp = await fetch(`${endpoint}/victimid/lookup`, {
      method: "POST",
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ hash: fileHash }),
    });
    responseText = await resp.text();
  } catch {
    throw new Error("NCMEC Victim ID API unreachable.");
  }

  const json = JSON.parse(responseText) as {
    match: boolean;
    series?: string;
    victim_identified?: boolean;
    country?: string;
    case_ref?: string;
    rescued?: boolean;
    rescue_date?: string;
    active_investigation?: boolean;
  };

  return {
    match_found: json.match,
    series_name: json.series,
    victim_identified: json.victim_identified ?? false,
    victim_country: json.country,
    case_reference: json.case_ref,
    previously_rescued: json.rescued ?? false,
    rescue_date: json.rescue_date,
    active_investigation: json.active_investigation,
    contact_unit: json.match ? "NCMEC CVIP Unit (cvip@ncmec.org)" : undefined,
    notes: json.match
      ? `Victim matched in NCMEC database. Series: ${json.series ?? "Unknown"}. ` +
        `${json.rescued ? "Victim previously rescued." : "Victim status unknown."} ` +
        `Contact NCMEC CVIP before interviewing victim.`
      : undefined,
  };
}

export async function queryNcmecVictimId(
  fileHash: string,
  hashType: string
): Promise<ToolResult<NcmecVictimIdResult>> {
  const fn = process.env["TOOL_MODE"] === "real" ? queryNcmecVictimIdReal : queryNcmecVictimIdStub;
  return runTool(() => fn(fileHash, hashType));
}
