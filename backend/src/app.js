import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

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
import { notFoundHandler, errorHandler } from './middlewares/errorHandlers.js';

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = [
  FRONTEND_ORIGIN,
  ...FRONTEND_ORIGINS,
];
const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const LOCALHOST_ORIGIN_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
const BRANCH_DEVICE_GUARD_LOG_PREFIX = '[BranchDeviceGuard]';

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Allow any localhost frontend port only in non-production to simplify local testing.
  if (!IS_PRODUCTION && LOCALHOST_ORIGIN_PATTERN.test(origin)) return true;
  return false;
}

export function createApp() {
  const app = express();

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

  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) return callback(null, true);
        console.warn(
          BRANCH_DEVICE_GUARD_LOG_PREFIX,
          JSON.stringify({
            event: 'cors_rejected',
            origin: origin || null,
          })
        );
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Line-Id-Token',
        'X-Line-Access-Token',
        'X-Liff-App-Id',
      ],
    })
  );

  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, data: { status: 'ok' } });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/appointment-drafts', appointmentDraftRoutes);
  app.use('/api/admin', adminAppointmentRoutes);
  app.use('/api/branch-device-registrations', branchDeviceRegistrationRoutes);
  app.use('/api/reporting', reportingRoutes);
  if (!IS_PRODUCTION) {
    app.use('/api/debug', debugRoutes);
  }
  app.use('/api/customers', customersRoutes);
  app.use('/api/visits', visitsRoutes);
  app.use('/api/sheet-visits', sheetVisitsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
