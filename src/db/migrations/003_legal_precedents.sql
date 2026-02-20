-- ── Migration 003: Legal Precedents & Circuit Rule Overrides ─────────────────
-- Run after 002_officers.sql
-- Persists the PRECEDENT_LOG and circuit rule overrides so supervisor actions
-- survive server restarts and actually affect warrant decisions.

-- ── Legal precedents (replaces in-memory PRECEDENT_LOG array) ────────────────

CREATE TABLE IF NOT EXISTS legal_precedents (
  precedent_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date           DATE NOT NULL,
  circuit        TEXT NOT NULL,
  case_name      TEXT NOT NULL,
  citation       TEXT NOT NULL,
  effect         TEXT NOT NULL,
  summary        TEXT NOT NULL,
  added_by       TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT precedent_circuit_check CHECK (
    circuit IN ('1st','2nd','3rd','4th','5th','6th','7th','8th','9th','10th','11th','DC')
  ),
  CONSTRAINT precedent_effect_check CHECK (
    effect IN ('now_binding','affirmed','limited','reversed')
  )
);

CREATE INDEX IF NOT EXISTS idx_precedents_circuit  ON legal_precedents(circuit);
CREATE INDEX IF NOT EXISTS idx_precedents_date     ON legal_precedents(date DESC);
CREATE INDEX IF NOT EXISTS idx_precedents_effect   ON legal_precedents(effect);

-- ── Circuit rule overrides ────────────────────────────────────────────────────
-- When a supervisor records a now_binding precedent, they can also override
-- the hardcoded CIRCUIT_RULES application mode and binding_precedent field.
-- These overrides are loaded at startup and merged with the hardcoded defaults,
-- so the deterministic warrant logic reflects the current legal standard.

CREATE TABLE IF NOT EXISTS circuit_rule_overrides (
  circuit               TEXT PRIMARY KEY,
  binding_precedent     TEXT,          -- citation of the binding case
  application           TEXT NOT NULL, -- strict_wilson | conservative_wilson | no_precedent_conservative
  file_access_standard  TEXT,          -- short description of current standard
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            TEXT NOT NULL, -- badge number of supervisor who set this

  CONSTRAINT override_circuit_check CHECK (
    circuit IN ('1st','2nd','3rd','4th','5th','6th','7th','8th','9th','10th','11th','DC')
  ),
  CONSTRAINT override_application_check CHECK (
    application IN ('strict_wilson','conservative_wilson','no_precedent_conservative')
  )
);

-- ── Seed the Wilson precedent (9th Circuit) ───────────────────────────────────
-- This is the foundational precedent that was previously hardcoded in PRECEDENT_LOG

INSERT INTO legal_precedents (date, circuit, case_name, citation, effect, summary, added_by)
VALUES (
  '2020-09-18',
  '9th',
  'United States v. Wilson',
  '13 F.4th 961 (9th Cir. 2020)',
  'now_binding',
  'Warrant required to open CyberTip files that the ESP did not itself view prior to reporting.',
  'SYSTEM'
)
ON CONFLICT DO NOTHING;
