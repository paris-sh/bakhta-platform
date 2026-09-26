-- 0036_game_rule_versions_schema_version.down.sql
ALTER TABLE game_rule_versions
  DROP CONSTRAINT IF EXISTS ck_game_rule_versions_schema_version_present;
