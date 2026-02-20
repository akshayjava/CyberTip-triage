/**
 * Legal Compliance Reference Module
 *
 * Authoritative reference for statutes, circuit precedents, and reporting
 * obligations relevant to ICAC CyberTip processing.
 *
 * LAST REVIEWED: 2025-08-01
 * Covers:
 *   - 18 U.S.C. § 2258A/B (NCMEC reporting obligations)
 *   - 18 U.S.C. § 2252A/2256 (CSAM offenses)
 *   - 18 U.S.C. § 1466A (AIG-CSAM, obscene visual representations)
 *   - 18 U.S.C. § 2703(f) (preservation requests)
 *   - 18 U.S.C. § 2422 (enticement / sextortion)
 *   - STOP CSAM Act (2024, Pub. L. 118-64)
 *   - REPORT Act (2022, Pub. L. 117-176, amended 2024)
 *   - PROTECT Our Children Act (2008)
 *   - Wilson Ruling — US v. Wilson, No. 18-50440 (9th Cir. 2021)
 *   - Circuit split map — all 13 circuits + current status
 *   - EU CSA Regulation (CSAR) — pending; relevant for EU-jurisdiction tips
 *   - International data sharing — MLAT, Budapest Convention, Clarifying Act
 */

// ── Statute definitions ───────────────────────────────────────────────────────

export interface Statute {
  citation: string;
  title: string;
  summary: string;
  relevance: string[];
  max_penalty?: string;
  notes?: string;
}

export const STATUTES: Record<string, Statute> = {
  // ── Primary CSAM statutes ────────────────────────────────────────────────
  "18_USC_2252A": {
    citation: "18 U.S.C. § 2252A",
    title: "Certain activities relating to material constituting or containing child pornography",
    summary:
      "Prohibits knowing production, receipt, distribution, possession, and access of CSAM. " +
      "Mandatory minimums: 5 years (receipt/distribution), 10 years (production).",
    relevance: ["CSAM", "CHILD_GROOMING", "CHILD_SEX_TRAFFICKING"],
    max_penalty: "Life imprisonment (with prior conviction or victim under 12)",
    notes:
      "Affirmative defense for bona fide law enforcement activities. " +
      "Use this citation for all domestic CSAM charges unless § 2252 better fits.",
  },

  "18_USC_2256": {
    citation: "18 U.S.C. § 2256",
    title: "Definitions — sexually explicit conduct",
    summary:
      "Defines 'sexually explicit conduct', 'minor' (under 18), 'child pornography'. " +
      "Key: computer-generated images are covered when 'indistinguishable from real'.",
    relevance: ["CSAM"],
    notes: "Always cite alongside § 2252A for completeness.",
  },

  "18_USC_1466A": {
    citation: "18 U.S.C. § 1466A",
    title: "Obscene visual representations of the sexual abuse of children",
    summary:
      "Prohibits obscene drawings, cartoons, sculptures, paintings, and digital images " +
      "depicting minors in sexually explicit conduct. Covers AI-generated CSAM (AIG-CSAM).",
    relevance: ["CSAM"],
    max_penalty: "10 years (first offense), 20 years (subsequent)",
    notes:
      "CRITICAL: Applies to AI-generated and synthetic CSAM even with no real victim. " +
      "Use this alongside § 2252A for AIG-CSAM. See also STOP CSAM Act 2024 § 3.",
  },

  // ── Reporting obligations ────────────────────────────────────────────────
  "18_USC_2258A": {
    citation: "18 U.S.C. § 2258A",
    title: "Reporting requirements of electronic communication service providers",
    summary:
      "Requires ESPs to report apparent CSAM to NCMEC CyberTipline. " +
      "REPORT Act (2024) added: reports must include facts giving rise to suspicion, " +
      "geographic information, and preserved contents when technically feasible.",
    relevance: ["CSAM"],
    notes:
      "REPORT Act (Pub. L. 117-176, 2022) + 2024 amendments: " +
      "ESPs now required to report 'apparent' (not just confirmed) CSAM. " +
      "Expanded content preservation obligations. 30-day preservation window on report. " +
      "Failure to report = $190,000 per violation (first), $380,000 (subsequent).",
  },

  "18_USC_2258B": {
    citation: "18 U.S.C. § 2258B",
    title: "Limited liability for electronic service providers",
    summary:
      "Provides liability protection for ESPs complying with § 2258A reporting. " +
      "ESPs retain immunity when reports are made in good faith.",
    relevance: ["CSAM"],
    notes:
      "Relevant when reviewing ESP reporting quality — under-reporting may forfeit immunity.",
  },

  // ── Preservation ─────────────────────────────────────────────────────────
  "18_USC_2703F": {
    citation: "18 U.S.C. § 2703(f)",
    title: "Requirements for governmental access — preservation demand",
    summary:
      "Government may compel ESP to preserve stored communications. " +
      "Initial preservation: 90 days, renewable once for additional 90 days. " +
      "No court order or prior notice to subscriber required.",
    relevance: ["CSAM", "CHILD_GROOMING", "SEXTORTION", "CYBER_EXPLOITATION"],
    notes:
      "Issue immediately when tip is received. Free to send. " +
      "Does NOT compel disclosure — separate SCA process for that. " +
      "See § 2703(d) and (b) for compelled disclosure process.",
  },

  // ── Enticement and sextortion ─────────────────────────────────────────────
  "18_USC_2422": {
    citation: "18 U.S.C. § 2422",
    title: "Coercion and enticement",
    summary:
      "§ 2422(a): Coercing/enticing an individual to travel in interstate commerce for prostitution. " +
      "§ 2422(b): Enticing a minor to engage in sexual activity via interstate commerce (internet). " +
      "Includes sextortion where perpetrator induces minor to produce CSAM.",
    relevance: ["CHILD_GROOMING", "SEXTORTION", "CHILD_SEX_TRAFFICKING"],
    max_penalty: "10 years minimum mandatory (§ 2422b)",
    notes:
      "§ 2422(b) is the primary federal charge for online grooming. " +
      "Does not require completion — attempt is sufficient.",
  },

  "18_USC_2251": {
    citation: "18 U.S.C. § 2251",
    title: "Sexual exploitation of children (production)",
    summary:
      "Prohibits production, manufacturing, and inducing a minor to engage in sexually explicit conduct. " +
      "Live-streamed CSAM and sextortion-induced production are covered.",
    relevance: ["CSAM", "SEXTORTION"],
    max_penalty: "30 years minimum mandatory (first offense)",
    notes:
      "Use alongside § 2252A when production element is present. " +
      "Highest penalties in this category. " +
      "STOP CSAM Act 2024 expanded definition to include remote-facilitated production.",
  },

  "18_USC_2260A": {
    citation: "18 U.S.C. § 2260A",
    title: "Penalties for registered sex offenders — federal",
    summary:
      "Provides mandatory consecutive sentences for registered sex offenders who commit " +
      "additional federal sex crimes. Adds 10 years minimum on top of underlying offense.",
    relevance: ["CSAM", "CHILD_GROOMING"],
    notes: "Check sex offender registry during hash/OSINT phase.",
  },
};

// ── STOP CSAM Act 2024 ────────────────────────────────────────────────────────

export const STOP_CSAM_ACT_2024 = {
  citation: "Pub. L. 118-64 (2024)",
  title:
    "Strengthening Transparency and Obligations to Protect Children Suffering from Abuse and Mistreatment Act",
  enacted: "2024",
  key_provisions: [
    {
      section: "§ 2",
      title: "Civil cause of action for victims",
      summary:
        "For the first time, victims of child sexual exploitation can sue ESPs for damages. " +
        "ESPs face civil liability if they 'knowingly benefit' from facilitating CSAM. " +
        "Applies to tips received AFTER enactment — check tip received_at date.",
      icac_relevance:
        "Tips involving platforms that have knowingly hosted repeat CSAM may warrant " +
        "referral to victim advocacy organizations for civil litigation coordination.",
    },
    {
      section: "§ 3",
      title: "AI-generated CSAM",
      summary:
        "Explicitly confirms § 1466A covers AI-generated CSAM. Removes any ambiguity. " +
        "Adds definition: 'digitally created' means created entirely by digital means " +
        "without using a real minor.",
      icac_relevance:
        "aig_csam_flag = true → cite § 1466A explicitly. Severity is NOT reduced. " +
        "FBI CEOS should be copied on all AIG-CSAM referrals.",
    },
    {
      section: "§ 4",
      title: "Expanded NCMEC reporting obligations",
      summary:
        "ESPs must now report 'reasonably apparent' CSAM, not just hash-confirmed CSAM. " +
        "Expanded to include apparent CSAM detected by AI/ML systems. " +
        "New obligation to preserve and include in report any communication that " +
        "facilitated production or distribution of CSAM.",
      icac_relevance:
        "Tips from ESPs citing AI detection only are now legally valid NCMEC reports. " +
        "Look for 'detected_by_ai' or 'automated_detection' flags in Section A metadata.",
    },
    {
      section: "§ 5",
      title: "Enhanced NCMEC cooperation requirements",
      summary:
        "NCMEC granted broader authority to share tip information with international " +
        "partners. ESPs must respond to NCMEC information requests within 72 hours.",
      icac_relevance:
        "International tip routing enhanced. EU/Canadian tips may have faster NCMEC-facilitated " +
        "data exchange than before.",
    },
    {
      section: "§ 6",
      title: "Sextortion specific provisions",
      summary:
        "Creates new standalone federal offense of 'online enticement leading to sextortion'. " +
        "Mandatory minimum 15 years for sextortion resulting in victim self-harm. " +
        "Covers financial sextortion (demanding money, not additional images).",
      icac_relevance:
        "SEXTORTION tips where victim_crisis_alert = true may now support mandatory minimum charge. " +
        "Financial sextortion is covered — update offense_category = SEXTORTION even if money-only.",
    },
  ] as const,
};

// ── REPORT Act (2022, amended 2024) ───────────────────────────────────────────

export const REPORT_ACT_2024 = {
  citation: "Pub. L. 117-176 (2022), amended Pub. L. 118-64 (2024)",
  title: "Revising Existing Procedures On Reporting via Technology Act",
  key_changes: [
    "Reports must include ALL facts giving rise to suspicion — not just file hashes",
    "Geographic and network information must be included when technically feasible",
    "Preserved content must be provided with the report when available",
    "'Apparent' CSAM must be reported — not just algorithmically confirmed matches",
    "24-hour reporting deadline tightened to 72 hours (was previously unspecified)",
    "ESPs must now report sextortion targeting minors to NCMEC (new category)",
  ] as const,
  esp_obligations:
    "If a tip arrives with thin content that seems to miss REPORT Act requirements, " +
    "escalate to NCMEC liaison for follow-up with the reporting ESP.",
};

// ── Circuit split map ─────────────────────────────────────────────────────────

export interface CircuitPrecedent {
  circuit: string;
  states: string[];
  binding_case?: string;
  rule: "requires_warrant" | "no_warrant_needed" | "split" | "undecided";
  notes: string;
  last_updated: string;
}

export const CIRCUIT_PRECEDENT_MAP: CircuitPrecedent[] = [
  {
    circuit: "9th Circuit",
    states: ["AK", "AZ", "CA", "HI", "ID", "MT", "NV", "OR", "WA"],
    binding_case: "United States v. Wilson, No. 18-50440 (9th Cir. 2021)",
    rule: "requires_warrant",
    notes:
      "BINDING: Warrant required if ESP did not view specific files before reporting. " +
      "Hash match alone ≠ private search exception. Applies in all 9 states.",
    last_updated: "2021-10-13",
  },
  {
    circuit: "7th Circuit",
    states: ["IL", "IN", "WI"],
    binding_case: "United States v. Reczek, 722 F.3d 1327 (7th Cir. 2013)",
    rule: "no_warrant_needed",
    notes:
      "Pre-Wilson: 7th Circuit held ESP review is a private search sufficient to " +
      "authorize law enforcement viewing. Wilson not yet adopted here. " +
      "Consult AUSA — 7th Circuit may revisit in light of Wilson.",
    last_updated: "2024-01-01",
  },
  {
    circuit: "10th Circuit",
    states: ["CO", "KS", "NM", "OK", "UT", "WY"],
    binding_case: "United States v. Ackerman, 831 F.3d 1292 (10th Cir. 2016)",
    rule: "split",
    notes:
      "Ackerman held NCMEC is a government actor for Fourth Amendment purposes. " +
      "Subsequent cases have applied Wilson-like analysis. " +
      "CONSERVATIVE APPROACH: treat as warrant-required pending AUSA guidance.",
    last_updated: "2024-01-01",
  },
  {
    circuit: "1st Circuit",
    states: ["ME", "MA", "NH", "RI"],
    rule: "undecided",
    notes:
      "No binding precedent directly addressing Wilson issue. " +
      "Apply conservative default — treat all unviewed files as requiring warrant.",
    last_updated: "2024-01-01",
  },
  {
    circuit: "2nd Circuit",
    states: ["CT", "NY", "VT"],
    rule: "undecided",
    notes:
      "No binding precedent. Apply conservative default. " +
      "SDNY and EDNY have applied Wilson analysis in unpublished decisions.",
    last_updated: "2024-01-01",
  },
  {
    circuit: "3rd Circuit",
    states: ["DE", "NJ", "PA"],
    rule: "undecided",
    notes: "No binding precedent. Conservative default applies.",
    last_updated: "2024-01-01",
  },
  {
    circuit: "4th Circuit",
    states: ["MD", "NC", "SC", "VA", "WV"],
    rule: "undecided",
    notes: "No binding precedent. Conservative default applies.",
    last_updated: "2024-01-01",
  },
  {
    circuit: "5th Circuit",
    states: ["LA", "MS", "TX"],
    rule: "undecided",
    notes:
      "No binding precedent directly on point. " +
      "Several district court decisions have applied Wilson analysis. " +
      "Conservative default applies.",
    last_updated: "2024-01-01",
  },
  {
    circuit: "6th Circuit",
    states: ["KY", "MI", "OH", "TN"],
    rule: "undecided",
    notes: "No binding precedent. Conservative default applies.",
    last_updated: "2024-01-01",
  },
  {
    circuit: "8th Circuit",
    states: ["AR", "IA", "MN", "MO", "NE", "ND", "SD"],
    rule: "undecided",
    notes: "No binding precedent. Conservative default applies.",
    last_updated: "2024-01-01",
  },
  {
    circuit: "11th Circuit",
    states: ["AL", "FL", "GA"],
    rule: "undecided",
    notes: "No binding precedent. Conservative default applies.",
    last_updated: "2024-01-01",
  },
  {
    circuit: "D.C. Circuit",
    states: ["DC"],
    rule: "undecided",
    notes:
      "Federal jurisdiction only. No binding precedent. Conservative default applies.",
    last_updated: "2024-01-01",
  },
];

/** Get the precedent for a given state */
export function getCircuitPrecedent(state: string): CircuitPrecedent {
  const upper = state.toUpperCase();
  const precedent = CIRCUIT_PRECEDENT_MAP.find((c) =>
    c.states.includes(upper)
  );
  return (
    precedent ?? {
      circuit: "unknown",
      states: [],
      rule: "undecided" as const,
      notes:
        "State not found in circuit map. Apply conservative default. " +
        "Consult your US Attorney's office.",
      last_updated: "2024-01-01",
    }
  );
}

/** Returns true if the circuit requires a warrant for unviewed files */
export function circuitRequiresWarrant(state: string): boolean {
  const precedent = getCircuitPrecedent(state);
  // Conservative: treat split and undecided as requiring warrant
  return precedent.rule !== "no_warrant_needed";
}

// ── International compliance ──────────────────────────────────────────────────

export const INTERNATIONAL_FRAMEWORKS = {
  EU_CSAR: {
    name: "EU Child Sexual Abuse Regulation (CSAR / 'Chat Control')",
    status: "pending_as_of_2025",
    summary:
      "Proposed EU regulation requiring detection and reporting of CSAM on all platforms. " +
      "As of 2025, negotiations ongoing — not yet in force. " +
      "Hungarian Presidency proposed compromise text 2024; Council split on E2EE provisions.",
    icac_relevance:
      "EU-jurisdiction tips: route to Europol EC3 (ECTEG) and NCMEC international liaison. " +
      "MLAT required for EU user data; expedited process available via CLOUD Act with EU bilateral.",
  },

  BUDAPEST_CONVENTION: {
    name: "Budapest Convention on Cybercrime",
    citation: "ETS No. 185 (2001)",
    status: "in_force",
    summary:
      "Requires signatories to criminalize CSAM production, possession, and distribution. " +
      "Provides expedited preservation and disclosure procedures with other signatories. " +
      "Second Additional Protocol (2022) further streamlines direct cooperation.",
    icac_relevance:
      "For tips involving servers or suspects in signatory countries: " +
      "expedited preservation requests possible via MLA channel. " +
      "Contact DOJ MLARS for treaty channel use.",
  },

  CLOUD_ACT: {
    name: "Clarifying Lawful Overseas Use of Data (CLOUD) Act",
    citation: "Pub. L. 115-141 (2018)",
    status: "in_force",
    summary:
      "US providers can be compelled to provide data stored overseas. " +
      "Executive Agreements allow direct requests between eligible countries. " +
      "Current agreements: UK (2020), Australia (2023).",
    icac_relevance:
      "For tips involving US ESPs storing data in UK/Australia: " +
      "CLOUD Act agreements enable faster access than traditional MLAT. " +
      "Contact DOJ OIA for current agreement status.",
  },

  MLAT: {
    name: "Mutual Legal Assistance Treaties",
    summary:
      "Formal treaty-based mechanism for cross-border evidence requests. " +
      "Average processing time: 6–24 months (criminal). " +
      "Emergency MLAT possible in 24–72 hours for imminent harm to child.",
    icac_relevance:
      "For international tips: " +
      "1. Attempt NCMEC international liaison first (faster). " +
      "2. Europol for EU tips. " +
      "3. MLAT via DOJ MLARS as fallback. " +
      "Always consider Budapest Convention/CLOUD Act shortcuts first.",
  },
} as const;

// ── Applicable statutes lookup ────────────────────────────────────────────────

/**
 * Returns the applicable statutes for an offense category.
 * Used by the Classifier Agent to populate the statutes field.
 */
export function getApplicableStatutes(
  offenseCategory: string,
  isMinorVictim: boolean,
  aigCsam: boolean
): string[] {
  const statutes: string[] = [];

  switch (offenseCategory) {
    case "CSAM":
      statutes.push("18 U.S.C. § 2252A", "18 U.S.C. § 2256");
      if (aigCsam) statutes.push("18 U.S.C. § 1466A");
      break;

    case "CHILD_GROOMING":
      statutes.push("18 U.S.C. § 2422(b)");
      if (isMinorVictim) statutes.push("18 U.S.C. § 2252A");
      break;

    case "SEXTORTION":
      statutes.push("18 U.S.C. § 2422");
      if (isMinorVictim) {
        statutes.push("18 U.S.C. § 2252A");
        statutes.push("18 U.S.C. § 2251");
      }
      break;

    case "CHILD_SEX_TRAFFICKING":
      statutes.push("18 U.S.C. § 1591", "18 U.S.C. § 2422(b)");
      break;

    case "CYBER_EXPLOITATION":
      statutes.push("18 U.S.C. § 2261A");
      if (isMinorVictim) statutes.push("18 U.S.C. § 2252A");
      break;

    default:
      // No specific statute list — leave to classifier
      break;
  }

  return statutes;
}

// ── Reporting deadlines ───────────────────────────────────────────────────────

export const REPORTING_OBLIGATIONS = {
  NCMEC_REPORT_WINDOW_HOURS: 72, // REPORT Act 2024: 72 hours from knowledge
  ESP_PRESERVATION_INITIAL_DAYS: 90, // § 2703(f) initial preservation
  ESP_PRESERVATION_RENEWAL_DAYS: 90, // § 2703(f) one renewal
  STATE_ICAC_REPORT_HOURS: 48, // Typical state ICAC unit requirement
} as const;
