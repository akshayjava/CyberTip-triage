-- ── Migration 002: Officers, Warrant Applications, Token Revocation ───────────
-- Run after 001_initial.sql
-- Adds Tier 2 tables: officers, warrant_applications, revoked_tokens

-- ── Officers ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS officers (
  officer_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_number         TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  rank                 TEXT NOT NULL DEFAULT '',
  unit                 TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'investigator',
  email                TEXT NOT NULL UNIQUE,
  phone                TEXT,
  specialty            TEXT,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  supervisor_id        UUID REFERENCES officers(officer_id),
  max_concurrent_cases INTEGER NOT NULL DEFAULT 20,
  password_hash        TEXT,            -- PBKDF2:iters:salt:hash
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,

  CONSTRAINT officer_role_check CHECK (
    role IN ('analyst','investigator','supervisor','commander','admin')
  ),
  CONSTRAINT officer_unit_check CHECK (
    unit IN ('ICAC','FINANCIAL_CRIMES','CYBER','JTTF','GENERAL_INV','SUPERVISOR')
  )
);

-- Index badge_number for login queries (high-frequency)
CREATE INDEX IF NOT EXISTS idx_officers_badge ON officers(badge_number);
CREATE INDEX IF NOT EXISTS idx_officers_unit  ON officers(unit);
CREATE INDEX IF NOT EXISTS idx_officers_role  ON officers(role);
CREATE INDEX IF NOT EXISTS idx_officers_active ON officers(active) WHERE active = TRUE;

-- ── tip_assignments (many-to-many: officer ↔ tip) ─────────────────────────────

CREATE TABLE IF NOT EXISTS tip_assignments (
  assignment_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_id           UUID NOT NULL REFERENCES cyber_tips(tip_id),
  officer_id       UUID NOT NULL REFERENCES officers(officer_id),
  assigned_by      UUID REFERENCES officers(officer_id),
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date         DATE,
  status           TEXT NOT NULL DEFAULT 'active',  -- active | transferred | completed
  notes            TEXT,

  CONSTRAINT assignment_status_check CHECK (
    status IN ('active','transferred','completed')
  )
);

CREATE INDEX IF NOT EXISTS idx_assignments_tip    ON tip_assignments(tip_id);
CREATE INDEX IF NOT EXISTS idx_assignments_officer ON tip_assignments(officer_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status  ON tip_assignments(status) WHERE status = 'active';

-- ── Warrant applications (Tier 2.2) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS warrant_applications (
  application_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tip_id           UUID NOT NULL REFERENCES cyber_tips(tip_id),
  file_ids         JSONB NOT NULL,           -- string[] of file UUIDs covered
  status           TEXT NOT NULL DEFAULT 'draft',
  affidavit_draft  TEXT NOT NULL,
  affidavit_final  TEXT,                     -- Set when approved by supervisor
  warrant_number   TEXT,
  granting_judge   TEXT,
  court            TEXT,
  da_name          TEXT,
  submitted_at     TIMESTAMPTZ,
  filed_at         TIMESTAMPTZ,
  decided_at       TIMESTAMPTZ,
  denial_reason    TEXT,
  created_by       TEXT NOT NULL,            -- Badge number
  approved_by      TEXT,                     -- Supervisor badge number
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT warrant_status_check CHECK (
    status IN ('draft','pending_da_review','pending_court','granted','denied','withdrawn')
  )
);

CREATE INDEX IF NOT EXISTS idx_warrants_tip_id ON warrant_applications(tip_id);
CREATE INDEX IF NOT EXISTS idx_warrants_status ON warrant_applications(status);
CREATE INDEX IF NOT EXISTS idx_warrants_created ON warrant_applications(created_at DESC);

-- Auto-update updated_at on modification
CREATE OR REPLACE FUNCTION update_warrant_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS warrant_updated_at ON warrant_applications;
CREATE TRIGGER warrant_updated_at
  BEFORE UPDATE ON warrant_applications
  FOR EACH ROW EXECUTE FUNCTION update_warrant_timestamp();

-- ── JWT revocation list (Tier 2.4) ───────────────────────────────────────────
-- Stores token IDs (jti claim) for explicitly revoked tokens.
-- Tokens not in this table AND not expired are considered valid.

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti          TEXT PRIMARY KEY,             -- JWT ID claim (UUID)
  officer_id   UUID,                         -- Which officer's token
  revoked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason       TEXT                          -- 'logout' | 'admin_revoke' | 'security'
);

-- Automatically clean up expired entries (tokens > 8h old are already invalid)
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_revoked_at
  ON revoked_tokens(revoked_at);

-- Cleanup job hint: DELETE FROM revoked_tokens WHERE revoked_at < NOW() - INTERVAL '8 hours';

-- ── Default admin officer (change password immediately in production) ──────────

INSERT INTO officers (badge_number, name, rank, unit, role, email, password_hash)
VALUES (
  'ADMIN-001',
  'System Administrator',
  'Administrator',
  'SUPERVISOR',
  'admin',
  'admin@agency.local',
  -- Default password: 'ChangeMe123!' — MUST be changed before production
  'pbkdf2:100000:REPLACEWITHREALSALT:REPLACEWITHREALHASH'
)
ON CONFLICT (badge_number) DO NOTHING;
