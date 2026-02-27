import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth.js';
import appointmentRoutes from './routes/appointments.js';
import adminAppointmentRoutes from './routes/adminAppointments.js';
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

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Allow any localhost frontend port only in non-production to simplify local testing.
  if (!IS_PRODUCTION && LOCALHOST_ORIGIN_PATTERN.test(origin)) return true;
  return false;
}

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, data: { status: 'ok' } });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/admin', adminAppointmentRoutes);
  app.use('/api/customers', customersRoutes);
  app.use('/api/visits', visitsRoutes);
  app.use('/api/sheet-visits', sheetVisitsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
