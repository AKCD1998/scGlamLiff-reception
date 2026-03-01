-- Optional guardrail migration (manual run):
-- Ensure only one package_usages row can exist per appointment.
-- This keeps deduction idempotent for appointment-level completion flow.
--
-- Pre-check duplicate rows before applying:
--   SELECT appointment_id, COUNT(*)::int
--   FROM package_usages
--   WHERE appointment_id IS NOT NULL
--   GROUP BY appointment_id
--   HAVING COUNT(*) > 1;
--
-- Apply once data is clean.
CREATE UNIQUE INDEX IF NOT EXISTS package_usages_appointment_id_unique_idx
  ON package_usages (appointment_id)
  WHERE appointment_id IS NOT NULL;

