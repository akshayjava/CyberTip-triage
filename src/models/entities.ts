import { z } from "zod";

// IWF-aligned age ranges for international compatibility
export const VictimAgeRangeSchema = z.enum([
  "0-2",
  "3-5",
  "6-9",
  "10-12",
  "13-15",
  "16-17",
  "adult",
  "unknown",
]);
export type VictimAgeRange = z.infer<typeof VictimAgeRangeSchema>;

export const EntityMatchSchema = z.object({
  value: z.string().min(1),
  platform: z.string().optional(),
  coin_type: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  raw_mention: z.string().min(1),
  is_tor_related: z.boolean().optional(),
  is_dark_web: z.boolean().optional(),
});
export type EntityMatch = z.infer<typeof EntityMatchSchema>;

export const SubjectSchema = z.object({
  subject_id: z.string().uuid(),
  name: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  dob: z.string().date().optional(),
  age: z.number().int().positive().optional(),
  gender: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state_province: z.string().optional(),
  country: z.string().length(2).optional(),
  employer: z.string().optional(),
  school: z.string().optional(),
  vehicle_description: z.string().optional(),
  accounts: z.array(z.string()),
  known_tip_ids: z.array(z.string().uuid()),
  dark_web_aliases: z.array(z.string()).optional(),
  raw_mentions: z.array(z.string()),
});
export type Subject = z.infer<typeof SubjectSchema>;

export const VictimSchema = z.object({
  age_range: VictimAgeRangeSchema,
  count: z.number().int().positive().optional(),
  relationship_to_subject: z.string().optional(),
  ongoing_abuse_indicated: z.boolean(),
  victim_crisis_indicators: z.array(z.string()),
  details: z.string().optional(),
  raw_mentions: z.array(z.string()),
});
export type Victim = z.infer<typeof VictimSchema>;

export const ExtractedEntitiesSchema = z.object({
  subjects: z.array(SubjectSchema),
  victims: z.array(VictimSchema),

  ip_addresses: z.array(EntityMatchSchema),
  email_addresses: z.array(EntityMatchSchema),
  urls: z.array(EntityMatchSchema),
  domains: z.array(EntityMatchSchema),
  usernames: z.array(EntityMatchSchema),
  phone_numbers: z.array(EntityMatchSchema),
  device_identifiers: z.array(EntityMatchSchema),
  file_hashes: z.array(EntityMatchSchema),
  crypto_addresses: z.array(EntityMatchSchema),
  game_platform_ids: z.array(EntityMatchSchema),
  messaging_app_ids: z.array(EntityMatchSchema),
  dark_web_urls: z.array(EntityMatchSchema),

  geographic_indicators: z.array(EntityMatchSchema),
  venues: z.array(EntityMatchSchema),

  dates_mentioned: z.array(EntityMatchSchema),
  urgency_indicators: z.array(z.string()),

  referenced_platforms: z.array(z.string()),
  data_retention_notes: z.array(z.string()),

  // High-priority array — triggers crisis pathway in Priority Agent
  victim_crisis_indicators: z.array(z.string()),
});
export type ExtractedEntities = z.infer<typeof ExtractedEntitiesSchema>;
