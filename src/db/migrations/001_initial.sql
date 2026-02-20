-- CyberTip Triage System — Initial Schema
-- Run with: psql $DATABASE_URL < src/db/migrations/001_initial.sql

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- Fuzzy text search for names

-- ── Main tip table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cyber_tips (
  tip_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ncmec_tip_number       TEXT,
  ids_case_number        TEXT,
  source                 TEXT NOT NULL,
  received_at            TIMESTAMPTZ NOT NULL,
  raw_body               TEXT NOT NULL,
  normalized_body        TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending',
  is_bundled             BOOLEAN NOT NULL DEFAULT FALSE,
  bundled_incident_count INTEGER,
  ncmec_urgent_flag      BOOLEAN NOT NULL DEFAULT FALSE,
  reporter               JSONB,
  jurisdiction_of_tip    JSONB,
  legal_status           JSONB,
  extracted              JSONB,
  hash_matches           JSONB,
  classification         JSONB,
  links                  JSONB,
  priority               JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Files table (normalized for hash lookups) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS tip_files (
  file_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_id                 UUID NOT NULL REFERENCES cyber_tips(tip_id) ON DELETE CASCADE,
  filename               TEXT,
  media_type             TEXT,
  hash_md5               TEXT,
  hash_sha1              TEXT,
  hash_sha256            TEXT,
  photodna_hash          TEXT,
  -- Wilson compliance fields
  esp_viewed             BOOLEAN NOT NULL,
  esp_viewed_missing     BOOLEAN NOT NULL DEFAULT FALSE,
  esp_categorized_as     TEXT,
  publicly_available     BOOLEAN NOT NULL,
  warrant_required       BOOLEAN NOT NULL,
  warrant_status         TEXT NOT NULL DEFAULT 'not_needed',
  warrant_number         TEXT,
  warrant_granted_by     TEXT,
  file_access_blocked    BOOLEAN NOT NULL,
  -- Hash match results
  ncmec_hash_match       BOOLEAN NOT NULL DEFAULT FALSE,
  project_vic_match      BOOLEAN NOT NULL DEFAULT FALSE,
  iwf_match              BOOLEAN NOT NULL DEFAULT FALSE,
  interpol_icse_match    BOOLEAN NOT NULL DEFAULT FALSE,
  aig_csam_suspected     BOOLEAN NOT NULL DEFAULT FALSE,
  aig_detection_confidence NUMERIC(4,3),
  aig_detection_method   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Preservation requests ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS preservation_requests (
  request_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_id                    UUID NOT NULL REFERENCES cyber_tips(tip_id),
  esp_name                  TEXT NOT NULL,
  account_identifiers       JSONB NOT NULL,  -- string[]
  legal_basis               TEXT NOT NULL,
  jurisdiction              TEXT NOT NULL,
  issued_at                 TIMESTAMPTZ,
  deadline_for_esp_response DATE,
  esp_retention_window_days INTEGER,
  status                    TEXT NOT NULL DEFAULT 'draft',
  auto_generated            BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by               TEXT,
  letter_text               TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Audit log (APPEND-ONLY — no UPDATE or DELETE ever permitted) ──────────────

CREATE TABLE IF NOT EXISTS audit_log (
  entry_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_id         UUID NOT NULL,
  agent          TEXT NOT NULL,
  timestamp      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms    INTEGER,
  status         TEXT NOT NULL,
  summary        TEXT NOT NULL,
  model_used     TEXT,
  tokens_used    INTEGER,
  error_detail   TEXT,
  human_actor    TEXT,
  previous_value JSONB,
  new_value      JSONB
);

-- Enforce append-only on audit_log at database level
CREATE OR REPLACE RULE audit_log_no_update AS
  ON UPDATE TO audit_log DO INSTEAD NOTHING;

CREATE OR REPLACE RULE audit_log_no_delete AS
  ON DELETE TO audit_log DO INSTEAD NOTHING;

-- Alternative: trigger that raises an exception (stricter)
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only. UPDATE and DELETE are not permitted.';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tips_status
  ON cyber_tips(status);
CREATE INDEX IF NOT EXISTS idx_tips_received
  ON cyber_tips(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_tips_ncmec_number
  ON cyber_tips(ncmec_tip_number) WHERE ncmec_tip_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_files_tip_id
  ON tip_files(tip_id);
CREATE INDEX IF NOT EXISTS idx_files_hash_md5
  ON tip_files(hash_md5) WHERE hash_md5 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_hash_sha256
  ON tip_files(hash_sha256) WHERE hash_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_photodna
  ON tip_files(photodna_hash) WHERE photodna_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_warrant_status
  ON tip_files(warrant_status) WHERE file_access_blocked = TRUE;

CREATE INDEX IF NOT EXISTS idx_preservation_tip_id
  ON preservation_requests(tip_id);
CREATE INDEX IF NOT EXISTS idx_preservation_status
  ON preservation_requests(status);

CREATE INDEX IF NOT EXISTS idx_audit_tip_id
  ON audit_log(tip_id);
CREATE INDEX IF NOT EXISTS idx_audit_agent
  ON audit_log(agent);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp
  ON audit_log(timestamp DESC);

-- GIN indexes for JSONB search
CREATE INDEX IF NOT EXISTS idx_classification_gin
  ON cyber_tips USING GIN(classification);
CREATE INDEX IF NOT EXISTS idx_extracted_gin
  ON cyber_tips USING GIN(extracted);
CREATE INDEX IF NOT EXISTS idx_links_gin
  ON cyber_tips USING GIN(links);

-- Trigram index for fuzzy subject name search
CREATE INDEX IF NOT EXISTS idx_extracted_trgm
  ON cyber_tips USING GIN((extracted::text) gin_trgm_ops);

-- ── Sent alerts tracking (deduplication + audit) ─────────────────────────────
-- Tracks every alert dispatched so the same tip doesn't flood supervisors
-- and so there's a complete record of who was notified and when.

CREATE TABLE IF NOT EXISTS sent_alerts (
  alert_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_id         UUID NOT NULL,    -- May not be in cyber_tips yet (early pipeline stage)
  alert_type     TEXT NOT NULL,    -- 'supervisor' | 'deconfliction_pause' | 'victim_crisis'
  channels       TEXT[] NOT NULL,  -- ['email', 'sms', 'console']
  recipients     TEXT[] NOT NULL,  -- email addresses or 'SMS:+1...'
  delivered      BOOLEAN NOT NULL DEFAULT TRUE,
  error_detail   TEXT,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_tip_id
  ON sent_alerts(tip_id);
CREATE INDEX IF NOT EXISTS idx_alerts_type
  ON sent_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_sent_at
  ON sent_alerts(sent_at DESC);

-- Unique constraint prevents duplicate alerts per tip per type
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_dedup
  ON sent_alerts(tip_id, alert_type);
