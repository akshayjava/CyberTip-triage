export interface DeconflictionResult {
  match_found: boolean;
  agency_name?: string;
  case_number?: string;
  contact_investigator?: string;
  overlap_type?: "same_subject" | "same_victim" | "same_ip" | "same_hash" | "same_username";
  active_investigation: boolean;
  coordination_recommended: boolean;
  notes?: string;
  /**
   * WARNING: When true, this result was produced by a stub/simulated provider.
   * It does NOT reflect real RISSafe/HighWay deconfliction databases.
   * Investigators MUST verify manually before relying on this result.
   */
  simulated_warning?: boolean;
}

export interface DeconflictionProvider {
  check(identifierType: string, value: string, jurisdiction: string): Promise<DeconflictionResult>;
}
