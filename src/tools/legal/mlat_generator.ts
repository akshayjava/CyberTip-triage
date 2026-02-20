/**
 * MLAT Request Generator — Tier 4.3
 *
 * The Problem:
 *   84% of 2024 NCMEC CyberTips had subjects located outside the US.
 *   Cross-border evidence collection requires Mutual Legal Assistance Treaties
 *   (MLAT) — formal requests routed through the DOJ's Office of International
 *   Affairs (OIA). A single MLAT can take 6–18 months. Incomplete paperwork
 *   causes rejections that restart the clock.
 *
 * The Solution:
 *   Pre-populate MLAT request drafts from extracted tip entities. Investigators
 *   review and edit rather than drafting from scratch — saves ~3–5 hours and
 *   reduces rejection-causing omissions.
 *
 * Alternatives that may be faster than MLAT (checked first):
 *   1. CLOUD Act agreement (US has bilateral with EU, UK, Australia, Canada)
 *      → Faster: days to weeks vs months
 *   2. Budapest Convention expedited Article 29 preservation request
 *      → Fastest for preservation, not disclosure
 *   3. NCMEC international liaison (for registered NCMEC partners)
 *      → Free, direct, but limited to tip content
 *   4. Interpol channel via NCB (for enforcement cooperation, not data)
 *
 * DOJ OIA Contact Info:
 *   Email: oiacriminal@usdoj.gov  (standard MLAT inquiries)
 *   Urgent: Via duty officer through FBI Legal Attaché in subject country
 *   Reference: https://www.justice.gov/criminal-oia/mlat-requests-us-authorities
 *
 * This module generates:
 *   - Full MLAT request letter draft with statutory citations
 *   - Budapest Convention Article 16/29 preservation letter (faster alternative)
 *   - Country-specific routing and contact information
 *   - CLOUD Act alternative assessment
 *
 * DISCLAIMER: Output is a draft for review by agency legal counsel. Not legal advice.
 */

import type { CyberTip } from "../../models/index.js";

// ── Treaty database ───────────────────────────────────────────────────────────

export interface CountryTreatyProfile {
  country_code:       string;   // ISO 3166-1 alpha-2
  country_name:       string;
  has_mlat:           boolean;  // US has MLAT with this country
  mlat_treaty_name?:  string;
  mlat_year?:         number;
  has_cloud_act:      boolean;  // CLOUD Act bilateral agreement
  cloud_act_year?:    number;
  budapest_party:     boolean;  // Budapest Convention signatory
  oai_contact:        string;   // DOJ OIA desk for this country/region
  ncb_city?:          string;   // Interpol NCB location
  estimated_response: string;   // Realistic timeline
  language_required?: string;   // Language translation requirement
  notes:              string;
}

// Comprehensive treaty database — top ICAC-relevant countries
// Sources: DOJ OIA treaty list, CLOUD Act bilateral list, Budapest Convention party list
export const TREATY_DATABASE: Record<string, CountryTreatyProfile> = {
  CA: {
    country_code: "CA", country_name: "Canada",
    has_mlat: true, mlat_treaty_name: "Treaty on Mutual Legal Assistance in Criminal Matters (US-Canada)", mlat_year: 1990,
    has_cloud_act: true, cloud_act_year: 2022,
    budapest_party: true,
    oai_contact: "DOJ OIA — Canada Desk (oiacriminal@usdoj.gov)",
    ncb_city: "Ottawa",
    estimated_response: "MLAT: 3–6 months; CLOUD Act: 2–4 weeks",
    notes: "CLOUD Act agreement strongly preferred — much faster. Canada RCMP has direct ICAC cooperation track.",
  },
  GB: {
    country_code: "GB", country_name: "United Kingdom",
    has_mlat: true, mlat_treaty_name: "Mutual Legal Assistance Treaty (US-UK)", mlat_year: 1997,
    has_cloud_act: true, cloud_act_year: 2019,
    budapest_party: true,
    oai_contact: "DOJ OIA — UK/Europe Desk (oiacriminal@usdoj.gov)",
    ncb_city: "London",
    estimated_response: "MLAT: 3–6 months; CLOUD Act: 2–6 weeks",
    notes: "CLOUD Act agreement with UK is the first and most mature. NCA CEOP has direct liaison with US ICAC task forces.",
  },
  AU: {
    country_code: "AU", country_name: "Australia",
    has_mlat: true, mlat_treaty_name: "Treaty on Mutual Assistance in Criminal Matters (US-Australia)", mlat_year: 1999,
    has_cloud_act: true, cloud_act_year: 2022,
    budapest_party: true,
    oai_contact: "DOJ OIA — Asia-Pacific Desk (oiacriminal@usdoj.gov)",
    ncb_city: "Canberra",
    estimated_response: "MLAT: 3–6 months; CLOUD Act: 2–4 weeks",
    notes: "ACIC and AFP have strong ICAC cooperation. CLOUD Act preferred.",
  },
  DE: {
    country_code: "DE", country_name: "Germany",
    has_mlat: true, mlat_treaty_name: "Treaty on Mutual Legal Assistance in Criminal Matters (US-Germany)", mlat_year: 2007,
    has_cloud_act: false,
    budapest_party: true,
    oai_contact: "DOJ OIA — EU Desk (oiacriminal@usdoj.gov)",
    ncb_city: "Wiesbaden",
    estimated_response: "MLAT: 6–12 months",
    language_required: "German",
    notes: "No CLOUD Act bilateral. Route through Europol for preliminary cooperation. BKA has ICAC unit.",
  },
  FR: {
    country_code: "FR", country_name: "France",
    has_mlat: true, mlat_treaty_name: "Treaty on Mutual Legal Assistance in Criminal Matters (US-France)", mlat_year: 2001,
    has_cloud_act: false,
    budapest_party: true,
    oai_contact: "DOJ OIA — EU Desk",
    ncb_city: "Lyon",
    estimated_response: "MLAT: 6–12 months",
    language_required: "French",
    notes: "No CLOUD Act bilateral. OCLCTIC (French cybercrime unit) for preliminary cooperation.",
  },
  NL: {
    country_code: "NL", country_name: "Netherlands",
    has_mlat: true, mlat_treaty_name: "Treaty on Mutual Assistance in Criminal Matters (US-Netherlands)", mlat_year: 2004,
    has_cloud_act: false,
    budapest_party: true,
    oai_contact: "DOJ OIA — EU Desk",
    ncb_city: "The Hague",
    estimated_response: "MLAT: 4–8 months",
    notes: "Europol HQ in The Hague. Team Cybercrime/THTC for direct ICAC cooperation.",
  },
  PH: {
    country_code: "PH", country_name: "Philippines",
    has_mlat: true, mlat_treaty_name: "Treaty on Mutual Legal Assistance in Criminal Matters (US-Philippines)", mlat_year: 1996,
    has_cloud_act: false,
    budapest_party: false,
    oai_contact: "DOJ OIA — Asia-Pacific Desk",
    ncb_city: "Manila",
    estimated_response: "MLAT: 6–18 months",
    notes: "High ICAC tip volume. IACAT (Inter-Agency Council Against Trafficking) for coordination. Consider FBI Manila Legat for urgent cases.",
  },
  IN: {
    country_code: "IN", country_name: "India",
    has_mlat: true, mlat_treaty_name: "Treaty on Mutual Legal Assistance in Criminal Matters (US-India)", mlat_year: 2005,
    has_cloud_act: false,
    budapest_party: false,
    oai_contact: "DOJ OIA — South Asia Desk",
    ncb_city: "New Delhi",
    estimated_response: "MLAT: 12–24 months",
    notes: "Response times historically long. FBI New Delhi Legat for urgent cases. CBI is central coordinating agency.",
  },
  BR: {
    country_code: "BR", country_name: "Brazil",
    has_mlat: true, mlat_treaty_name: "Treaty on Mutual Legal Assistance in Criminal Matters (US-Brazil)", mlat_year: 1997,
    has_cloud_act: false,
    budapest_party: false,
    oai_contact: "DOJ OIA — Latin America Desk",
    ncb_city: "Brasília",
    estimated_response: "MLAT: 6–18 months",
    language_required: "Portuguese",
    notes: "SaferNet Brasil as NGO partner for preliminary victim support.",
  },
  MX: {
    country_code: "MX", country_name: "Mexico",
    has_mlat: true, mlat_treaty_name: "Treaty on Mutual Legal Assistance in Criminal Matters (US-Mexico)", mlat_year: 1991,
    has_cloud_act: false,
    budapest_party: false,
    oai_contact: "DOJ OIA — Latin America Desk",
    ncb_city: "Mexico City",
    estimated_response: "MLAT: 6–12 months",
    language_required: "Spanish",
    notes: "PGR/FGR handles MLAT requests. Border area cases may use DEA/ICE direct channels.",
  },
  JP: {
    country_code: "JP", country_name: "Japan",
    has_mlat: true, mlat_treaty_name: "Treaty on Mutual Legal Assistance in Criminal Matters (US-Japan)", mlat_year: 2003,
    has_cloud_act: false,
    budapest_party: true,
    oai_contact: "DOJ OIA — Asia-Pacific Desk",
    ncb_city: "Tokyo",
    estimated_response: "MLAT: 6–12 months",
    language_required: "Japanese",
    notes: "NPA Cyber Division. Budapest Convention ratified 2012. Efficient response by MLAT standards.",
  },
  NG: {
    country_code: "NG", country_name: "Nigeria",
    has_mlat: false,
    has_cloud_act: false,
    budapest_party: false,
    oai_contact: "DOJ OIA — Africa Desk (oiacriminal@usdoj.gov)",
    ncb_city: "Abuja",
    estimated_response: "No MLAT — letters rogatory only: 12–36 months",
    notes: "No MLAT. Use letters rogatory (formal judicial assistance). EFCC may assist with cybercrime. Very long timelines — consider FBI Abuja Legat.",
  },
  UA: {
    country_code: "UA", country_name: "Ukraine",
    has_mlat: true, mlat_treaty_name: "Treaty on Mutual Legal Assistance in Criminal Matters (US-Ukraine)", mlat_year: 2000,
    has_cloud_act: false,
    budapest_party: true,
    oai_contact: "DOJ OIA — Europe/Eurasia Desk",
    ncb_city: "Kyiv",
    estimated_response: "MLAT: variable due to conflict conditions",
    notes: "Budapest Convention party. Operational conditions since 2022 may affect response times. Cyberpolice has active ICAC cooperation history.",
  },
  RO: {
    country_code: "RO", country_name: "Romania",
    has_mlat: true, mlat_treaty_name: "Treaty on Mutual Legal Assistance in Criminal Matters (US-Romania)", mlat_year: 2007,
    has_cloud_act: false,
    budapest_party: true,
    oai_contact: "DOJ OIA — EU Desk",
    ncb_city: "Bucharest",
    estimated_response: "MLAT: 4–10 months",
    notes: "DIICOT handles cybercrime MLATs. Strong Budapest Convention engagement.",
  },
};

// ── Fallback for unknown countries ────────────────────────────────────────────

function getFallbackProfile(countryCode: string): CountryTreatyProfile {
  return {
    country_code:        countryCode,
    country_name:        `Country ${countryCode}`,
    has_mlat:            false,
    has_cloud_act:       false,
    budapest_party:      false,
    oai_contact:         "DOJ OIA (oiacriminal@usdoj.gov) — verify country desk",
    estimated_response:  "Unknown — consult DOJ OIA for treaty status",
    notes:               `No pre-configured treaty data for ${countryCode}. Check https://www.justice.gov/criminal-oia for current treaty status.`,
  };
}

export function getCountryProfile(countryCode: string): CountryTreatyProfile {
  return TREATY_DATABASE[countryCode.toUpperCase()] ?? getFallbackProfile(countryCode.toUpperCase());
}

// ── MLAT Request output types ─────────────────────────────────────────────────

export type MLATMechanism = "mlat" | "cloud_act" | "budapest_preservation" | "letters_rogatory" | "ncmec_international";

export interface MLATRequestResult {
  tip_id:            string;
  subject_country:   string;
  treaty_profile:    CountryTreatyProfile;
  recommended_mechanism: MLATMechanism;
  mechanism_rationale:   string;
  estimated_timeline:    string;
  request_draft:         string;     // Full draft text
  preservation_draft:    string;     // Budapest Article 16 preservation (send first)
  target_accounts:       string[];
  applicable_statutes:   string[];
  doj_oia_contact:       string;
  requires_translation:  boolean;
  translation_language?: string;
  tracking_id:           string;
  generated_at:          string;
}

// ── Mechanism selector ────────────────────────────────────────────────────────

function selectMechanism(profile: CountryTreatyProfile): { mechanism: MLATMechanism; rationale: string; timeline: string } {
  if (profile.has_cloud_act) {
    return {
      mechanism:  "cloud_act",
      rationale:  `${profile.country_name} has a CLOUD Act bilateral agreement with the US (${profile.cloud_act_year}). This is significantly faster than MLAT and should be used first.`,
      timeline:   profile.estimated_response.split(";").find(s => s.includes("CLOUD"))?.trim() ?? "2–6 weeks",
    };
  }
  if (profile.budapest_party) {
    return {
      mechanism:  "mlat",
      rationale:  `${profile.country_name} is a Budapest Convention party. Send Article 16 preservation request immediately, then follow with MLAT for disclosure.`,
      timeline:   profile.estimated_response,
    };
  }
  if (profile.has_mlat) {
    return {
      mechanism:  "mlat",
      rationale:  `${profile.country_name} has a bilateral MLAT with the US. No CLOUD Act or Budapest Convention shortcut available.`,
      timeline:   profile.estimated_response,
    };
  }
  return {
    mechanism:  "letters_rogatory",
    rationale:  `${profile.country_name} has no MLAT or CLOUD Act agreement. Letters rogatory (formal judicial assistance) are required and may take 12–36 months.`,
    timeline:   profile.estimated_response,
  };
}

// ── Request drafters ──────────────────────────────────────────────────────────

function buildMLATDraft(
  tip: CyberTip,
  profile: CountryTreatyProfile,
  accounts: string[],
  statutes: string[],
  trackingId: string
): string {
  const ex  = tip.extracted as any;
  const cls = tip.classification as any;
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const treatyRef = profile.mlat_treaty_name
    ? `pursuant to the ${profile.mlat_treaty_name}`
    : "pursuant to applicable bilateral or multilateral legal assistance mechanisms";

  const offenseDesc = String(cls?.offense_category ?? "child sexual exploitation").replace(/_/g, " ").toLowerCase();

  return `
UNITED STATES DEPARTMENT OF JUSTICE
CRIMINAL DIVISION — OFFICE OF INTERNATIONAL AFFAIRS

MUTUAL LEGAL ASSISTANCE REQUEST
Tracking No.: ${trackingId}
Date: ${date}
Priority: ${tip.ncmec_urgent_flag ? "URGENT — VICTIM IN ONGOING DANGER" : "Standard"}

TO:    Central Authority of ${profile.country_name}
       [Insert Ministry of Justice / Attorney General address]

FROM:  United States Department of Justice
       Criminal Division, Office of International Affairs
       1301 New York Avenue, NW, Washington, DC 20005
       Tel: (202) 514-0000 | Fax: (202) 514-0080

REQUESTING AUTHORITY: [ICAC Task Force / Investigating Agency]
CASE REFERENCE: [Local case number] | NCMEC Tip: ${tip.ncmec_tip_number ?? tip.tip_id.slice(0, 8).toUpperCase()}

═══════════════════════════════════════════════════════════════════
           REQUEST FOR MUTUAL LEGAL ASSISTANCE
                    IN CRIMINAL MATTERS
═══════════════════════════════════════════════════════════════════

I. BASIS FOR REQUEST

The United States makes this request ${treatyRef}. The United States and ${profile.country_name} are both parties to the Budapest Convention on Cybercrime (ETS No. 185).${profile.has_mlat ? `\n\nThis request is made pursuant to the ${profile.mlat_treaty_name ?? "applicable MLAT"}.` : ""}

II. PURPOSE OF REQUEST

The United States is investigating a violation of federal criminal law involving ${offenseDesc} in which evidence located in ${profile.country_name} is material and necessary. This request seeks the production of electronic account records from service providers operating in ${profile.country_name}.

III. DESCRIPTION OF OFFENSE

An NCMEC CyberTipline report (No. ${tip.ncmec_tip_number ?? "[TIP NUMBER]"}) was filed by an electronic service provider reporting suspected ${offenseDesc}. The subject accessed the platform from ${profile.country_name}-based infrastructure. The applicable US statutes include:

${statutes.map(s => `  • ${s}`).join("\n")}

The conduct, if occurring in ${profile.country_name}, would constitute violations of [INSERT APPLICABLE ${profile.country_name.toUpperCase()} PENAL CODE SECTIONS — to be completed by agency legal counsel].

IV. DESCRIPTION OF EVIDENCE SOUGHT

The United States respectfully requests the following from providers operating in ${profile.country_name}:

A. For each of the following accounts:
${accounts.map((a, i) => `   ${i + 1}. ${a}`).join("\n")}

B. Categories of records sought:
   (a) Subscriber registration information (name, date of birth, address, email, phone)
   (b) Account access logs for the period [INSERT DATE RANGE]
   (c) All content, communications, and transmitted data
   (d) IP address logs with timestamps
   (e) Payment and financial records
   (f) Device identifiers (IMEI, MAC address, device fingerprints)

V. PERSONS INVOLVED

Subject: ${ex?.subjects?.map((s: any) => s.name ?? s.alias ?? "[Unknown]").join(", ") ?? "[Identity Unknown — account identifiers above]"}
Subject Location: ${profile.country_name}${ex?.subject_city ? `, ${ex.subject_city}` : ""}

VI. URGENCY

${tip.ncmec_urgent_flag
  ? "THIS REQUEST IS URGENT. The victim may be in ongoing danger. Expedited processing is respectfully requested pursuant to Budapest Convention Article 29 or equivalent treaty provision."
  : "Standard processing is requested. Please confirm receipt within 30 days."}

VII. RECIPROCITY

The United States assures ${profile.country_name} that it would provide similar assistance in equivalent circumstances.

VIII. CONFIDENTIALITY

The United States requests that the existence and content of this request be kept confidential to avoid alerting the subject.

IX. CONTACT INFORMATION

For questions regarding this request, contact the Office of International Affairs:
  Email:  oiacriminal@usdoj.gov
  Phone:  (202) 514-0000

[Signature block — to be signed by DOJ OIA attorney]

═══════════════════════════════════════════════════════════════════
DRAFT — Tracking: ${trackingId} | Generated: ${new Date().toISOString()}
Requires review by agency legal counsel and DOJ OIA before submission.
LAW ENFORCEMENT SENSITIVE — FOR OFFICIAL USE ONLY
═══════════════════════════════════════════════════════════════════
`.trim();
}

function buildPreservationDraft(
  tip: CyberTip,
  profile: CountryTreatyProfile,
  accounts: string[],
  trackingId: string
): string {
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const article = profile.budapest_party ? "Budapest Convention on Cybercrime, Article 16" : "applicable bilateral treaty";

  return `
EXPEDITED PRESERVATION REQUEST
(Budapest Convention Article 16 / Equivalent Treaty)
Tracking No.: ${trackingId}-PRES
Date: ${date}

To: Central Authority of ${profile.country_name}
    [Insert applicable authority address]

Re: Immediate Preservation of Electronic Evidence
    NCMEC CyberTip: ${tip.ncmec_tip_number ?? tip.tip_id.slice(0, 8).toUpperCase()}

Pursuant to the ${article}, the United States respectfully requests ${profile.country_name} to immediately direct relevant service providers to preserve electronic data associated with the following accounts:

${accounts.map((a, i) => `  ${i + 1}. ${a}`).join("\n")}

PRESERVATION PERIOD REQUESTED: 90 days

This preservation request does NOT request disclosure. A formal MLAT or other legal process (Reference: ${trackingId}) will follow.

This request is time-sensitive. Data may be deleted in the ordinary course of business if not preserved immediately.

Please confirm receipt within 72 hours.

[Requesting Authority Contact Information — to be completed]

LAW ENFORCEMENT SENSITIVE | ${new Date().toISOString()}
`.trim();
}

// ── Subject country extractor ─────────────────────────────────────────────────

function extractSubjectCountries(tip: CyberTip): string[] {
  const countries = new Set<string>();

  const j  = tip.jurisdiction_of_tip;
  const ex = tip.extracted as any;

  // From jurisdiction profile
  for (const c of j?.countries_involved ?? []) {
    if (c !== "US" && /^[A-Z]{2}$/.test(c)) countries.add(c);
  }

  // From extracted entities
  if (ex?.subject_country && ex.subject_country !== "US") countries.add(String(ex.subject_country));
  for (const subj of ex?.subjects ?? []) {
    const c = String(subj.country ?? subj.location_country ?? "");
    if (c.length === 2 && c !== "US") countries.add(c.toUpperCase());
  }

  return [...countries];
}

function extractTargetAccounts(tip: CyberTip): string[] {
  const ex = tip.extracted as any;
  const accounts: string[] = [];
  if (ex?.account_ids) accounts.push(...ex.account_ids.map((a: string) => String(a)));
  if (ex?.emails)      accounts.push(...ex.emails.map((e: string) => `Email: ${e}`));
  if (ex?.usernames)   accounts.push(...ex.usernames.map((u: string) => `Username: ${u}`));
  if (ex?.ip_addresses) accounts.push(...ex.ip_addresses.slice(0, 5).map((ip: string) => `IP: ${ip}`));
  const cls = tip.classification as any;
  if (cls?.esp_name)   accounts.unshift(`ESP: ${cls.esp_name}`);
  return [...new Set(accounts)].slice(0, 15);
}

function getApplicableStatutes(tip: CyberTip): string[] {
  const cat = String((tip.classification as any)?.offense_category ?? "OTHER");
  const base = ["18 U.S.C. § 2703 (Stored Communications Act)"];
  const map: Record<string, string[]> = {
    CSAM:                  ["18 U.S.C. § 2252A (CSAM)", "18 U.S.C. § 2252 (Sexual Exploitation of Children)"],
    ONLINE_ENTICEMENT:     ["18 U.S.C. § 2422(b) (Online Enticement)", "18 U.S.C. § 2252A"],
    CHILD_SEX_TRAFFICKING: ["18 U.S.C. § 1591 (Sex Trafficking of Children)"],
    CHILD_GROOMING:        ["18 U.S.C. § 2422(b)", "18 U.S.C. § 2423"],
    SEXTORTION:            ["18 U.S.C. § 2261A (Cyberstalking)", "18 U.S.C. § 875(d) (Extortion)"],
  };
  return [...base, ...(map[cat] ?? ["18 U.S.C. § 1030 (CFAA)"])];
}

// ── Main public function ──────────────────────────────────────────────────────

export function generateMLATRequest(tip: CyberTip): MLATRequestResult[] {
  const subjectCountries = extractSubjectCountries(tip);

  if (!subjectCountries.length) {
    // Default to generic international template if no country detected
    subjectCountries.push("XX");
  }

  const accounts  = extractTargetAccounts(tip);
  const statutes  = getApplicableStatutes(tip);
  const results:  MLATRequestResult[] = [];

  for (const countryCode of subjectCountries) {
    const profile     = getCountryProfile(countryCode);
    const { mechanism, rationale, timeline } = selectMechanism(profile);
    const trackingId  = `MLAT-${new Date().getFullYear()}-${tip.tip_id.slice(0, 8).toUpperCase()}-${countryCode}`;

    results.push({
      tip_id:            tip.tip_id,
      subject_country:   countryCode,
      treaty_profile:    profile,
      recommended_mechanism:  mechanism,
      mechanism_rationale:    rationale,
      estimated_timeline:     timeline,
      request_draft:     buildMLATDraft(tip, profile, accounts, statutes, trackingId),
      preservation_draft:buildPreservationDraft(tip, profile, accounts, trackingId),
      target_accounts:   accounts,
      applicable_statutes: statutes,
      doj_oia_contact:   profile.oai_contact,
      requires_translation:  !!profile.language_required,
      translation_language:  profile.language_required,
      tracking_id:       trackingId,
      generated_at:      new Date().toISOString(),
    });
  }

  return results;
}

/**
 * Quick lookup: is this tip international and does it likely need MLAT?
 * Used by Priority Agent to flag tips for MLAT workflow.
 */
export function tipNeedsMLAT(tip: CyberTip): boolean {
  const countries = extractSubjectCountries(tip);
  if (!countries.length) return false;
  return countries.some(c => TREATY_DATABASE[c] !== undefined || c !== "US");
}
