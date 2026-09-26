import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { HttpError, id, language } from './validation.js';

export function publicRoutes(db: Pool): Router {
  const router = Router();

  router.get('/stores', async (_req, res) => {
    const stores = await db.query(`SELECT id, name, address, contact_phone AS "contactPhone",
      ordering_enabled AS "orderingEnabled" FROM stores ORDER BY id`);
    res.json(stores.rows);
  });

  router.get('/catalog', async (req, res) => {
    const storeId = id.parse(req.query.storeId);
    const locale = language.parse(req.query.lang ?? 'en');
    const store = await db.query(`SELECT id, name, ordering_enabled AS "orderingEnabled"
      FROM stores WHERE id = $1`, [storeId]);
    if (!store.rows[0]) throw new HttpError(404, 'Store not found');
    const offers = await db.query(
      `SELECT o.variant_id AS "variantId", p.id AS "productId", c.kind,
         COALESCE(pt.name, p.name_en) AS name,
         COALESCE(pt.description, p.description_en) AS description,
         COALESCE(ct.name, c.name_en) AS category,
         p.image_ref AS "imageRef", v.weight_grams AS "weightGrams", v.rice_age AS "riceAge",
         o.price_inr AS "priceInr", o.stock_on_hand - o.stock_reserved AS "availableStock"
       FROM store_variant_offers o
       JOIN product_variants v ON v.id = o.variant_id
       JOIN products p ON p.id = v.product_id AND p.active = true
       JOIN categories c ON c.id = p.category_id AND c.active = true
       LEFT JOIN catalog_translations pt ON pt.product_id = p.id AND pt.language_code = $2
       LEFT JOIN catalog_translations ct ON ct.category_id = c.id AND ct.language_code = $2
       WHERE o.store_id = $1 AND o.active = true AND o.stock_on_hand > o.stock_reserved
       ORDER BY c.kind, p.id, v.weight_grams`, [storeId, locale],
    );
    res.json({ store: store.rows[0], offers: offers.rows });
  });

  router.get('/stores/:storeId/availability', async (req, res) => {
    const storeId = id.parse(req.params.storeId);
    const input = z.object({
      at: z.string().datetime({ offset: true }),
      pincode: z.string().regex(/^[0-9]{6}$/).optional(),
    }).parse(req.query);
    const store = await db.query<{ timezone: string; ordering_enabled: boolean;
      preparation_lead_minutes: number | null; delivery_fee: string | null }>(
      'SELECT timezone, ordering_enabled, preparation_lead_minutes, delivery_fee FROM stores WHERE id = $1', [storeId],
    );
    const selected = store.rows[0];
    if (!selected) throw new HttpError(404, 'Store not found');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: selected.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(input.at));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((part) => part.type === 'weekday')!.value);
    const currentTime = `${parts.find((part) => part.type === 'hour')!.value}:${parts.find((part) => part.type === 'minute')!.value}`;
    const [hour, slots, coverage, configured] = await Promise.all([
      db.query<{ closed: boolean; opens_at: string | null; order_cutoff_at: string | null }>(
        'SELECT closed, opens_at::text, order_cutoff_at::text FROM store_hours WHERE store_id = $1 AND weekday = $2',
        [storeId, weekday],
      ),
      db.query('SELECT 1 FROM store_pickup_times WHERE store_id = $1 AND weekday = $2 AND enabled = true LIMIT 1',
        [storeId, weekday]),
      input.pincode ? db.query('SELECT 1 FROM store_delivery_pincodes WHERE store_id = $1 AND pincode = $2',
        [storeId, input.pincode]) : Promise.resolve(null),
      db.query(`SELECT EXISTS(SELECT 1 FROM reward_settings WHERE store_id = $1)
        AND EXISTS(SELECT 1 FROM store_variant_offers o JOIN product_variants v ON v.id = o.variant_id
          JOIN products p ON p.id = v.product_id AND p.active = true
          JOIN categories c ON c.id = p.category_id AND c.active = true
          WHERE o.store_id = $1 AND o.active = true AND o.stock_on_hand > o.stock_reserved) AS ready`, [storeId]),
    ]);
    const day = hour.rows[0];
    const available = Boolean(selected.ordering_enabled && configured.rows[0]?.ready
      && selected.preparation_lead_minutes && selected.delivery_fee !== null
      && day && !day.closed && day.opens_at && day.order_cutoff_at
      && currentTime >= day.opens_at.slice(0, 5) && currentTime <= day.order_cutoff_at.slice(0, 5)
      && (input.pincode ? coverage?.rowCount : slots.rowCount));
    res.json({ available, weekday, localTime: currentTime,
      reason: available ? null : 'Store is closed, unavailable or outside its delivery area' });
  });

  return router;
}
