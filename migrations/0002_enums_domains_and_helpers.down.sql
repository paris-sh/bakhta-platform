-- 0002_enums_domains_and_helpers.down.sql

DROP FUNCTION IF EXISTS reject_mutation();
DROP FUNCTION IF EXISTS set_updated_at();

DROP TYPE IF EXISTS outbox_status_enum;
DROP TYPE IF EXISTS notification_status_enum;
DROP TYPE IF EXISTS notification_channel_enum;
DROP TYPE IF EXISTS recipient_type_enum;
DROP TYPE IF EXISTS support_status_enum;
DROP TYPE IF EXISTS support_category_enum;
DROP TYPE IF EXISTS requester_type_enum;
DROP TYPE IF EXISTS claim_award_link_reason_enum;
DROP TYPE IF EXISTS claim_status_enum;
DROP TYPE IF EXISTS claim_submission_method_enum;
DROP TYPE IF EXISTS claimant_type_enum;
DROP TYPE IF EXISTS award_status_enum;
DROP TYPE IF EXISTS award_type_enum;
DROP TYPE IF EXISTS calc_run_status_enum;
DROP TYPE IF EXISTS result_status_enum;
DROP TYPE IF EXISTS credential_reason_enum;
DROP TYPE IF EXISTS credential_status_enum;
DROP TYPE IF EXISTS ownership_change_type_enum;
DROP TYPE IF EXISTS ticket_outcome_enum;
DROP TYPE IF EXISTS ticket_status_enum;
DROP TYPE IF EXISTS ticket_source_enum;
DROP TYPE IF EXISTS order_status_enum;
DROP TYPE IF EXISTS purchaser_type_enum;
DROP TYPE IF EXISTS actor_type_enum;
DROP TYPE IF EXISTS override_scope_enum;
DROP TYPE IF EXISTS draw_evidence_status_enum;
DROP TYPE IF EXISTS draw_status_enum;
DROP TYPE IF EXISTS rule_version_status_enum;
DROP TYPE IF EXISTS game_type_enum;
DROP TYPE IF EXISTS game_status_enum;
DROP TYPE IF EXISTS auth_attempt_result_enum;
DROP TYPE IF EXISTS session_status_enum;
DROP TYPE IF EXISTS session_principal_enum;
DROP TYPE IF EXISTS permission_risk_enum;
DROP TYPE IF EXISTS account_status_enum;

DROP DOMAIN IF EXISTS four_digit_code;
DROP DOMAIN IF EXISTS sha256_digest;
DROP DOMAIN IF EXISTS basis_points;
DROP DOMAIN IF EXISTS nonneg_int;
DROP DOMAIN IF EXISTS toman_amount;
