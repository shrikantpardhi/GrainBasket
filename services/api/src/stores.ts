import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { inTransaction } from './db.js';
import { HttpError, id, money, text } from './validation.js';

const time = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);
const hour = z.object({
  weekday: z.number().int().min(0).max(6), closed: z.boolean(),
  opensAt: time.nullable(), closesAt: time.nullable(), orderCutoffAt: time.nullable(),
}).strict().superRefine((value, context) => {
  if (value.closed && (value.opensAt || value.closesAt || value.orderCutoffAt)) {
    context.addIssue({ code: 'custom', message: 'Closed days have no hours' });
  }
  if (!value.closed && (!value.opensAt || !value.closesAt || !value.orderCutoffAt
    || value.opensAt >= value.closesAt || value.orderCutoffAt < value.opensAt
    || value.orderCutoffAt > value.closesAt)) {
    context.addIssue({ code: 'custom', message: 'Opening, closing and cutoff times must be ordered' });
  }
});
const storeBase = z.object({
  name: text, address: z.string().trim().min(1).max(500), contactPhone: z.string().regex(/^[+0-9 -]{7,20}$/),
}).strict();
const setup = storeBase.extend({
  preparationLeadMinutes: z.number().int().min(1).max(1440),
  deliveryFee: money,
  orderingEnabled: z.boolean(),
  hours: z.array(hour).length(7),
  pickupTimes: z.array(z.object({ weekday: z.number().int().min(0).max(6), pickupAt: time }).strict()).max(100),
  deliveryPincodes: z.array(z.string().regex(/^[0-9]{6}$/)).max(200),
}).superRefine((value, context) => {
  if (new Set(value.hours.map((day) => day.weekday)).size !== 7) {
    context.addIssue({ code: 'custom', message: 'Provide each weekday once' });
  }
  if (new Set(value.deliveryPincodes).size !== value.deliveryPincodes.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate pincodes' });
  }
  if (new Set(value.pickupTimes.map((slot) => `${slot.weekday}:${slot.pickupAt}`)).size !== value.pickupTimes.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate pickup times' });
  }
  for (const slot of value.pickupTimes) {
    const day = value.hours.find((entry) => entry.weekday === slot.weekday);
    if (!day || day.closed || !day.opensAt || !day.closesAt || slot.pickupAt < day.opensAt || slot.pickupAt > day.closesAt) {
      context.addIssue({ code: 'custom', message: 'Pickup must be during open hours' });
    }
  }
  if (value.orderingEnabled && (!value.hours.some((day) => !day.closed)
    || value.pickupTimes.length === 0 || value.deliveryPincodes.length === 0)) {
    context.addIssue({ code: 'custom', message: 'Enable ordering only after hours, pickup and delivery coverage are configured' });
  }
});

const rewardInput = z.object({
  pointsPerInr: z.string().regex(/^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,4})?$/).refine((value) => Number(value) > 0),
  minimumRedemptionPoints: z.number().int().positive().max(1_000_000),
  pointValueInr: money.refine((value) => Number(value) > 0),
  maximumRedemptionPoints: z.number().int().positive().max(1_000_000),
}).strict();

export function storeRoutes(db: Pool): Router {
  const router = Router();

  router.get('/stores', async (_req, res) => {
    const [stores, hours, slots, pincodes, rewards] = await Promise.all([
      db.query(`SELECT id, name, address, contact_phone AS "contactPhone",
         timezone, preparation_lead_minutes AS "preparationLeadMinutes", delivery_fee AS "deliveryFee",
         ordering_enabled AS "orderingEnabled" FROM stores ORDER BY id`),
      db.query(`SELECT store_id, weekday, closed, to_char(opens_at, 'HH24:MI') AS "opensAt",
         to_char(closes_at, 'HH24:MI') AS "closesAt", to_char(order_cutoff_at, 'HH24:MI') AS "orderCutoffAt"
         FROM store_hours ORDER BY weekday`),
      db.query(`SELECT store_id, weekday, to_char(pickup_at, 'HH24:MI') AS "pickupAt"
         FROM store_pickup_times WHERE enabled = true ORDER BY weekday, pickup_at`),
      db.query('SELECT store_id, btrim(pincode) AS pincode FROM store_delivery_pincodes ORDER BY pincode'),
      db.query(`SELECT store_id, points_per_inr AS "pointsPerInr",
         minimum_redemption_points AS "minimumRedemptionPoints", point_value_inr AS "pointValueInr",
         maximum_redemption_points AS "maximumRedemptionPoints" FROM reward_settings`),
    ]);
    res.json(stores.rows.map((store) => ({ ...store,
      hours: hours.rows.filter((row) => row.store_id === store.id).map((row) => ({
        weekday: row.weekday, closed: row.closed, opensAt: row.opensAt,
        closesAt: row.closesAt, orderCutoffAt: row.orderCutoffAt,
      })),
      pickupTimes: slots.rows.filter((row) => row.store_id === store.id).map((row) => ({
        weekday: row.weekday, pickupAt: row.pickupAt,
      })),
      deliveryPincodes: pincodes.rows.filter((row) => row.store_id === store.id).map((row) => row.pincode),
      rewards: rewards.rows.find((row) => row.store_id === store.id) ?? null,
    })));
  });

  router.post('/stores', async (req, res) => {
    const input = storeBase.parse(req.body);
    const result = await db.query(
      `INSERT INTO stores (name, address, contact_phone) VALUES ($1, $2, $3)
       RETURNING id, name, address, contact_phone AS "contactPhone", ordering_enabled AS "orderingEnabled"`,
      [input.name, input.address, input.contactPhone],
    );
    res.status(201).json(result.rows[0]);
  });

  router.put('/stores/:storeId', async (req, res) => {
    const storeId = id.parse(req.params.storeId);
    const input = setup.parse(req.body);
    const client = await db.connect();
    try {
      await inTransaction(client, async () => {
        const store = await client.query('SELECT id FROM stores WHERE id = $1 FOR UPDATE', [storeId]);
        if (!store.rowCount) throw new HttpError(404, 'Store not found');
        if (input.orderingEnabled) {
          const ready = await client.query(
            `SELECT (EXISTS(SELECT 1 FROM reward_settings WHERE store_id = $1) AND EXISTS(
               SELECT 1 FROM store_variant_offers WHERE store_id = $1 AND active = true)) AS ready`, [storeId],
          );
          if (!ready.rows[0].ready) throw new HttpError(409, 'Configure rewards and an active offer before enabling orders');
        }
        await client.query(
          `UPDATE stores SET name = $2, address = $3, contact_phone = $4,
           preparation_lead_minutes = $5, delivery_fee = $6, ordering_enabled = $7 WHERE id = $1`,
          [storeId, input.name, input.address, input.contactPhone, input.preparationLeadMinutes,
            input.deliveryFee, input.orderingEnabled],
        );
        await client.query('DELETE FROM store_pickup_times WHERE store_id = $1', [storeId]);
        await client.query('DELETE FROM store_hours WHERE store_id = $1', [storeId]);
        for (const day of input.hours) {
          await client.query(
            `INSERT INTO store_hours (store_id, weekday, closed, opens_at, closes_at, order_cutoff_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [storeId, day.weekday, day.closed, day.opensAt, day.closesAt, day.orderCutoffAt],
          );
        }
        for (const slot of input.pickupTimes) {
          await client.query('INSERT INTO store_pickup_times (store_id, weekday, pickup_at) VALUES ($1, $2, $3)',
            [storeId, slot.weekday, slot.pickupAt]);
        }
        await client.query('DELETE FROM store_delivery_pincodes WHERE store_id = $1', [storeId]);
        for (const pincode of input.deliveryPincodes) {
          await client.query('INSERT INTO store_delivery_pincodes (store_id, pincode) VALUES ($1, $2)', [storeId, pincode]);
        }
      });
      res.status(204).end();
    } finally { client.release(); }
  });

  router.put('/stores/:storeId/rewards', async (req, res) => {
    const storeId = id.parse(req.params.storeId);
    const value = rewardInput.parse(req.body);
    const store = await db.query('SELECT id FROM stores WHERE id = $1', [storeId]);
    if (!store.rowCount) throw new HttpError(404, 'Store not found');
    await db.query(
      `INSERT INTO reward_settings (store_id, points_per_inr, minimum_redemption_points,
         point_value_inr, maximum_redemption_points) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (store_id) DO UPDATE SET points_per_inr = EXCLUDED.points_per_inr,
         minimum_redemption_points = EXCLUDED.minimum_redemption_points,
         point_value_inr = EXCLUDED.point_value_inr,
         maximum_redemption_points = EXCLUDED.maximum_redemption_points, updated_at = now()`,
      [storeId, value.pointsPerInr, value.minimumRedemptionPoints, value.pointValueInr, value.maximumRedemptionPoints],
    );
    res.status(204).end();
  });

  return router;
}
