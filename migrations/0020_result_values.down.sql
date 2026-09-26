-- 0020_result_values.down.sql
DROP TRIGGER IF EXISTS trg_results_value_cardinality ON results;
DROP FUNCTION IF EXISTS validate_result_value_cardinality();
DROP TABLE IF EXISTS six_chance_results;
DROP TABLE IF EXISTS four_leaf_results;
