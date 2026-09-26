import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { adminIdentity } from './auth.js';
import { inTransaction } from './db.js';
import { hashPassword } from './security.js';
import { HttpError, id } from './validation.js';

const account = z.object({
  loginName: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/),
  password: z.string().min(12).max(128),
  role: z.enum(['ADMIN', 'STAFF']), storeId: id,
}).strict();
const update = z.object({
  role: z.enum(['ADMIN', 'STAFF']), storeId: id, active: z.boolean(),
  password: z.string().min(12).max(128).optional(),
}).strict();

export function staffRoutes(db: Pool): Router {
  const router = Router();

  router.get('/staff', async (_req, res) => {
    const staff = await db.query(
      `SELECT id, store_id AS "storeId", login_name AS "loginName", role, active, created_at AS "createdAt"
       FROM staff_accounts ORDER BY id`,
    );
    res.json(staff.rows);
  });

  router.post('/staff', async (req, res) => {
    const input = account.parse(req.body);
    const store = await db.query('SELECT id FROM stores WHERE id = $1', [input.storeId]);
    if (!store.rowCount) throw new HttpError(404, 'Store not found');
    const passwordHash = await hashPassword(input.password);
    const result = await db.query(
      `INSERT INTO staff_accounts (store_id, login_name, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id, store_id AS "storeId", login_name AS "loginName", role, active`,
      [input.storeId, input.loginName, passwordHash, input.role],
    );
    res.status(201).json(result.rows[0]);
  });

  router.put('/staff/:staffId', async (req, res) => {
    const staffId = id.parse(req.params.staffId);
    const input = update.parse(req.body);
    const actor = adminIdentity(res);
    if (staffId === actor.id && (!input.active || input.role !== 'ADMIN')) {
      throw new HttpError(409, 'Cannot remove your own admin access');
    }
    const passwordHash = input.password ? await hashPassword(input.password) : null;
    const client = await db.connect();
    try {
      await inTransaction(client, async () => {
        const staff = await client.query<{ role: string; active: boolean; store_id: string }>(
          'SELECT role, active, store_id FROM staff_accounts WHERE id = $1 FOR UPDATE', [staffId],
        );
        if (!staff.rows[0]) throw new HttpError(404, 'Staff account not found');
        const store = await client.query('SELECT id FROM stores WHERE id = $1', [input.storeId]);
        if (!store.rowCount) throw new HttpError(404, 'Store not found');
        if (staff.rows[0].role === 'ADMIN' && staff.rows[0].active && (!input.active || input.role !== 'ADMIN')) {
          const count = await client.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM staff_accounts WHERE role = 'ADMIN' AND active = true", []);
          if (Number(count.rows[0]!.count) <= 1) throw new HttpError(409, 'Keep at least one active administrator');
        }
        await client.query(
          `UPDATE staff_accounts SET store_id = $2, role = $3, active = $4,
           password_hash = COALESCE($5, password_hash) WHERE id = $1`,
          [staffId, input.storeId, input.role, input.active, passwordHash],
        );
        if (!input.active || passwordHash || staff.rows[0].role !== input.role || staff.rows[0].store_id !== input.storeId) {
          await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE staff_id = $1 AND revoked_at IS NULL',
            [staffId]);
        }
      });
      res.status(204).end();
    } finally { client.release(); }
  });

  return router;
}
