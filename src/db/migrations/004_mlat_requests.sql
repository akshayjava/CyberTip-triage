-- MLAT Request Persistence
-- P1 Feature: Track generated MLAT/CLOUD Act requests for admin visibility.

CREATE TABLE IF NOT EXISTS mlat_requests (
  request_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_id              UUID NOT NULL REFERENCES cyber_tips(tip_id) ON DELETE CASCADE,
  target_country      TEXT NOT NULL, -- ISO 2-char code
  mechanism           TEXT NOT NULL, -- 'mlat' | 'cloud_act' | 'budapest_preservation' | ...
  status              TEXT NOT NULL DEFAULT 'generated', -- generated | submitted | completed
  tracking_id         TEXT NOT NULL, -- e.g. MLAT-2026-TIPID-GB
  request_body        TEXT NOT NULL,
  preservation_body   TEXT,
  target_accounts     TEXT[], -- Array of strings
  full_request_json   JSONB,  -- Store complete generation result for fidelity
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mlat_tip_id
  ON mlat_requests(tip_id);
CREATE INDEX IF NOT EXISTS idx_mlat_country
  ON mlat_requests(target_country);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mlat_tracking_id
  ON mlat_requests(tracking_id);
