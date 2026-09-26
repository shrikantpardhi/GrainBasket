import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import pg from 'pg';
import { bootstrapAdmin } from './bootstrap.js';
import { createApp } from './app.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Use a disposable _test database');
const db = new pg.Pool({ connectionString: url });
let server: Server;
let base: string;

before(async () => {
  await migrate();
  await db.query('TRUNCATE stores, categories RESTART IDENTITY CASCADE');
  process.env.ADMIN_LOGIN = 'owner';
  process.env.ADMIN_PASSWORD = 'StrongBootstrapPassword123!';
  process.env.ADMIN_STORE_NAME = 'North Nagpur';
  process.env.ADMIN_STORE_ADDRESS = 'North Road, Nagpur';
  process.env.ADMIN_STORE_PHONE = '9876543210';
  await bootstrapAdmin();
  server = createApp(db, { sessionSecret: 'only-for-tests-a-long-random-like-secret',
    allowedOrigin: 'http://localhost:5173' }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP server did not bind');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
  await pool.end();
});

async function request(path: string, method = 'GET', body?: object, cookie?: string, csrf?: string) {
  return fetch(`${base}${path}`, { method, headers: {
    ...(body ? { 'content-type': 'application/json' } : {}),
    ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}),
    origin: 'http://localhost:5173',
  }, body: body ? JSON.stringify(body) : undefined });
}

const names = (en: string, hi: string, mr: string) => ({ en, hi, mr });
const descriptions = { en: '', hi: '', mr: '' };
const hours = (open: string, close: string, cutoff: string, closedDay: number) =>
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, closed: weekday === closedDay,
    opensAt: weekday === closedDay ? null : open, closesAt: weekday === closedDay ? null : close,
    orderCutoffAt: weekday === closedDay ? null : cutoff }));

test('admin configures independent stores and catalogs with protected access', async () => {
  const health = await request('/api/health');
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal((await request('/api/admin/stores')).status, 401);
  const login = await request('/api/admin/login', 'POST', { login: 'owner', password: 'StrongBootstrapPassword123!' });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie') ?? '', /HttpOnly.*SameSite=Lax/);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const { csrfToken } = await login.json() as { csrfToken: string };
  assert.equal((await request('/api/admin/stores', 'POST', { name: 'No token' }, cookie)).status, 403);
  assert.equal((await fetch(`${base}/api/admin/stores`, { headers: { cookie, origin: 'https://wrong.example' } })).status, 403);

  const initial = await request('/api/admin/stores', 'GET', undefined, cookie);
  assert.equal((await initial.json() as { id: string }[])[0]?.id, '1');
  const second = await request('/api/admin/stores', 'POST', {
    name: 'South Nagpur', address: 'South Road, Nagpur', contactPhone: '9876543211',
  }, cookie, csrfToken);
  assert.equal(second.status, 201);
  const secondStoreId = (await second.json() as { id: string }).id;

  const northSetup = { name: 'North Nagpur', address: 'North Road, Nagpur', contactPhone: '9876543210',
    preparationLeadMinutes: 30, deliveryFee: '20.00', orderingEnabled: true,
    hours: hours('09:00', '18:00', '17:00', 0),
    pickupTimes: [{ weekday: 1, pickupAt: '10:00' }], deliveryPincodes: ['440001'] };
  assert.equal((await request('/api/admin/stores/1', 'PUT', northSetup, cookie, csrfToken)).status, 409);
  assert.equal((await request('/api/admin/stores', 'GET', undefined, cookie).then((res) => res.json()) as
    { orderingEnabled: boolean }[])[0]!.orderingEnabled, false);

  for (const storeId of ['1', secondStoreId]) {
    assert.equal((await request(`/api/admin/stores/${storeId}/rewards`, 'PUT', {
      pointsPerInr: '0.1000', minimumRedemptionPoints: 100,
      pointValueInr: '0.50', maximumRedemptionPoints: 500,
    }, cookie, csrfToken)).status, 204);
  }
  const flour = await request('/api/admin/categories', 'POST', {
    kind: 'FLOUR', names: names('Flour', 'आटा', 'पीठ'), descriptions, active: true,
  }, cookie, csrfToken);
  assert.equal(flour.status, 201);
  const flourId = (await flour.json() as { id: string }).id;
  const rice = await request('/api/admin/categories', 'POST', {
    kind: 'RICE', names: names('Rice', 'चावल', 'तांदूळ'), descriptions, active: true,
  }, cookie, csrfToken);
  assert.equal(rice.status, 201);
  const riceId = (await rice.json() as { id: string }).id;
  const atta = await request('/api/admin/products', 'POST', {
    categoryId: flourId, names: names('Wheat flour', 'गेहूं का आटा', 'गव्हाचे पीठ'), descriptions,
    imageRef: null, active: true, claims: [],
  }, cookie, csrfToken);
  assert.equal(atta.status, 201);
  const attaId = (await atta.json() as { id: string }).id;
  const basmati = await request('/api/admin/products', 'POST', {
    categoryId: riceId, names: names('Basmati', 'बासमती', 'बासमती'), descriptions,
    imageRef: 'https://example.com/basmati.jpg', active: true,
    claims: [{ kind: 'ORGANIC', textEn: 'Certified organic', evidenceRef: 'https://example.com/certificate' }],
  }, cookie, csrfToken);
  assert.equal(basmati.status, 201);
  const basmatiId = (await basmati.json() as { id: string }).id;
  assert.equal((await request('/api/admin/variants', 'POST', {
    productId: basmatiId, weightGrams: 1000, riceAge: '1 year', evidenceRef: null,
  }, cookie, csrfToken)).status, 400);
  const riceVariant = await request('/api/admin/variants', 'POST', {
    productId: basmatiId, weightGrams: 1000, riceAge: '1 year', evidenceRef: 'https://example.com/age-proof',
  }, cookie, csrfToken);
  assert.equal(riceVariant.status, 201);
  const flourVariant = await request('/api/admin/variants', 'POST', {
    productId: attaId, weightGrams: 1000, riceAge: null, evidenceRef: null,
  }, cookie, csrfToken);
  assert.equal(flourVariant.status, 201);
  const flourVariantId = (await flourVariant.json() as { id: string }).id;
  const riceVariantId = (await riceVariant.json() as { id: string }).id;

  for (const [storeId, price, stock] of [['1', '60.00', 10], [secondStoreId, '75.00', 3]] as const) {
    assert.equal((await request(`/api/admin/stores/${storeId}/offers/${flourVariantId}`, 'PUT', {
      priceInr: price, stockOnHand: stock, active: true, reason: 'Opening stock',
    }, cookie, csrfToken)).status, 204);
  }
  assert.equal((await request(`/api/admin/stores/1/offers/${riceVariantId}`, 'PUT', {
    priceInr: '150.00', stockOnHand: 5, active: true, reason: 'Opening stock',
  }, cookie, csrfToken)).status, 204);
  assert.equal((await request('/api/admin/stores/1', 'PUT', northSetup, cookie, csrfToken)).status, 204);
  assert.equal((await request(`/api/admin/stores/${secondStoreId}`, 'PUT', {
    name: 'South Nagpur', address: 'South Road, Nagpur', contactPhone: '9876543211',
    preparationLeadMinutes: 45, deliveryFee: '35.00', orderingEnabled: true,
    hours: hours('10:00', '20:00', '19:00', 2),
    pickupTimes: [{ weekday: 1, pickupAt: '12:00' }], deliveryPincodes: ['440002'],
  }, cookie, csrfToken)).status, 204);

  const north = await request('/api/catalog?storeId=1&lang=hi');
  const south = await request(`/api/catalog?storeId=${secondStoreId}&lang=mr`);
  const northOffers = (await north.json() as { offers: { name: string; priceInr: string }[] }).offers;
  const southOffers = (await south.json() as { offers: { name: string; priceInr: string }[] }).offers;
  assert.deepEqual(northOffers.map((offer) => offer.priceInr).sort(), ['150.00', '60.00']);
  assert.deepEqual(southOffers.map((offer) => offer.priceInr), ['75.00']);
  assert.equal(northOffers[0]!.name, 'गेहूं का आटा');
  assert.equal(southOffers[0]!.name, 'गव्हाचे पीठ');
  const available = await request('/api/stores/1/availability?at=2026-09-28T04%3A00%3A00Z&pincode=440001');
  assert.equal((await available.json() as { available: boolean }).available, true);
  const unavailable = await request(`/api/stores/${secondStoreId}/availability?at=2026-09-28T04%3A00%3A00Z&pincode=440001`);
  assert.equal((await unavailable.json() as { available: boolean }).available, false);
  const closed = await request('/api/stores/1/availability?at=2026-09-27T04%3A00%3A00Z&pincode=440001');
  assert.equal((await closed.json() as { available: boolean }).available, false);
  const afterCutoff = await request('/api/stores/1/availability?at=2026-09-28T12%3A00%3A00Z&pincode=440001');
  assert.equal((await afterCutoff.json() as { available: boolean }).available, false);
  assert.equal((await request('/api/admin/stores/1', 'PUT', { ...northSetup,
    hours: hours('19:00', '09:00', '08:00', 0),
  }, cookie, csrfToken)).status, 400);
  await db.query('UPDATE store_variant_offers SET stock_reserved = 8 WHERE store_id = 1 AND variant_id = $1',
    [flourVariantId]);
  assert.equal((await request(`/api/admin/stores/1/offers/${flourVariantId}`, 'PUT', {
    priceInr: '60.00', stockOnHand: 7, active: true, reason: 'Stock correction',
  }, cookie, csrfToken)).status, 409);
  await db.query('UPDATE store_variant_offers SET stock_reserved = 0 WHERE store_id = 1 AND variant_id = $1',
    [flourVariantId]);
  const overview = await request('/api/admin/overview?storeId=1', 'GET', undefined, cookie);
  assert.equal((await overview.json() as { stock: { offers: number } }).stock.offers, 2);

  const staff = await request('/api/admin/staff', 'POST', {
    loginName: 'southstaff', password: 'StrongStaffPassword123!', role: 'STAFF', storeId: secondStoreId,
  }, cookie, csrfToken);
  assert.equal(staff.status, 201);
  assert.equal((await request('/api/admin/login', 'POST', {
    login: 'southstaff', password: 'StrongStaffPassword123!',
  })).status, 401);
  const manager = await request('/api/admin/staff', 'POST', {
    loginName: 'southadmin', password: 'StrongSecondAdmin123!', role: 'ADMIN', storeId: secondStoreId,
  }, cookie, csrfToken);
  assert.equal(manager.status, 201);
  const managerId = (await manager.json() as { id: string }).id;
  const managerLogin = await request('/api/admin/login', 'POST', {
    login: 'southadmin', password: 'StrongSecondAdmin123!',
  });
  const managerCookie = managerLogin.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal((await request('/api/admin/stores', 'GET', undefined, managerCookie)).status, 200);
  assert.equal((await request(`/api/admin/staff/${managerId}`, 'PUT', {
    role: 'ADMIN', storeId: secondStoreId, active: false,
  }, cookie, csrfToken)).status, 204);
  assert.equal((await request('/api/admin/stores', 'GET', undefined, managerCookie)).status, 401);

  const logout = await request('/api/admin/logout', 'POST', undefined, cookie, csrfToken);
  assert.equal(logout.status, 204);
  assert.equal((await request('/api/admin/stores', 'GET', undefined, cookie)).status, 401);
  await migrate();
});
