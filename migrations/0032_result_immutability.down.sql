-- 0032_result_immutability.down.sql
DROP TRIGGER IF EXISTS trg_six_chance_results_immutability ON six_chance_results;
DROP TRIGGER IF EXISTS trg_four_leaf_results_immutability ON four_leaf_results;
DROP FUNCTION IF EXISTS prevent_published_result_value_mutation();
DROP TRIGGER IF EXISTS trg_results_reject_delete ON results;
DROP TRIGGER IF EXISTS trg_results_prevent_published_mutation ON results;
DROP FUNCTION IF EXISTS prevent_published_result_mutation();
