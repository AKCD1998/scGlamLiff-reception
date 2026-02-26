# Service Naming Canonicalization

## What was wrong
- Service labels were built from mixed sources:
  - `treatments.title_th/title_en`
  - legacy `treatment_item_text`
  - local UI string composition
- The same treatment could appear as different labels (Thai plain, Thai + price, English).

## Canonical source now
- Canonical queue endpoint: `GET /api/appointments/queue`
- Canonical field for UI display: `treatment_display`
- Canonical formatter source:
  - Backend: `backend/src/utils/formatTreatmentDisplay.js`
  - Frontend mirror: `src/utils/formatTreatmentDisplay.js`

Name priority:
1. `name_en` (preferred)
2. fallback by code (for `smooth*` => `Smooth`)
3. `name_th`
4. generic fallback

Display format:
- `Smooth (399)`
- `3x Smooth (999) | Mask 1`
- `10x Smooth (2999) | Mask 3`

## DB migration
- Script: `backend/scripts/migrate_treatments_catalog_fields.js`
- Adds/ensures columns:
  - `name_en`, `name_th`
  - `price_thb`, `sessions_included`, `mask_included`
- Keeps `title_en/title_th` for backward compatibility.
- Sets canonical smooth row (`f8c60310-abc0-4eaf-ae3a-e9e9e0e06dc0`) to English primary name.

Run:
```bash
cd backend
npm run migrate:treatments-catalog
```

## Legacy backfill (safe mode)
- Script: `backend/scripts/backfill_treatment_id_from_text.js`
- Default mode is dry-run.
- `--apply` is required for actual writes.
- Writes audit rows to `maintenance_audit_logs`.
- Does not mutate historical events in-place; appends an event row.
- Rollback path:
  - dry-run always rolls back transaction
  - apply mode is append-audit + append-event, so changes are traceable and reversible with a follow-up script

Run:
```bash
cd backend
npm run backfill:treatment-id-from-text
npm run backfill:treatment-id-from-text -- --apply
```

Optional args:
- `--days=180`
- `--limit=2000`

## Verification
- Script: `backend/scripts/verify_treatment_display_consistency.js`
- Checks queue rows and fails if rows with `treatment_id` still show raw Thai smooth label.

Run:
```bash
cd backend
npm run verify:treatment-display
```

## Dev preview
- Backend preview log for booking options:
  - `DEBUG_TREATMENT_CATALOG_PREVIEW=true`
- Frontend preview log in Booking page:
  - `VITE_DEBUG_TREATMENT_CATALOG=true`

Both logs are dev-only and print:
- `treatment_id`
- `name_en`
- `name_th`
- computed `treatment_display`
