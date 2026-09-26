import { Router } from 'express';
import type { Pool } from 'pg';
import { HttpError, id } from './validation.js';

export function overviewRoutes(db: Pool): Router {
  const router = Router();
  router.get('/overview', async (req, res) => {
    const storeId = id.parse(req.query.storeId);
    const store = await db.query('SELECT id FROM stores WHERE id = $1', [storeId]);
    if (!store.rowCount) throw new HttpError(404, 'Store not found');
    const [orders, payments, stock, staff, corrections] = await Promise.all([
      db.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status IN ('COLLECTED', 'DELIVERED'))::int AS completed,
        count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
        count(*) FILTER (WHERE status = 'PLACED')::int AS placed
        FROM orders WHERE store_id = $1`, [storeId]),
      db.query(`SELECT count(*)::int AS attempts,
        count(*) FILTER (WHERE method = 'CASH' AND status = 'PAID')::int AS cash,
        count(*) FILTER (WHERE method IN ('UPI', 'CARD') AND status = 'FAILED')::int AS online_failed,
        count(*) FILTER (WHERE refund_status = 'REFUNDED')::int AS refunded
        FROM payments WHERE store_id = $1`, [storeId]),
      db.query(`SELECT count(*)::int AS offers,
        COALESCE(sum(stock_on_hand - stock_reserved), 0)::int AS available
        FROM store_variant_offers WHERE store_id = $1 AND active = true`, [storeId]),
      db.query(`SELECT count(*)::int AS active FROM staff_accounts
        WHERE store_id = $1 AND active = true`, [storeId]),
      db.query(`SELECT count(*)::int AS stock FROM stock_adjustments WHERE store_id = $1`, [storeId]),
    ]);
    res.json({ orders: orders.rows[0], payments: payments.rows[0], stock: stock.rows[0],
      staff: staff.rows[0], corrections: corrections.rows[0] });
  });
  return router;
}
