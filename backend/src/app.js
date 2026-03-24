import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';

import requireAuth from './middlewares/requireAuth.js';
import authRoutes from './routes/auth.js';
import appointmentRoutes from './routes/appointments.js';
import appointmentDraftRoutes from './routes/appointmentDrafts.js';
import adminAppointmentRoutes from './routes/adminAppointments.js';
import branchDeviceRegistrationRoutes from './routes/branchDeviceRegistrations.js';
import reportingRoutes from './routes/reporting.js';
import debugRoutes from './routes/debugRoutes.js';
import customersRoutes from './routes/customers.js';
import visitsRoutes from './routes/visits.js';
import sheetVisitsRoutes from './routes/sheetVisits.js';
import ocrRoutes from './routes/ocr.js';
import { notFoundHandler, errorHandler } from './middlewares/errorHandlers.js';
import {
  OCR_ROUTE_ABSOLUTE_PATHS,
  OCR_ROUTE_BASE_PATH,
} from './services/ocr/ocrRouteConfig.js';
import {
  RECEIPT_UPLOAD_PUBLIC_BASE_URL,
  RECEIPT_UPLOAD_PUBLIC_PATH,
  RECEIPT_UPLOAD_STORAGE_BACKEND,
  RECEIPT_UPLOAD_STORAGE_ROOT,
} from './services/ocr/receiptOcrService.js';
import {
  LIFF_FRONTEND_BASE_PATH,
  LIFF_FRONTEND_LEGACY_ASSET_BASE_PATH,
  resolveLiffFrontendHostingConfig,
} from './config/liffFrontendHosting.js';

const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || (IS_PRODUCTION ? '' : 'http://localhost:5173');
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Line-Id-Token',
  'X-Line-Access-Token',
  'X-Liff-App-Id',
];
const CORS_ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'];
const CORS_LOG_PREFIX = '[CORS]';
const LOCALHOST_ORIGIN_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
const BRANCH_DEVICE_GUARD_LOG_PREFIX = '[BranchDeviceGuard]';
const LIFF_SPA_EXCLUDED_SUBPATH_PREFIXES = ['/api', '/health', '/internal'];

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeOriginValue(value) {
  const trimmed = normalizeText(value).replace(/\/+$/, '');
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return trimmed;
    }
    return parsed.origin;
  } catch {
    return trimmed;
  }
}

function buildAllowedOrigins() {
  const deduped = new Set();
  const normalizedOrigins = [];

  for (const value of [FRONTEND_ORIGIN, ...FRONTEND_ORIGINS]) {
    const normalized = normalizeOriginValue(value);
    if (!normalized || deduped.has(normalized)) continue;
    deduped.add(normalized);
    normalizedOrigins.push(normalized);
  }

  return normalizedOrigins;
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

function buildCorsDecision(req) {
  const requestOrigin = normalizeText(req.headers?.origin);
  const normalizedRequestOrigin = normalizeOriginValue(requestOrigin);
  const matchedConfiguredOrigin = normalizedRequestOrigin
    ? ALLOWED_ORIGINS.includes(normalizedRequestOrigin)
    : false;
  const matchedLocalhostPattern =
    !IS_PRODUCTION && normalizedRequestOrigin
      ? LOCALHOST_ORIGIN_PATTERN.test(normalizedRequestOrigin)
      : false;
  const matched =
    !requestOrigin || matchedConfiguredOrigin || matchedLocalhostPattern;

  return {
    requestOrigin: requestOrigin || null,
    normalizedRequestOrigin: normalizedRequestOrigin || null,
    normalizedAllowedOrigins: [...ALLOWED_ORIGINS],
    matched,
    matchedConfiguredOrigin,
    matchedLocalhostPattern,
    matchReason: !requestOrigin
      ? 'no_origin_header'
      : matchedConfiguredOrigin
        ? 'configured_origin'
        : matchedLocalhostPattern
          ? 'localhost_dev_pattern'
          : 'not_allowed',
    isOptions: String(req.method || '').trim().toUpperCase() === 'OPTIONS',
    method: normalizeText(req.method).toUpperCase() || null,
    path: normalizeText(req.originalUrl || req.url) || null,
  };
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalizedOrigin = normalizeOriginValue(origin);
  if (ALLOWED_ORIGINS.includes(normalizedOrigin)) return true;
  // Allow any localhost frontend port only in non-production to simplify local testing.
  if (!IS_PRODUCTION && LOCALHOST_ORIGIN_PATTERN.test(normalizedOrigin)) return true;
  return false;
}

function logCorsDecision(decision) {
  const logger = decision?.matched ? console.log : console.warn;
  logger(
    CORS_LOG_PREFIX,
    JSON.stringify({
      event: 'cors_decision',
      requestOrigin: decision?.requestOrigin || null,
      normalizedRequestOrigin: decision?.normalizedRequestOrigin || null,
      normalizedAllowedOrigins: Array.isArray(decision?.normalizedAllowedOrigins)
        ? decision.normalizedAllowedOrigins
        : [],
      matched: Boolean(decision?.matched),
      matchedConfiguredOrigin: Boolean(decision?.matchedConfiguredOrigin),
      matchedLocalhostPattern: Boolean(decision?.matchedLocalhostPattern),
      matchReason: decision?.matchReason || null,
      isOptions: Boolean(decision?.isOptions),
      method: decision?.method || null,
      path: decision?.path || null,
    })
  );
}

function buildCorsOptions(req, callback) {
  const decision = buildCorsDecision(req);
  logCorsDecision(decision);

  callback(null, {
    origin(origin, corsCallback) {
      if (decision.matched) {
        return corsCallback(null, true);
      }
      return corsCallback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: CORS_ALLOWED_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
    optionsSuccessStatus: 204,
  });
}

function shouldServeReceiptUploadsFromLocalStaticPath() {
  return (
    RECEIPT_UPLOAD_STORAGE_BACKEND === 'persistent-disk' &&
    RECEIPT_UPLOAD_PUBLIC_BASE_URL === RECEIPT_UPLOAD_PUBLIC_PATH &&
    Boolean(RECEIPT_UPLOAD_STORAGE_ROOT)
  );
}

function requestLooksLikeStaticAsset(req) {
  const requestPath = String(req.path || req.originalUrl || req.url || '');
  return path.extname(requestPath) !== '';
}

function shouldServeLiffSpaShell(req) {
  const method = String(req.method || '').trim().toUpperCase();
  const requestPath = String(req.path || req.originalUrl || req.url || '');

  if (!(method === 'GET' || method === 'HEAD')) {
    return false;
  }

  if (
    LIFF_SPA_EXCLUDED_SUBPATH_PREFIXES.some(
      (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`)
    )
  ) {
    return false;
  }

  return !requestLooksLikeStaticAsset(req);
}

function createLiffFrontendRouter(liffFrontendHosting) {
  const router = express.Router();
  const staticOptions = {
    fallthrough: true,
    index: false,
    redirect: false,
  };

  router.use(express.static(liffFrontendHosting.distDir, staticOptions));

  const serveLiffSpaShell = (req, res, next) => {
    if (!shouldServeLiffSpaShell(req)) {
      return next();
    }

    return res.sendFile(liffFrontendHosting.indexHtmlPath);
  };

  router.get('/', serveLiffSpaShell);
  router.get('*', serveLiffSpaShell);

  return router;
}

export function createApp() {
  const app = express();
  const liffFrontendHosting = resolveLiffFrontendHostingConfig();

  app.use((req, res, next) => {
    const path = String(req.originalUrl || req.url || '');
    if (!path.startsWith('/api/branch-device-registrations')) {
      return next();
    }

    console.log(
      BRANCH_DEVICE_GUARD_LOG_PREFIX,
      JSON.stringify({
        event: 'incoming_request',
        method: String(req.method || ''),
        path,
        origin: req.headers?.origin || null,
        requestId: req.headers?.['x-request-id'] || req.headers?.['x-render-request-id'] || null,
        originAllowed: isAllowedOrigin(req.headers?.origin),
        preflightMethod: req.headers?.['access-control-request-method'] || null,
        preflightHeaders: req.headers?.['access-control-request-headers'] || null,
      })
    );

    return next();
  });

  // CORS is only needed for API routes. Keeping it off the LIFF static hosting
  // path avoids turning same-origin module/script requests into misleading 500s
  // when a browser includes an `Origin` header that is not in the cross-site
  // allowlist yet.
  app.use(
    '/api',
    cors(buildCorsOptions)
  );

  app.use(express.json());
  app.use(cookieParser());

  if (shouldServeReceiptUploadsFromLocalStaticPath()) {
    app.use(
      RECEIPT_UPLOAD_PUBLIC_PATH,
      requireAuth,
      express.static(RECEIPT_UPLOAD_STORAGE_ROOT, {
        dotfiles: 'deny',
        fallthrough: false,
        index: false,
        redirect: false,
        setHeaders(res) {
          res.setHeader('Cache-Control', 'private, max-age=3600');
        },
      })
    );
  }

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, data: { status: 'ok' } });
  });

  // Keep every API route above the LIFF SPA mount.
  // If `/api/*` falls through into the frontend shell, API/auth failures become
  // misleading HTML responses and debugging gets much harder.
  app.use('/api/auth', authRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/appointment-drafts', appointmentDraftRoutes);
  app.use('/api/admin', adminAppointmentRoutes);
  app.use('/api/branch-device-registrations', branchDeviceRegistrationRoutes);
  app.use('/api/reporting', reportingRoutes);
  app.use(OCR_ROUTE_BASE_PATH, ocrRoutes);
  if (!IS_PRODUCTION) {
    app.use('/api/debug', debugRoutes);
  }
  app.use('/api/customers', customersRoutes);
  app.use('/api/visits', visitsRoutes);
  app.use('/api/sheet-visits', sheetVisitsRoutes);

  if (liffFrontendHosting.enabled) {
    // Mount the LIFF SPA on a dedicated sub-router so only `/liff/*` can ever
    // reach the frontend shell. `/api/*`, `/api/health`, and
    // `/api/internal/receipt-uploads/*` stay above this block and never enter
    // the LIFF router at all. Inside the LIFF router, backend-like subpaths
    // such as `/liff/api/*` are also rejected so they 404 instead of returning
    // misleading SPA HTML.
    app.use(
      LIFF_FRONTEND_BASE_PATH,
      createLiffFrontendRouter(liffFrontendHosting)
    );

    // The current LIFF build still emits `/ScGlamLiFF/assets/*` URLs from its
    // GitHub Pages base config. Keep this read-only alias until the frontend
    // build is repointed at `/liff/`.
    app.use(
      LIFF_FRONTEND_LEGACY_ASSET_BASE_PATH,
      express.static(liffFrontendHosting.distDir, {
        fallthrough: true,
        index: false,
        redirect: false,
      })
    );
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  console.log(
    '[startup]',
    JSON.stringify({
      event: 'ocr_routes_mounted',
      mountedBasePath: OCR_ROUTE_BASE_PATH,
      healthPath: OCR_ROUTE_ABSOLUTE_PATHS.health,
      receiptPath: OCR_ROUTE_ABSOLUTE_PATHS.receipt,
      receiptUploadStorageBackend: RECEIPT_UPLOAD_STORAGE_BACKEND,
      receiptUploadPublicPath: RECEIPT_UPLOAD_PUBLIC_PATH,
      receiptUploadStorageRoot: RECEIPT_UPLOAD_STORAGE_ROOT || null,
      receiptUploadStaticServingEnabled:
        shouldServeReceiptUploadsFromLocalStaticPath(),
    })
  );
  console.log(
    '[startup]',
    JSON.stringify({
      event: 'liff_frontend_hosting',
      enabled: liffFrontendHosting.enabled,
      basePath: liffFrontendHosting.basePath,
      legacyAssetBasePath: liffFrontendHosting.legacyAssetBasePath,
      distDir: liffFrontendHosting.distDir,
      candidatePaths: liffFrontendHosting.candidatePaths,
    })
  );

  return app;
}

export default createApp;
