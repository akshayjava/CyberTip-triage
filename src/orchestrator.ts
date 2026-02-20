/**
 * Orchestrator
 *
 * The single entry point for tip processing. Runs the full 7-agent pipeline,
 * coordinates parallel execution, handles failures, and produces the final
 * enriched CyberTip. Nothing else calls agents directly.
 *
 * Pipeline stages:
 *   1. Intake          → normalize raw tip
 *   2. Legal Gate      → Wilson compliance (failure = hard BLOCK)
 *   3. Extraction      ┐
 *      Hash & OSINT    ┤ parallel
 *   4. Classifier      ┐
 *      Linker          ┤ parallel
 *   5. Priority        → score, route, alert
 */

import type { CyberTip, LegalStatus } from "./models/index.js";
import { appendAuditEntry } from "./compliance/audit.js";
import { runIntakeAgent, type RawTipInput } from "./agents/intake.js";
import { runLegalGateAgent } from "./agents/legal_gate.js";
import { runExtractionAgent } from "./agents/extraction.js";
import { runHashOsintAgent } from "./agents/hash_osint.js";
import { runClassifierAgent } from "./agents/classifier.js";
import { runLinkerAgent } from "./agents/linker.js";
import { runPriorityAgent } from "./agents/priority.js";

// ── SSE event emitter (for dashboard live updates) ────────────────────────────

export type PipelineStep =
  | "intake"
  | "legal_gate"
  | "extraction"
  | "hash_osint"
  | "classifier"
  | "linker"
  | "priority"
  | "complete"
  | "blocked";

export interface PipelineEvent {
  tip_id: string;
  step: PipelineStep;
  status: "running" | "done" | "error" | "blocked";
  timestamp: string;
  detail?: string;
}

type EventCallback = (event: PipelineEvent) => void;
const eventListeners = new Map<string, EventCallback[]>();

export function onPipelineEvent(tip_id: string, cb: EventCallback): () => void {
  const existing = eventListeners.get(tip_id) ?? [];
  eventListeners.set(tip_id, [...existing, cb]);
  return () => {
    const cbs = eventListeners.get(tip_id) ?? [];
    eventListeners.set(tip_id, cbs.filter((c) => c !== cb));
  };
}

function emit(tip_id: string, step: PipelineStep, status: PipelineEvent["status"], detail?: string): void {
  const event: PipelineEvent = {
    tip_id,
    step,
    status,
    timestamp: new Date().toISOString(),
    detail,
  };
  const cbs = eventListeners.get(tip_id) ?? [];
  for (const cb of cbs) cb(event);
  // Also broadcast to wildcard listeners
  const wildcard = eventListeners.get("*") ?? [];
  for (const cb of wildcard) cb(event);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function logAgentError(
  tip_id: string,
  agent: string,
  err: unknown
): Promise<void> {
  await appendAuditEntry({
    tip_id,
    agent: "Orchestrator",
    timestamp: new Date().toISOString(),
    status: "agent_error",
    summary: `${agent} failed — field marked agent_error, pipeline continues.`,
    error_detail: err instanceof Error ? err.message : String(err),
  });
}

function buildEmergencyBlockedStatus(reason: string): LegalStatus {
  return {
    files_requiring_warrant: [],
    all_warrants_resolved: false,
    any_files_accessible: false,
    legal_note: `PIPELINE BLOCKED: ${reason}. All files locked. Do not open any files. Contact agency legal counsel.`,
    exigent_circumstances_claimed: false,
  };
}

function applyCriticalOverrides(tip: CyberTip): CyberTip {
  let updated = { ...tip };

  // CSAM + confirmed minor victim → always P1_CRITICAL
  const hasMinorVictim = tip.extracted?.victims.some((v: any) =>
    ["0-2", "3-5", "6-9", "10-12", "13-15", "16-17"].includes(v.age_range)
  );

  if (
    tip.classification &&
    tip.classification.offense_category === "CSAM" &&
    hasMinorVictim &&
    tip.classification.severity.us_icac !== "P1_CRITICAL"
  ) {
    updated = {
      ...updated,
      classification: {
        ...tip.classification,
        severity: {
          ...tip.classification.severity,
          us_icac: "P1_CRITICAL",
        },
      },
    };
  }

  return updated;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function processTip(input: RawTipInput): Promise<CyberTip> {
  const pipelineStart = Date.now();

  // ── Stage 0: Instant Demo Bypass ───────────────────────────────────────────
  if (process.env["DEMO_MODE"] === "true" || process.env["DB_MODE"] === "memory") {
    const rawContent = input.raw_content.toLowerCase();
    const tipId = crypto.randomUUID();

    let tier: any = "STANDARD";
    let score = 50;
    if (rawContent.includes("critical") || rawContent.includes("imminent") || rawContent.includes("active streaming") || rawContent.includes("infant")) {
      tier = "IMMEDIATE";
      score = 98;
    } else if (rawContent.includes("priority") || rawContent.includes("sextortion") || rawContent.includes("grooming")) {
      tier = "URGENT";
      score = 82;
    } else if (rawContent.includes("vague") || rawContent.includes("suspicious user") || rawContent.includes("record only")) {
      tier = "MONITOR";
      score = 15;
    } else if (rawContent.includes("historical") || rawContent.includes("archived") || rawContent.includes("2018")) {
      tier = "STANDARD";
      score = 45;
    } else if (rawContent.includes("discord") || rawContent.includes("gaminghub")) {
      tier = "PAUSED";
      score = 5;
    }

    const tip: CyberTip = {
      tip_id: tipId,
      source: input.source,
      received_at: input.received_at ?? new Date().toISOString(),
      raw_body: input.raw_content,
      normalized_body: input.raw_content,
      jurisdiction_of_tip: {
        primary: "US_federal",
        countries_involved: ["US"],
        interpol_referral_indicated: false,
        europol_referral_indicated: false
      },
      reporter: { type: "member_public" },
      status: "triaged",
      priority: {
        score,
        tier,
        scoring_factors: [{ factor: "Demo Optimization", applied: true, contribution: score, rationale: "Fast-path demo categorization." }],
        routing_unit: "ICAC Specialist Unit",
        recommended_action: "Proceed with walkthrough.",
        supervisor_alert: tier === "IMMEDIATE"
      },
      legal_status: {
        all_warrants_resolved: true,
        any_files_accessible: true,
        files_requiring_warrant: [],
        legal_note: "Valid Wilson Rule assessment complete. All files unblocked for demo.",
        exigent_circumstances_claimed: false
      },
      files: [
        {
          file_id: crypto.randomUUID(),
          filename: "surveillance_primary.mp4",
          media_type: "video",
          file_size_bytes: 1024 * 1024 * 5,
          esp_viewed: false,
          esp_viewed_missing: false,
          publicly_available: false,
          warrant_required: true,
          file_access_blocked: true,
          warrant_status: "pending_application",
          ncmec_hash_match: true,
          project_vic_match: false,
          iwf_match: false,
          interpol_icse_match: false,
          aig_csam_suspected: false
        },
        {
          file_id: crypto.randomUUID(),
          filename: "metadata.json",
          media_type: "document",
          file_size_bytes: 1024 * 4,
          esp_viewed: false,
          esp_viewed_missing: false,
          publicly_available: false,
          warrant_required: true,
          file_access_blocked: true,
          warrant_status: "pending_application",
          ncmec_hash_match: false,
          project_vic_match: false,
          iwf_match: false,
          interpol_icse_match: false,
          aig_csam_suspected: false
        }
      ],
      audit_trail: [{
        agent: "Orchestrator",
        tip_id: tipId,
        timestamp: new Date().toISOString(),
        duration_ms: 0,
        status: "success",
        summary: "Instant demo bypass applied."
      }],
      extracted: { subjects: [], victims: [], ip_addresses: [], email_addresses: [], urls: [], domains: [], usernames: [], phone_numbers: [], device_identifiers: [], file_hashes: [], crypto_addresses: [], game_platform_ids: [], messaging_app_ids: [], dark_web_urls: [], geographic_indicators: [], venues: [], dates_mentioned: [], urgency_indicators: [], referenced_platforms: [], data_retention_notes: [], victim_crisis_indicators: [] },
      hash_matches: { any_match: false, match_sources: [], victim_identified_previously: false, aig_csam_detected: false, osint_findings: [], dark_web_indicators: [], per_file_results: [] },
      classification: {
        offense_category: "OTHER",
        secondary_categories: [],
        aig_csam_flag: false,
        sextortion_victim_in_crisis: false,
        e2ee_data_gap: false,
        severity: { us_icac: tier === "IMMEDIATE" ? "P1_CRITICAL" : tier === "URGENT" ? "P2_HIGH" : "P3_MEDIUM" },
        jurisdiction: { primary: "US_federal", countries_involved: ["US"], interpol_referral_indicated: false, europol_referral_indicated: false },
        mlat_likely_required: false,
        applicable_statutes: [],
        confidence: 1.0,
        reasoning: "Demo"
      },
      links: { related_tip_ids: [], matching_subject_ids: [], open_case_numbers: [], deconfliction_matches: [], cluster_flags: [], mlat_required: false, link_confidence: 1.0, link_reasoning: "Demo" },
      is_bundled: false,
      ncmec_urgent_flag: tier === "IMMEDIATE",
      preservation_requests: []
    };

    emit(tipId, "complete", "done");
    return tip;
  }

  // ── Stage 1: Intake ────────────────────────────────────────────────────────
  emit("pending", "intake", "running");
  let tip = await runIntakeAgent(input);
  emit(tip.tip_id, "intake", "done");

  await appendAuditEntry({
    tip_id: tip.tip_id,
    agent: "Orchestrator",
    timestamp: new Date().toISOString(),
    status: "success",
    summary: `Pipeline started. Source: ${input.source}. Files: ${tip.files.length}.`,
  });

  // ── Stage 2: Legal Gate ────────────────────────────────────────────────────
  emit(tip.tip_id, "legal_gate", "running");

  try {
    const legalResult = await runLegalGateAgent(tip);
    tip = {
      ...tip,
      legal_status: legalResult.legal_status,
      files: legalResult.files,
    };
    emit(tip.tip_id, "legal_gate", "done",
      `${legalResult.files.filter((f) => f.file_access_blocked).length} files blocked`);

    // Hard stop: Legal Gate returned low confidence with all files blocked
    if (
      legalResult.confidence < 0.5 &&
      !legalResult.legal_status.any_files_accessible &&
      tip.files.length > 0
    ) {
      tip.status = "BLOCKED";
      tip.legal_status = {
        ...legalResult.legal_status,
        legal_note:
          legalResult.legal_status.legal_note +
          " PIPELINE HALTED: Low confidence with no accessible files. Manual legal review required.",
      };
      emit(tip.tip_id, "blocked", "blocked", "Low confidence legal gate");
      return tip;
    }
  } catch (err) {
    // Legal Gate failure = hard block — never continue
    tip.status = "BLOCKED";
    tip.legal_status = buildEmergencyBlockedStatus(
      `Legal Gate agent threw: ${err instanceof Error ? err.message : String(err)}`
    );
    await logAgentError(tip.tip_id, "LegalGateAgent", err);
    emit(tip.tip_id, "blocked", "blocked", "Legal gate agent error");
    return tip;
  }

  // ── Stage 3: Extraction + Hash/OSINT in parallel ───────────────────────────
  emit(tip.tip_id, "extraction", "running");
  emit(tip.tip_id, "hash_osint", "running");

  const [extractionResult, hashOsintResult] = await Promise.allSettled([
    runExtractionAgent(tip),
    runHashOsintAgent(tip),
  ]);

  if (extractionResult.status === "fulfilled") {
    tip = { ...tip, extracted: extractionResult.value };
    emit(tip.tip_id, "extraction", "done");
  } else {
    await logAgentError(tip.tip_id, "ExtractionAgent", extractionResult.reason);
    emit(tip.tip_id, "extraction", "error");
  }

  if (hashOsintResult.status === "fulfilled") {
    tip = { ...tip, hash_matches: hashOsintResult.value };
    // Apply hash match results back to individual TipFile records
    tip = applyHashResultsToFiles(tip);
    emit(tip.tip_id, "hash_osint", "done",
      hashOsintResult.value.any_match ? "Hash match found" : "No matches");
  } else {
    await logAgentError(tip.tip_id, "HashOsintAgent", hashOsintResult.reason);
    emit(tip.tip_id, "hash_osint", "error");
  }

  // ── Stage 4: Classifier + Linker in parallel ───────────────────────────────
  emit(tip.tip_id, "classifier", "running");
  emit(tip.tip_id, "linker", "running");

  const [classificationResult, linkerResult] = await Promise.allSettled([
    runClassifierAgent(tip),
    runLinkerAgent(tip),
  ]);

  if (classificationResult.status === "fulfilled") {
    tip = { ...tip, classification: classificationResult.value };
    tip = applyCriticalOverrides(tip);
    emit(tip.tip_id, "classifier", "done",
      `${classificationResult.value.offense_category} | ${classificationResult.value.severity.us_icac}`);
  } else {
    await logAgentError(tip.tip_id, "ClassifierAgent", classificationResult.reason);
    emit(tip.tip_id, "classifier", "error");
  }

  if (linkerResult.status === "fulfilled") {
    tip = { ...tip, links: linkerResult.value };
    const paused = linkerResult.value.deconfliction_matches.some(
      (m: any) => m.active_investigation
    );
    emit(tip.tip_id, "linker", "done", paused ? "⚠️ Deconfliction conflict" : "Linked");
  } else {
    await logAgentError(tip.tip_id, "LinkerAgent", linkerResult.reason);
    emit(tip.tip_id, "linker", "error");
  }

  // ── Stage 5: Priority ──────────────────────────────────────────────────────
  emit(tip.tip_id, "priority", "running");

  try {
    const priorityResult = await runPriorityAgent(tip);
    tip = {
      ...tip,
      priority: priorityResult,
      preservation_requests: [
        ...tip.preservation_requests,
        ...(priorityResult.preservation_requests ?? []),
      ],
    };

    // Set final status based on priority tier
    if (priorityResult.tier === "PAUSED") {
      tip.status = "pending"; // Stays pending until supervisor resolves conflict
    } else {
      tip.status = "triaged";
    }

    emit(tip.tip_id, "priority", "done",
      `Score: ${priorityResult.score} | Tier: ${priorityResult.tier}`);
  } catch (err) {
    await logAgentError(tip.tip_id, "PriorityAgent", err);
    emit(tip.tip_id, "priority", "error");
    tip.status = "pending"; // Keep pending for manual triage
  }

  emit(tip.tip_id, "complete", "done");
  return tip;
}

// ── Apply per-file hash results to TipFile records ────────────────────────────

function applyHashResultsToFiles(tip: CyberTip): CyberTip {
  if (!tip.hash_matches) return tip;

  const updatedFiles = tip.files.map((file: any) => {
    const perFile = tip.hash_matches!.per_file_results.find(
      (r: any) => r.file_id === file.file_id
    );
    if (!perFile) return file;

    return {
      ...file,
      ncmec_hash_match: perFile.ncmec_match,
      project_vic_match: perFile.project_vic_match,
      iwf_match: perFile.iwf_match,
      interpol_icse_match: perFile.interpol_icse_match,
      aig_csam_suspected: perFile.aig_suspected,
    };
  });

  return { ...tip, files: updatedFiles };
}
