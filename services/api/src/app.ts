import express, { type ErrorRequestHandler } from 'express';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import { authRoutes } from './auth.js';
import { catalogRoutes } from './catalog.js';
import { overviewRoutes } from './overview.js';
import { publicRoutes } from './public.js';
import { staffRoutes } from './staff.js';
import { storeRoutes } from './stores.js';

export function createApp(db: Pool, options: { sessionSecret: string; secureCookies?: boolean; allowedOrigin?: string }) {
  if (options.sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));
  app.use('/api/admin', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use((req, res, next) => {
    if (options.allowedOrigin && req.headers.origin && req.headers.origin !== options.allowedOrigin) {
      res.status(403).json({ error: 'Origin not allowed' }); return;
    }
    next();
  });
  app.get('/api/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  app.use('/api', publicRoutes(db));
  app.use('/api/admin', authRoutes(db, options.sessionSecret, options.secureCookies ?? false));
  app.use('/api/admin', storeRoutes(db), catalogRoutes(db), staffRoutes(db), overviewRoutes(db));

  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: 'Invalid input', fields: error.flatten().fieldErrors }); return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'Invalid JSON' }); return;
    }
    if (error instanceof Error && 'code' in error && (error.code === '23505' || error.code === '23503')) {
      res.status(409).json({ error: 'Record conflicts with existing data' }); return;
    }
    if (error instanceof Error && 'status' in error && typeof error.status === 'number') {
      res.status(error.status).json({ error: error.message }); return;
    }
    console.error('API request failed');
    res.status(500).json({ error: 'Request failed' });
  };
  app.use(handleError);
  return app;
}
