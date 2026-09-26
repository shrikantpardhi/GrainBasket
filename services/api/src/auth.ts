import type { Request, RequestHandler, Response } from 'express';
import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { constantTimeMatch, csrfToken, hashPassword, newSessionToken, sessionHash, verifyPassword } from './security.js';

export interface AdminIdentity {
  id: string;
  storeId: string;
  loginName: string;
  token: string;
}

const credentials = z.object({
  login: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(1024),
}).strict();

function cookieToken(req: Request): string | undefined {
  const cookie = req.headers.cookie?.split('; ').find((part) => part.startsWith('gb_admin='));
  const token = cookie?.slice('gb_admin='.length);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}

export function adminIdentity(res: Response): AdminIdentity {
  return res.locals.admin as AdminIdentity;
}

export function authRoutes(db: Pool, secret: string, secureCookies: boolean): Router {
  const router = Router();
  const cookie = { httpOnly: true, secure: secureCookies, sameSite: 'lax' as const, path: '/api/admin' };
  const failures = new Map<string, { count: number; until: number }>();

  const requireAdmin: RequestHandler = async (req, res, next) => {
    try {
      const token = cookieToken(req);
      if (!token) { res.status(401).json({ error: 'Sign in required' }); return; }
      const result = await db.query<{ id: string; store_id: string; login_name: string }>(
        `SELECT a.id, a.store_id, a.login_name FROM auth_sessions s
         JOIN staff_accounts a ON a.id = s.staff_id
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
           AND a.active = true AND a.role = 'ADMIN'`, [sessionHash(token)],
      );
      const admin = result.rows[0];
      if (!admin) { res.status(401).json({ error: 'Sign in required' }); return; }
      res.locals.admin = { id: admin.id, storeId: admin.store_id, loginName: admin.login_name, token } satisfies AdminIdentity;
      next();
    } catch (error) { next(error); }
  };

  router.post('/login', async (req, res) => {
    const input = credentials.parse(req.body);
    const key = `${req.ip ?? 'unknown'}:${input.login.toLowerCase()}`;
    const failure = failures.get(key);
    if (failure && failure.count >= 5 && failure.until > Date.now()) {
      res.status(429).json({ error: 'Try again later' }); return;
    }
    const match = await db.query<{ id: string; password_hash: string; store_id: string; login_name: string }>(
      `SELECT id, store_id, login_name, password_hash FROM staff_accounts
       WHERE login_name = $1 AND role = 'ADMIN' AND active = true`, [input.login.toLowerCase()],
    );
    const account = match.rows[0];
    if (!account) await hashPassword(input.password);
    const valid = account ? await verifyPassword(input.password, account.password_hash) : false;
    if (!valid || !account) {
      const oldest = failures.keys().next().value;
      if (failures.size >= 1000 && oldest) failures.delete(oldest);
      failures.set(key, { count: (failure?.until && failure.until > Date.now() ? failure.count : 0) + 1,
        until: Date.now() + 15 * 60_000 });
      res.status(401).json({ error: 'Invalid credentials' }); return;
    }
    failures.delete(key);
    const token = newSessionToken();
    await db.query(
      `INSERT INTO auth_sessions (staff_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '12 hours')`, [account.id, sessionHash(token)],
    );
    res.cookie('gb_admin', token, { ...cookie, maxAge: 12 * 60 * 60_000 });
    res.json({ admin: { id: account.id, storeId: account.store_id, loginName: account.login_name },
      csrfToken: csrfToken(token, secret) });
  });

  router.use(requireAdmin);
  router.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
    const admin = res.locals.admin as AdminIdentity;
    const provided = req.header('x-csrf-token') ?? '';
    if (!constantTimeMatch(provided, csrfToken(admin.token, secret))) {
      res.status(403).json({ error: 'Invalid request token' }); return;
    }
    next();
  });

  router.get('/session', (_req, res) => {
    const admin = res.locals.admin as AdminIdentity;
    res.json({ admin: { id: admin.id, storeId: admin.storeId, loginName: admin.loginName },
      csrfToken: csrfToken(admin.token, secret) });
  });

  router.post('/logout', async (_req, res) => {
    const admin = res.locals.admin as AdminIdentity;
    await db.query('UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1', [sessionHash(admin.token)]);
    res.clearCookie('gb_admin', cookie);
    res.status(204).end();
  });

  return router;
}
