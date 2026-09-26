-- 0036_game_rule_versions_schema_version.up.sql
-- Purpose: every game_rule_versions.rules payload must declare which JSON schema version it
-- was authored against, as an integer `schema_version` key. This lets the application
-- resolve the correct validator by (game_type, schema_version) and — critically — never
-- forces old, already-stored rule versions to be re-validated against a newer schema when
-- one is introduced later: each schema_version keeps its own validator, permanently.
--
-- Defense in depth, same pattern as ck_game_rule_versions_four_leaf_rounding (0009): this
-- CHECK is a coarse "is it present and numeric" guarantee at the database layer: the real,
-- precise validation (is it a supported version, does the rest of the payload match that
-- version's shape) happens in the application layer, which is where a per-version
-- validator registry can actually live.

-- NOTE: jsonb_typeof(rules -> 'schema_version') alone is not sufficient — when the key is
-- absent, `rules -> 'schema_version'` is SQL NULL, jsonb_typeof(NULL) is NULL, and
-- `NULL = 'number'` is NULL, which a CHECK constraint treats as PASSING (constraints only
-- reject on an explicit FALSE, never on NULL). The key's presence must be asserted
-- separately so a missing schema_version is an explicit failure, not a silently-allowed NULL.
ALTER TABLE game_rule_versions
  ADD CONSTRAINT ck_game_rule_versions_schema_version_present
  CHECK (
    rules ? 'schema_version'
    AND jsonb_typeof(rules -> 'schema_version') = 'number'
  );

COMMENT ON CONSTRAINT ck_game_rule_versions_schema_version_present ON game_rule_versions IS
  'Every rules payload must declare an integer schema_version. Precise validation (is it a supported version, does the payload match that version''s shape) is an application-layer concern — see backend/src/modules/games/rules.schemas.ts.';
