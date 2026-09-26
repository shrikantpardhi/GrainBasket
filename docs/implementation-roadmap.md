# GrainBasket v1.0 implementation roadmap

Build in this order: **admin web → store Android → consumer Android**. Each stage extends the same Node.js API and PostgreSQL database; no app connects to PostgreSQL directly. The single [v1.0 PRD](prd-v1.0.md) defines the launch scope: **two Nagpur stores, all three apps, and the shared order/payment/reward workflows**. The order below is a build sequence; it does not allow a one-store release.

The [implementation tasks](implementation-tasks.md) break each stage into concrete work and completion checks.

## Monorepo layout

```text
apps/
  admin-web/          React admin panel
  store-android/      Kotlin/Jetpack Compose staff app
  consumer-android/   Kotlin/Jetpack Compose customer app
services/
  api/                Node.js API and its PostgreSQL migrations
docs/                 v1.0 PRD, roadmap and implementation tasks
```

Keep each application in its own folder and build it with native tooling; all three communicate through the API in `services/api/`, which alone connects to PostgreSQL. Add shared packages only when there is code to share, and add a future iOS consumer app under `apps/` when planned. The app folders are placeholders; the API folder holds [001](../services/api/migrations/001_phase1.sql) and [002](../services/api/migrations/002_phase2_store_offers.sql) migrations without application source yet. Apply both in order on a fresh v1.0 database **before** creating either store and its offers.

## 1. Admin web and shared foundation

- Set up the Node.js API, apply both PostgreSQL migrations, and build the React admin app and secure HTTPS entrypoint. Implement admin sign-in, role checks, revocable sessions and private database access first.
- Configure both stores independently: address/contact, daily hours, weekly closures, cutoff, pickup lead time/slots, delivery coverage/fee and ordering switch. Ordering remains disabled until the selected store is configured.
- Add shared flour/rice catalog and three-language content, per-store variant offers with different prices/stock/active state, store-assigned staff accounts and configurable reward values. Make the admin panel usable in English, Hindi and Marathi.
- **Ready for store work when:** admin can configure both stores, publish translated flour/rice offers with independent stock/prices, set reward values and create/deactivate staff in each store; unauthorized staff cannot change settings. Complete order/payment/refund screens in stage 2 when those records exist.

## 2. Store Android and order operations

- Implement selected-store quotes, idempotent checkout, stock/points reservations and authenticated staff APIs against the shared order/payment/reward data. Limit staff to their assigned store and prevent cross-store stock and order writes.
- Build the Kotlin/Jetpack Compose store app for each store's pickup/delivery orders, name/mobile and optional marketing consent, cash collected at entry and hosted UPI/card payment. Choose the gateway during this stage; verify callbacks on the backend and manage failures, expiry and refunds.
- Implement one mobile OTP service for staff redemption/claims and future consumer sign-in: short expiry, attempt limits, single use and a **30-second per-mobile resend wait** shared across apps/purposes. Enforce it before sending SMS under concurrency; blocked requests send none and do not reset the wait.
- Add a store-only paid queue, both flour preparation modes, arrival and estimate actors, stock corrections, fulfillment transitions, manual cash refund recording and admin reconciliation/reporting. Support all three languages in the store app.
- **Ready for consumer work when:** both store staffs can place and fulfill cash and verified online orders without the consumer app, reconcile cancellations/refunds, and award points once; pending payments stay out of the queue. Cross-store writes, duplicate submissions, invalid transitions and OTP re-requests before 30 seconds are rejected.

## 3. Consumer Android and v1.0 release

- Add customer sessions and customer-owned order/reward APIs, reusing the shared OTP service with its 30-second resend wait and the existing quote, payment and reward logic. Do not create a second checkout implementation.
- Build the Kotlin/Jetpack Compose consumer app for language, explicit store selection, pincode-filtered delivery, selected-store catalog/hours/fees, both flour pickup modes, mobile verification, minimum-balance shared points, UPI/card checkout and order/refund/ready-time history. Support all three languages throughout.
- **Ready to launch when:** consumers can order and track pickup and delivery from **both** stores in all three languages while each store's staff fulfill only their own orders and admin reconciles both. Exercise late/failed payment, stale offers, closed hours, duplicate submission, cancellation/refund, reward restoration, OTP 29/30-second and concurrent resend checks, and cross-account/store denial against the [v1.0 acceptance criteria](prd-v1.0.md#data-deployment-and-release-acceptance). Configure actual store/reward/tax/provider policies, review translations and test backup/restore before accepting live orders.

A future iOS consumer app can use the same backend API and customer data; its mobile-code approach is decided later.
