/**
 * Tools barrel — exports everything agents need.
 *
 * Tool definitions (TOOL_DEFINITIONS) are the exact objects passed to the
 * Anthropic API `tools` parameter. Each agent imports only the tools it uses.
 *
 * handleToolCall() is the central dispatcher — the agentic loop calls this
 * with the tool name and input from the API response.
 */

export * from "./types.js";
export * from "./preservation/esp_retention.js";
export * from "./database/search_case_database.js";
export * from "./legal/warrant_tools.js";
export * from "./hash/check_watchlists.js";
export * from "./hash/aig_and_victim_id.js";
export * from "./deconfliction/check_deconfliction.js";
export * from "./preservation/generate_preservation_request.js";
export * from "./alerts/alert_tools.js";
export * from "./routing/route_interpol_referral.js";

// ── Tool Definitions ─────────────────────────────────────────────────────────
// Provider-agnostic. Each provider converts to its native format at call time.

import type { ToolDefinition } from "../llm/types.js";

export const TOOL_DEFINITIONS = {

  get_warrant_status: {
    name: "get_warrant_status",
    description:
      "Retrieve the current warrant application status for a specific file within a tip. " +
      "Called by Legal Gate Agent to check if a warrant was already obtained since the tip arrived.",
    input_schema: {
      type: "object" as const,
      properties: {
        tip_id: { type: "string", description: "UUID of the tip" },
        file_id: { type: "string", description: "UUID of the file" },
      },
      required: ["tip_id", "file_id"],
    },
  } satisfies ToolDefinition,

  update_warrant_status: {
    name: "update_warrant_status",
    description:
      "Record that a warrant has been applied for, granted, or denied for a file. " +
      "Only called after human investigator action — never automated.",
    input_schema: {
      type: "object" as const,
      properties: {
        tip_id: { type: "string" },
        file_id: { type: "string" },
        status: { type: "string", enum: ["applied", "granted", "denied"] },
        warrant_number: { type: "string" },
        granted_by: { type: "string", description: "Judge/magistrate name" },
      },
      required: ["tip_id", "file_id", "status"],
    },
  } satisfies ToolDefinition,

  check_watchlists: {
    name: "check_watchlists",
    description:
      "Check a hash, IP, or identifier against law enforcement watchlists: " +
      "NCMEC hash database, Project VIC, IWF Contraband Filter, Interpol ICSE, " +
      "Tor exit node list, sex offender registries.",
    input_schema: {
      type: "object" as const,
      properties: {
        lookup_type: {
          type: "string",
          enum: [
            "hash_exact", "hash_photodna", "name", "sex_offender",
            "ip_blocklist", "tor_exit_node", "project_vic", "iwf",
            "interpol_icse", "crypto_address",
          ],
        },
        value: { type: "string" },
        hash_type: {
          type: "string",
          enum: ["md5", "sha1", "sha256", "photodna"],
          description: "Required for hash lookups",
        },
      },
      required: ["lookup_type", "value"],
    },
  } satisfies ToolDefinition,

  check_deconfliction: {
    name: "check_deconfliction",
    description:
      "Query the regional de-confliction system for active investigations overlapping " +
      "with the given identifier. CRITICAL: if a match is found, tip must be PAUSED " +
      "and routed to supervisor before any investigative action.",
    input_schema: {
      type: "object" as const,
      properties: {
        identifier_type: {
          type: "string",
          enum: ["subject_name", "ip", "email", "phone", "username", "case_number", "hash"],
        },
        value: { type: "string" },
        jurisdiction: {
          type: "string",
          description: "ISO 3166-1 alpha-2 or US 2-letter state",
        },
      },
      required: ["identifier_type", "value", "jurisdiction"],
    },
  } satisfies ToolDefinition,

  check_aig_detection: {
    name: "check_aig_detection",
    description:
      "Query AI-generated content detection (C2PA provenance, model fingerprinting) " +
      "for a file hash. AIG-CSAM is still illegal CSAM — this flag is informational only, " +
      "never a severity reducer.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_hash: { type: "string" },
        hash_type: { type: "string", enum: ["md5", "sha1", "sha256", "photodna"] },
      },
      required: ["file_hash", "hash_type"],
    },
  } satisfies ToolDefinition,

  query_ncmec_victim_id: {
    name: "query_ncmec_victim_id",
    description:
      "Check if a file hash matches a known victim series in NCMEC's Child Victim " +
      "Identification Program (CVIP). Returns series name and whether victim was rescued.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_hash: { type: "string" },
        hash_type: { type: "string", enum: ["md5", "sha1", "sha256", "photodna"] },
      },
      required: ["file_hash", "hash_type"],
    },
  } satisfies ToolDefinition,

  generate_preservation_request: {
    name: "generate_preservation_request",
    description:
      "Create a draft evidence preservation request letter for an ESP. " +
      "US tips: 18 U.S.C. § 2703(f). International: Budapest Convention Article 16. " +
      "DRAFT ONLY — requires human approval before sending.",
    input_schema: {
      type: "object" as const,
      properties: {
        esp_name: { type: "string" },
        account_identifiers: {
          type: "array",
          items: { type: "string" },
          description: "Email addresses, usernames, account IDs to preserve",
        },
        jurisdiction: { type: "string" },
        tip_id: { type: "string" },
        retention_deadline: {
          type: "string",
          description: "ISO 8601 date — when ESP data is estimated to expire",
        },
      },
      required: ["esp_name", "account_identifiers", "jurisdiction", "tip_id"],
    },
  } satisfies ToolDefinition,

  alert_supervisor: {
    name: "alert_supervisor",
    description:
      "Send an immediate alert to the duty supervisor. Used for IMMEDIATE-tier tips " +
      "and de-confliction pauses. No PII in summary beyond what's necessary.",
    input_schema: {
      type: "object" as const,
      properties: {
        tip_id: { type: "string" },
        category: { type: "string" },
        score: { type: "number" },
        recommended_action: { type: "string" },
        summary: { type: "string", description: "≤ 3 sentences plain English" },
        is_deconfliction_pause: { type: "boolean" },
      },
      required: ["tip_id", "category", "score", "recommended_action", "summary"],
    },
  } satisfies ToolDefinition,

  send_victim_crisis_alert: {
    name: "send_victim_crisis_alert",
    description:
      "Send a victim crisis alert (separate from investigative queue) when " +
      "sextortion_victim_in_crisis is true for a minor. Routes to supervisor + victim services.",
    input_schema: {
      type: "object" as const,
      properties: {
        tip_id: { type: "string" },
        victim_description: { type: "string" },
        crisis_indicators: { type: "array", items: { type: "string" } },
        platform: { type: "string" },
        recommended_action: { type: "string" },
      },
      required: ["tip_id", "victim_description", "crisis_indicators", "platform"],
    },
  } satisfies ToolDefinition,

  search_case_database: {
    name: "search_case_database",
    description:
      "Query the case database for prior tips and subjects matching given entities.",
    input_schema: {
      type: "object" as const,
      properties: {
        entity_type: {
          type: "string",
          enum: ["ip", "email", "username", "name", "hash", "phone", "domain", "tip_id", "case_number", "crypto_address"],
        },
        entity_value: { type: "string" },
        fuzzy: { type: "boolean", default: false },
        date_range_days: { type: "integer", default: 365 },
      },
      required: ["entity_type", "entity_value"],
    },
  } satisfies ToolDefinition,

  route_interpol_referral: {
    name: "route_interpol_referral",
    description:
      "Generate a draft referral package for Interpol routing via NCMEC international liaison. " +
      "Requires supervisor approval before submission.",
    input_schema: {
      type: "object" as const,
      properties: {
        tip_id: { type: "string" },
        countries_involved: { type: "array", items: { type: "string" } },
        urgency: { type: "string", enum: ["urgent", "standard"] },
        summary: { type: "string" },
      },
      required: ["tip_id", "countries_involved", "urgency"],
    },
  } satisfies ToolDefinition,

} as const;

export type ToolName = keyof typeof TOOL_DEFINITIONS;

// ── Central tool dispatcher ──────────────────────────────────────────────────

export async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<unknown> {
  switch (toolName) {
    case "get_warrant_status":
      return getWarrantStatus(
        toolInput["tip_id"] as string,
        toolInput["file_id"] as string
      );

    case "update_warrant_status":
      return updateWarrantStatus(
        toolInput["tip_id"] as string,
        toolInput["file_id"] as string,
        toolInput["status"] as "applied" | "granted" | "denied",
        toolInput["warrant_number"] as string | undefined,
        toolInput["granted_by"] as string | undefined
      );

    case "check_watchlists":
      return checkWatchlists(
        toolInput["lookup_type"] as Parameters<typeof checkWatchlists>[0],
        toolInput["value"] as string,
        toolInput["hash_type"] as string | undefined
      );

    case "check_deconfliction":
      return checkDeconfliction(
        toolInput["identifier_type"] as string,
        toolInput["value"] as string,
        toolInput["jurisdiction"] as string
      );

    case "check_aig_detection":
      return checkAigDetection(
        toolInput["file_hash"] as string,
        toolInput["hash_type"] as string
      );

    case "query_ncmec_victim_id":
      return queryNcmecVictimId(
        toolInput["file_hash"] as string,
        toolInput["hash_type"] as string
      );

    case "generate_preservation_request":
      return generatePreservationRequest({
        espName: toolInput["esp_name"] as string,
        accountIdentifiers: toolInput["account_identifiers"] as string[],
        jurisdiction: toolInput["jurisdiction"] as string,
        tipId: toolInput["tip_id"] as string,
        retentionDeadline: toolInput["retention_deadline"] as string | undefined,
      });

    case "alert_supervisor":
      return alertSupervisor(
        toolInput["tip_id"] as string,
        toolInput["category"] as string,
        toolInput["score"] as number,
        toolInput["recommended_action"] as string,
        toolInput["summary"] as string,
        toolInput["is_deconfliction_pause"] as boolean | undefined
      );

    case "send_victim_crisis_alert":
      return sendVictimCrisisAlert(
        toolInput["tip_id"] as string,
        toolInput["victim_description"] as string,
        toolInput["crisis_indicators"] as string[],
        toolInput["platform"] as string,
        toolInput["recommended_action"] as string | undefined
      );

    case "search_case_database":
      return searchCaseDatabase(
        toolInput["entity_type"] as string,
        toolInput["entity_value"] as string,
        toolInput["fuzzy"] as boolean | undefined,
        toolInput["date_range_days"] as number | undefined
      );

    case "route_interpol_referral":
      return routeInterpolReferral(
        toolInput["tip_id"] as string,
        toolInput["countries_involved"] as string[],
        toolInput["urgency"] as "urgent" | "standard",
        toolInput["summary"] as string | undefined
      );

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// Re-import all functions that handleToolCall uses
import {
  getWarrantStatus,
  updateWarrantStatus,
} from "./legal/warrant_tools.js";
import { checkWatchlists } from "./hash/check_watchlists.js";
import {
  checkAigDetection,
  queryNcmecVictimId,
} from "./hash/aig_and_victim_id.js";
import { checkDeconfliction } from "./deconfliction/check_deconfliction.js";
import { generatePreservationRequest } from "./preservation/generate_preservation_request.js";
import {
  alertSupervisor,
  sendVictimCrisisAlert,
} from "./alerts/alert_tools.js";
import { searchCaseDatabase } from "./database/search_case_database.js";
import { routeInterpolReferral } from "./routing/route_interpol_referral.js";
