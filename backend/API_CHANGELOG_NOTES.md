# API Integration Notes

- Auth is cookie-based, not Bearer-based. Browser clients must use `credentials: 'include'` and rely on the HttpOnly `token` cookie.
- The canonical runtime queue is `GET /api/appointments/queue`. Do not use `/api/visits` or GAS-backed `GET /api/appointments` as substitutes.
- Booking create should use `POST /api/appointments` with explicit `treatment_id`, explicit `package_id` when relevant, and `scheduled_at` including timezone offset.
- Queue/calendar date logic is Bangkok-local. Split `visit_date` + `visit_time_text` is converted to `+07:00`.
- Customer identity is phone-driven. Reusing a phone can link to an existing customer and update `customers.full_name`.
- Real course deduction happens through `POST /api/appointments/:id/complete`, not through plain status patching.
- `cancel` and `no-show` are status-only and do not deduct a package/course.
- Admin patching can move an appointment to another customer when phone ownership conflicts, but only with `reassign_customer_by_phone=true`.
- Legacy sheet endpoints are guarded by `legacySheetGuard` and may return `410` for non-admin users unless `LEGACY_SHEET_MODE=true`.
- Some endpoints are public by current route code (`/api/customers/*`, legacy GAS helpers, `DELETE /api/appointments/:id`). Treat that as observed behavior, not a design guarantee.
