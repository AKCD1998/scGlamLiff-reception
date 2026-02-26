# Treatments Catalog Migration (Smooth Metadata)

## Purpose
Populate missing Smooth catalog metadata once so display formatting is deterministic from `treatments` metadata:
- `Smooth (399)` for one-off
- `3x Smooth (999) | Mask 1`
- `10x Smooth (2999) | Mask 3`

Target treatment (default):
- `f8c60310-abc0-4eaf-ae3a-e9e9e0e06dc0`

Fields updated by this migration:
- `price_thb = 399`
- `sessions_included = 1`
- `mask_included = 0`

Notes:
- Name fields are not rewritten by this migration.
- Display text is never embedded into name fields.

## Script
- `backend/scripts/migrate_treatments_catalog_fields.js`

CLI flags:
- `--dry-run` (default behavior if `--apply` is omitted)
- `--apply` (required to write)
- `--treatment-id=<uuid>` (recommended when more than one Smooth-like row exists)
- `--force` (allows overwrite of non-legacy non-null metadata with warning)

## Run Dry-Run First
```bash
cd backend
npm run migrate:treatments-catalog:dry
```

What dry-run prints:
- matched Smooth rows
- chosen target row
- before/after field plan
- safety checks and conflicts
- formatter smoke output

## Apply
```bash
cd backend
npm run migrate:treatments-catalog
```

Apply mode:
- wraps writes in transaction
- writes one `audit_logs` row with:
  - `action = 'CATALOG_MIGRATE_TREATMENT_FIELDS'`
  - `before_json`
  - `after_json`
- commits on success, rolls back on error

## Rollback Guidance
1. Fetch latest audit log for this action:
```sql
SELECT id, entity_id, before_json, after_json, created_at
FROM audit_logs
WHERE action = 'CATALOG_MIGRATE_TREATMENT_FIELDS'
ORDER BY created_at DESC
LIMIT 20;
```

2. Restore previous values from `before_json`:
```sql
UPDATE treatments
SET
  price_thb = (before_json->>'price_thb')::int,
  sessions_included = (before_json->>'sessions_included')::int,
  mask_included = (before_json->>'mask_included')::int
FROM audit_logs al
WHERE treatments.id = al.entity_id
  AND al.id = '<audit_log_id>';
```

3. Re-run dry-run to confirm plan is now correct.
