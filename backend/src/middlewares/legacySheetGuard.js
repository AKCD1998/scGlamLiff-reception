const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function legacySheetEnabled() {
  return TRUE_VALUES.has(String(process.env.LEGACY_SHEET_MODE || '').trim().toLowerCase());
}

function isAdminRole(roleName) {
  const role = String(roleName || '').trim().toLowerCase();
  return role === 'admin' || role === 'owner';
}

export default function legacySheetGuard(req, res, next) {
  if (isAdminRole(req.user?.role_name)) {
    return next();
  }

  if (legacySheetEnabled()) {
    return next();
  }

  return res.status(410).json({ ok: false, error: 'Legacy sheet endpoints are disabled' });
}

