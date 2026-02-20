/**
 * Warrant Affidavit Generator (Tier 2.2)
 *
 * Generates a pre-populated search warrant affidavit from extracted tip
 * entities. The investigator reviews, edits, and files with the DA.
 *
 * DISCLAIMER: Output is a DRAFT for investigator review only.
 * This is not legal advice and must be reviewed by the assigned ADA
 * before filing.
 */

import type { CyberTip, TipFile } from "../../models/index.js";

export interface WarrantAffidavitInput {
  tip: CyberTip;
  requesting_officer: string;
  badge_number: string;
  unit: string;
  blocked_files: TipFile[];       // Files that need warrant access
  da_office?: string;
  court_jurisdiction?: string;
}

export interface WarrantAffidavitResult {
  affidavit_text: string;         // Plain-text draft, ~600-1200 words
  applicable_statutes: string[];  // Suggested charges
  probable_cause_summary: string; // 3-sentence PC summary for the judge
  target_accounts: string[];      // Platforms + account IDs to search
  tracking_number: string;        // Internal reference
}

/** Generate a tracking ID for the warrant application */
function warrantTrackingId(tipId: string): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const tipSuffix = tipId.slice(0, 8).toUpperCase();
  return `WARRANT-${datePart}-${tipSuffix}`;
}

/** Format extracted IP addresses for legal documents */
function formatIPs(extracted: CyberTip["extracted"]): string {
  if (!extracted) return "None identified";
  const ips: string[] = (extracted as any).ip_addresses ?? [];
  return ips.length ? ips.map((ip: string) => `IP address ${ip}`).join(", ") : "None identified";
}

/** Format account identifiers for the target list */
function collectTargetAccounts(tip: CyberTip): string[] {
  const targets: string[] = [];
  if (!tip.extracted) return targets;
  const ex = tip.extracted as any;

  const platforms: string[] = ex.platforms ?? [];
  const accounts:  string[] = ex.account_ids ?? ex.usernames ?? [];

  for (const platform of platforms) {
    targets.push(platform);
  }
  for (const account of accounts) {
    targets.push(account);
  }

  // Also add platforms from blocked files
  return [...new Set(targets)];
}

/** Pull probable cause facts from tip classification + extracted entities */
function buildPCFacts(tip: CyberTip, blockedFiles: TipFile[]): string[] {
  const facts: string[] = [];
  const cls = tip.classification as any;
  const ex  = tip.extracted as any;

  if (tip.ncmec_tip_number) {
    facts.push(
      `The National Center for Missing and Exploited Children (NCMEC) received CyberTipline report ` +
      `number ${tip.ncmec_tip_number} from electronic service provider ${cls?.esp_name ?? "the reporting ESP"}, ` +
      `indicating suspected violations of federal law.`
    );
  }

  if (cls?.offense_category) {
    const category = String(cls.offense_category).replace(/_/g, " ");
    facts.push(
      `NCMEC flagged the tip as ${category} with a severity classification of ` +
      `${String(cls.severity ?? "HIGH").replace(/_/g, " ")}.`
    );
  }

  if (blockedFiles.length > 0) {
    const hashLines = blockedFiles
      .filter((f: TipFile) => f.hash_sha256 || f.hash_md5)
      .map((f: TipFile) => `SHA-256: ${f.hash_sha256 ?? f.hash_md5}`)
      .slice(0, 3);
    if (hashLines.length) {
      facts.push(
        `${blockedFiles.length} file(s) associated with this tip have been identified by cryptographic ` +
        `hash value. The ESP did not view these files prior to reporting, making warrantless access ` +
        `impermissible under United States v. Wilson, 971 F.3d 1004 (9th Cir. 2020). ` +
        `File identifier(s): ${hashLines.join("; ")}.`
      );
    }
  }

  if (ex?.ip_addresses?.length) {
    facts.push(
      `The subject account was accessed from the following IP address(es): ` +
      `${ex.ip_addresses.slice(0, 5).join(", ")}. Subscriber records for these addresses ` +
      `may identify the physical location and identity of the account holder.`
    );
  }

  if (ex?.victim_age_range) {
    facts.push(
      `The reported victim is described as ${ex.victim_age_range}, meeting the statutory ` +
      `definition of a minor under 18 U.S.C. § 2256(1).`
    );
  }

  return facts;
}

/** Derive applicable statutes from offense category */
function getApplicableStatutes(tip: CyberTip): string[] {
  const cls = tip.classification as any;
  const category = String(cls?.offense_category ?? "OTHER");
  const statutes: string[] = [];

  // Always include the NCMEC reporting statute
  statutes.push("18 U.S.C. § 2703 (Stored Communications Act — Required Disclosure)");

  const map: Record<string, string[]> = {
    CSAM: [
      "18 U.S.C. § 2252 (Distribution/Receipt of Child Sexual Abuse Material)",
      "18 U.S.C. § 2252A (Activities Relating to Material Constituting or Containing CSAM)",
      "18 U.S.C. § 2256 (Definitions)",
    ],
    CHILD_GROOMING: [
      "18 U.S.C. § 2422(b) (Coercion and Enticement of a Minor)",
      "18 U.S.C. § 2423 (Transportation of Minors)",
    ],
    ONLINE_ENTICEMENT: [
      "18 U.S.C. § 2422(b) (Online Enticement of a Minor)",
      "18 U.S.C. § 2252A(a)(3)(B) (Production of CSAM)",
    ],
    CHILD_SEX_TRAFFICKING: [
      "18 U.S.C. § 1591 (Sex Trafficking of Children)",
      "18 U.S.C. § 1594 (General Provisions — Sex Trafficking)",
    ],
    SEXTORTION: [
      "18 U.S.C. § 2252A (Distribution of CSAM — if minor victim)",
      "18 U.S.C. § 2261A (Cyberstalking)",
      "18 U.S.C. § 875(d) (Interstate Threats — Extortion)",
    ],
    CYBER_EXPLOITATION: [
      "18 U.S.C. § 2261A (Cyberstalking)",
      "18 U.S.C. § 2252A (if minor)",
    ],
  };

  const additional = map[category] ?? [
    `18 U.S.C. § 1030 (Computer Fraud and Abuse Act)`,
  ];

  statutes.push(...additional);
  return statutes;
}

export function generateWarrantAffidavit(
  input: WarrantAffidavitInput
): WarrantAffidavitResult {
  const { tip, requesting_officer, badge_number, unit, blocked_files, da_office, court_jurisdiction } = input;

  const trackingNum     = warrantTrackingId(tip.tip_id);
  const targetAccounts  = collectTargetAccounts(tip);
  const statutes        = getApplicableStatutes(tip);
  const pcFacts         = buildPCFacts(tip, blocked_files);
  const cls             = tip.classification as any;
  const espName         = cls?.esp_name ?? "the Electronic Service Provider";
  const jurisdiction    = court_jurisdiction ?? tip.jurisdiction_of_tip?.primary ?? "US_federal";

  const pcSummary =
    `An NCMEC CyberTipline report (${tip.ncmec_tip_number ?? tip.tip_id}) ` +
    `indicates suspected ${String(cls?.offense_category ?? "violations").replace(/_/g, " ")} ` +
    `by an account holder on ${espName}. ` +
    `The reporting ESP did not view the reported file(s), requiring a search warrant under ` +
    `United States v. Wilson (9th Cir. 2020) before law enforcement may access the content. ` +
    `Subscriber records, communication logs, and file content associated with the identified account(s) ` +
    `are needed to identify, locate, and prosecute the subject.`;

  const factSection = pcFacts
    .map((fact, i) => `  ${i + 1}. ${fact}`)
    .join("\n\n");

  const accountSection = targetAccounts.length
    ? targetAccounts.map((a) => `     - ${a}`).join("\n")
    : "     - [Account identifiers to be confirmed by investigator]";

  const statuteSection = statutes.map((s) => `     • ${s}`).join("\n");

  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // ── Full affidavit text ───────────────────────────────────────────────────

  const affidavitText = `
IN THE ${jurisdiction.toUpperCase().replace(/_/g, " ")} COURT
[DISTRICT / COUNTY TO BE CONFIRMED BY ADA]

Warrant Tracking No.: ${trackingNum}

═══════════════════════════════════════════════════════════════
   AFFIDAVIT IN SUPPORT OF APPLICATION FOR SEARCH WARRANT
                       (DRAFT — FOR INVESTIGATOR REVIEW)
                 REQUIRES ADA REVIEW BEFORE FILING
═══════════════════════════════════════════════════════════════

I, ${requesting_officer}, Badge No. ${badge_number}, being duly sworn,
depose and state as follows:

1. AGENT BACKGROUND

I am a law enforcement officer assigned to ${unit}. I have been trained
in the investigation of crimes involving the exploitation of minors, online
predatory behavior, and crimes involving electronic communications. I am
authorized to conduct investigations pursuant to my agency's jurisdiction.

2. PURPOSE OF THIS AFFIDAVIT

This affidavit is submitted in support of a search warrant application
directed to ${espName}, requiring the disclosure of account records,
communications, and associated content identified in Section 5 below,
pursuant to 18 U.S.C. § 2703.

3. LEGAL FRAMEWORK

${espName} is an Electronic Service Provider (ESP) subject to the Stored
Communications Act (18 U.S.C. §§ 2701-2713). Under United States v. Wilson,
971 F.3d 1004 (9th Cir. 2020) and successor authority, a search warrant
is required to access content that was not independently viewed by the ESP
prior to reporting. The files identified below fall within this category.

The REPORT Act of 2024 (Pub. L. 118-58) requires ${espName} to preserve
these records for a minimum of 365 days from the date of any CyberTipline
submission, regardless of platform data retention policies.

4. PROBABLE CAUSE

The following facts and circumstances establish probable cause to believe
that evidence, instrumentalities, and fruits of violations of:

${statuteSection}

are located in the account(s) described in Section 5.

FACTS ESTABLISHING PROBABLE CAUSE:

${factSection}

5. ITEMS TO BE SEARCHED AND SEIZED

The following account(s) on ${espName}'s platform are subject to this warrant:

${accountSection}

For each identified account, your affiant seeks the following categories
of records from ${espName}:

     a) All subscriber registration information (name, email, phone, dates)
     b) IP access logs for the prior 180 days with timestamps
     c) All uploaded, shared, or transmitted content
     d) All direct and group message content and metadata
     e) Payment and billing records
     f) Device identifiers (IMEI, MAC addresses, device fingerprints)
     g) Connected account information and OAuth records

6. REQUEST FOR NON-DISCLOSURE ORDER

Pursuant to 18 U.S.C. § 2705(b), the government requests an order directing
${espName} to delay notifying any subscriber for a period of 90 days, as
notification would seriously jeopardize the investigation.

7. CONCLUSION

Based upon the foregoing facts and circumstances, your affiant respectfully
requests this Court issue a Search Warrant directed to ${espName},
compelling production of the records described in Section 5.

I declare under penalty of perjury that the foregoing is true and correct
to the best of my knowledge and belief.

Executed this ${date}.


___________________________________           Badge No. ${badge_number}
${requesting_officer}
${unit}

Sworn and subscribed before me this _____ day of _____________, 20___.


___________________________________
[Judge / Magistrate Name and Title]
${court_jurisdiction ?? "[Court Jurisdiction]"}

═══════════════════════════════════════════════════════════════
DRAFT — FOR INVESTIGATOR REVIEW ONLY
Reference tip: ${tip.tip_id}  |  Tracking: ${trackingNum}
Generated: ${new Date().toISOString()}
This document is law enforcement sensitive. Distribution restricted.
═══════════════════════════════════════════════════════════════
`.trim();

  return {
    affidavit_text: affidavitText,
    applicable_statutes: statutes,
    probable_cause_summary: pcSummary,
    target_accounts: targetAccounts,
    tracking_number: trackingNum,
  };
}
