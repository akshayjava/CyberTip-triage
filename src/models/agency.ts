export interface Agency {
  agency_id: string;
  name: string;
  api_key: string;
  status: "active" | "inactive";
  contact_email?: string;
  created_at: string;
}
