import jwt from 'jsonwebtoken';
import { authenticateStaffCredentials } from '../services/staffAuthService.js';

const isProduction = process.env.NODE_ENV === 'production';
const requestedSameSite = (process.env.COOKIE_SAMESITE || '').toLowerCase();
const cookieSameSite = ['lax', 'strict', 'none'].includes(requestedSameSite)
  ? requestedSameSite
  : isProduction
    ? 'none'
    : 'lax';
const cookieSecure =
  process.env.COOKIE_SECURE === 'true' ||
  cookieSameSite === 'none' ||
  isProduction;

const cookieOptions = {
  httpOnly: true,
  sameSite: cookieSameSite,
  secure: cookieSecure,
};

export async function login(req, res) {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Missing credentials' });
    }

    const authResult = await authenticateStaffCredentials({
      username,
      password,
      recordAudit: true,
    });

    if (!authResult.ok || !authResult.user) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const user = authResult.user;

    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.cookie('token', token, cookieOptions);
    return res.json({
      ok: true,
      data: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
      },
    });
  } catch (_error) {
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

export function me(req, res) {
  return res.json({ ok: true, data: req.user });
}

export function logout(req, res) {
  res.clearCookie('token', cookieOptions);
  return res.json({ ok: true, data: { message: 'Logged out' } });
}
