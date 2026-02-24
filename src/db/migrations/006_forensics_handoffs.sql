-- Forensics Handoff Tracking
-- Tracks every handoff package generated for a CyberTip → forensics tool.
-- Wilson compliance counts (files_included / files_blocked_wilson) are
-- persisted for audit purposes.
--
-- Run with: psql $DATABASE_URL < src/db/migrations/006_forensics_handoffs.sql

CREATE TABLE IF NOT EXISTS forensics_handoffs (
  handoff_id           UUID PRIMARY KEY,
  tip_id               UUID NOT NULL REFERENCES cyber_tips(tip_id) ON DELETE CASCADE,
  platform             TEXT NOT NULL,  -- GRIFFEYE | AXIOM | FTK | CELLEBRITE | ENCASE | GENERIC
  generated_at         TIMESTAMPTZ NOT NULL,
  generated_by         TEXT NOT NULL,  -- officer badge / investigator_id
  status               TEXT NOT NULL DEFAULT 'pending',
                         -- pending | delivered | imported | completed
  delivered_at         TIMESTAMPTZ,
  imported_at          TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  files_included       INTEGER NOT NULL DEFAULT 0,  -- Wilson-cleared files only
  files_blocked_wilson INTEGER NOT NULL DEFAULT 0,  -- excluded due to warrant requirement
  export_format        TEXT NOT NULL,
  export_size_bytes    INTEGER,
  notes                TEXT,
  full_handoff_json    JSONB NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup of all handoffs for a given tip
CREATE INDEX IF NOT EXISTS idx_forensics_handoffs_tip_id
  ON forensics_handoffs (tip_id, generated_at DESC);

-- Track handoffs by investigator
CREATE INDEX IF NOT EXISTS idx_forensics_handoffs_generated_by
  ON forensics_handoffs (generated_by, generated_at DESC);

-- Filter by status for workflow dashboards
CREATE INDEX IF NOT EXISTS idx_forensics_handoffs_status
  ON forensics_handoffs (status, generated_at DESC);
