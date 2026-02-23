export interface DeconflictionResult {
  match_found: boolean;
  agency_name?: string;
  case_number?: string;
  contact_investigator?: string;
  overlap_type?: "same_subject" | "same_victim" | "same_ip" | "same_hash" | "same_username";
  active_investigation: boolean;
  coordination_recommended: boolean;
  notes?: string;
}

export interface DeconflictionProvider {
  check(identifierType: string, value: string, jurisdiction: string): Promise<DeconflictionResult>;
}
