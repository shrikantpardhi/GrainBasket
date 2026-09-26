import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { adminIdentity } from './auth.js';
import { inTransaction } from './db.js';
import { evidenceUrl, HttpError, id, money, text, translations } from './validation.js';

const descriptions = z.object({ en: z.string().max(1000), hi: z.string().max(1000), mr: z.string().max(1000) }).strict();
const categoryInput = z.object({
  kind: z.enum(['FLOUR', 'RICE']), names: translations, descriptions, active: z.boolean(),
}).strict();
const productInput = z.object({
  categoryId: id, names: translations, descriptions,
  imageRef: evidenceUrl.nullable(), active: z.boolean(),
  claims: z.array(z.object({ kind: z.enum(['ORGANIC', 'NUTRITION']), textEn: text, evidenceRef: evidenceUrl }).strict()).max(2),
}).strict().refine((input) => new Set(input.claims.map((claim) => claim.kind)).size === input.claims.length,
  'Duplicate claim kind');
const variantInput = z.object({
  productId: id, weightGrams: z.number().int().min(1).max(100_000),
  riceAge: z.string().trim().min(1).max(100).nullable(), evidenceRef: evidenceUrl.nullable(),
}).strict();
const offerInput = z.object({
  priceInr: money, stockOnHand: z.number().int().min(0).max(1_000_000),
  active: z.boolean(), reason: z.string().trim().max(500),
}).strict();

async function saveTranslations(client: PoolClient, column: 'category_id' | 'product_id', entityId: string,
  names: z.infer<typeof translations>, details: z.infer<typeof descriptions>) {
  for (const language of ['en', 'hi', 'mr'] as const) {
    await client.query(
      `INSERT INTO catalog_translations (${column}, language_code, name, description)
       VALUES ($1, $2, $3, $4) ON CONFLICT (${column}, language_code) WHERE ${column} IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
      [entityId, language, names[language], details[language]],
    );
  }
}

export function catalogRoutes(db: Pool): Router {
  const router = Router();

  router.get('/catalog', async (_req, res) => {
    const [categories, products, variants, offers, translationsResult, claims, ageEvidence] = await Promise.all([
      db.query('SELECT id, kind, name_en AS "nameEn", description_en AS "descriptionEn", active FROM categories ORDER BY id'),
      db.query(`SELECT id, category_id AS "categoryId", name_en AS "nameEn",
        description_en AS "descriptionEn", image_ref AS "imageRef", active FROM products ORDER BY id`),
      db.query(`SELECT id, product_id AS "productId", weight_grams AS "weightGrams", rice_age AS "riceAge"
        FROM product_variants ORDER BY id`),
      db.query(`SELECT store_id AS "storeId", variant_id AS "variantId", price_inr AS "priceInr",
        stock_on_hand AS "stockOnHand", stock_reserved AS "stockReserved", active
        FROM store_variant_offers ORDER BY store_id, variant_id`),
      db.query('SELECT category_id AS "categoryId", product_id AS "productId", language_code AS language, name, description FROM catalog_translations'),
      db.query(`SELECT product_id AS "productId", kind, text_en AS "textEn", evidence_ref AS "evidenceRef"
        FROM product_claims ORDER BY product_id, kind`),
      db.query('SELECT variant_id AS "variantId", evidence_ref AS "evidenceRef" FROM variant_claim_evidence'),
    ]);
    res.json({ categories: categories.rows, products: products.rows, variants: variants.rows, offers: offers.rows,
      translations: translationsResult.rows, claims: claims.rows, ageEvidence: ageEvidence.rows });
  });

  router.post('/categories', async (req, res) => {
    const input = categoryInput.parse(req.body);
    const client = await db.connect();
    try {
      const result = await inTransaction(client, async () => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO categories (kind, name_en, description_en, active) VALUES ($1, $2, $3, $4) RETURNING id`,
          [input.kind, input.names.en, input.descriptions.en, input.active],
        );
        await saveTranslations(client, 'category_id', inserted.rows[0]!.id, input.names, input.descriptions);
        return inserted.rows[0];
      });
      res.status(201).json(result);
    } finally { client.release(); }
  });

  router.put('/categories/:categoryId', async (req, res) => {
    const categoryId = id.parse(req.params.categoryId);
    const input = categoryInput.parse(req.body);
    const client = await db.connect();
    try {
      await inTransaction(client, async () => {
        const updated = await client.query(`UPDATE categories SET name_en = $2, description_en = $3, active = $5
          WHERE id = $1 AND kind = $4 RETURNING id`,
        [categoryId, input.names.en, input.descriptions.en, input.kind, input.active]);
        if (!updated.rowCount) throw new HttpError(404, 'Category not found');
        await saveTranslations(client, 'category_id', categoryId, input.names, input.descriptions);
      });
      res.status(204).end();
    } finally { client.release(); }
  });

  router.post('/products', async (req, res) => {
    const input = productInput.parse(req.body);
    const client = await db.connect();
    try {
      const result = await inTransaction(client, async () => {
        const category = await client.query('SELECT id FROM categories WHERE id = $1 AND active = true', [input.categoryId]);
        if (!category.rowCount) throw new HttpError(404, 'Active category not found');
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO products (category_id, name_en, description_en, image_ref, active)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [input.categoryId, input.names.en, input.descriptions.en, input.imageRef, input.active],
        );
        const productId = inserted.rows[0]!.id;
        await saveTranslations(client, 'product_id', productId, input.names, input.descriptions);
        for (const claim of input.claims) {
          await client.query(
            `INSERT INTO product_claims (product_id, kind, text_en, evidence_ref, verified_by_staff_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [productId, claim.kind, claim.textEn, claim.evidenceRef, adminIdentity(res).id],
          );
        }
        return inserted.rows[0];
      });
      res.status(201).json(result);
    } finally { client.release(); }
  });

  router.put('/products/:productId', async (req, res) => {
    const productId = id.parse(req.params.productId);
    const input = productInput.parse(req.body);
    const client = await db.connect();
    try {
      await inTransaction(client, async () => {
        const updated = await client.query(
          `UPDATE products SET category_id = $2, name_en = $3, description_en = $4,
           image_ref = $5, active = $6 WHERE id = $1 RETURNING id`,
          [productId, input.categoryId, input.names.en, input.descriptions.en, input.imageRef, input.active],
        );
        if (!updated.rowCount) throw new HttpError(404, 'Product not found');
        await saveTranslations(client, 'product_id', productId, input.names, input.descriptions);
        await client.query('DELETE FROM product_claims WHERE product_id = $1', [productId]);
        for (const claim of input.claims) {
          await client.query(`INSERT INTO product_claims (product_id, kind, text_en, evidence_ref, verified_by_staff_id)
            VALUES ($1, $2, $3, $4, $5)`,
          [productId, claim.kind, claim.textEn, claim.evidenceRef, adminIdentity(res).id]);
        }
      });
      res.status(204).end();
    } finally { client.release(); }
  });

  router.post('/variants', async (req, res) => {
    const input = variantInput.parse(req.body);
    const client = await db.connect();
    try {
      const result = await inTransaction(client, async () => {
        const product = await client.query<{ kind: string }>(
          `SELECT c.kind FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = $1`, [input.productId],
        );
        if (!product.rows[0]) throw new HttpError(404, 'Product not found');
        if (product.rows[0].kind === 'RICE' ? !input.riceAge || !input.evidenceRef : input.riceAge || input.evidenceRef) {
          throw new HttpError(400, 'Rice needs a verified age and evidence; flour must not have a rice age');
        }
        const inserted = await client.query<{ id: string }>(
          'INSERT INTO product_variants (product_id, weight_grams, rice_age) VALUES ($1, $2, $3) RETURNING id',
          [input.productId, input.weightGrams, input.riceAge],
        );
        if (input.evidenceRef) await client.query(
          `INSERT INTO variant_claim_evidence (variant_id, evidence_ref, verified_by_staff_id)
           VALUES ($1, $2, $3)`, [inserted.rows[0]!.id, input.evidenceRef, adminIdentity(res).id],
        );
        return inserted.rows[0];
      });
      res.status(201).json(result);
    } finally { client.release(); }
  });

  router.put('/stores/:storeId/offers/:variantId', async (req, res) => {
    const storeId = id.parse(req.params.storeId);
    const variantId = id.parse(req.params.variantId);
    const input = offerInput.parse(req.body);
    const client = await db.connect();
    try {
      await inTransaction(client, async () => {
        const store = await client.query('SELECT id FROM stores WHERE id = $1 FOR UPDATE', [storeId]);
        if (!store.rowCount) throw new HttpError(404, 'Store not found');
        const variant = await client.query<{ available: boolean }>(
          `SELECT p.active AND c.active AS available FROM product_variants v
           JOIN products p ON p.id = v.product_id JOIN categories c ON c.id = p.category_id WHERE v.id = $1`, [variantId],
        );
        if (!variant.rows[0] || (input.active && !variant.rows[0].available)) {
          throw new HttpError(409, 'Active product and category required');
        }
        const existing = await client.query<{ stock_on_hand: number; stock_reserved: number }>(
          `SELECT stock_on_hand, stock_reserved FROM store_variant_offers
           WHERE store_id = $1 AND variant_id = $2 FOR UPDATE`, [storeId, variantId],
        );
        const before = existing.rows[0];
        if (before && input.stockOnHand < before.stock_reserved) throw new HttpError(409, 'Stock is reserved');
        const difference = input.stockOnHand - (before?.stock_on_hand ?? 0);
        if (difference && !input.reason) throw new HttpError(400, 'Reason is required when stock changes');
        await client.query(
          `INSERT INTO store_variant_offers (store_id, variant_id, price_inr, stock_on_hand, active)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (store_id, variant_id) DO UPDATE
           SET price_inr = EXCLUDED.price_inr, stock_on_hand = EXCLUDED.stock_on_hand, active = EXCLUDED.active`,
          [storeId, variantId, input.priceInr, input.stockOnHand, input.active],
        );
        if (difference) await client.query(
          `INSERT INTO stock_adjustments (store_id, variant_id, staff_id, quantity_change, reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [storeId, variantId, adminIdentity(res).id, difference, input.reason],
        );
      });
      res.status(204).end();
    } finally { client.release(); }
  });

  return router;
}
