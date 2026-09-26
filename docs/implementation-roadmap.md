# Phase 1 implementation roadmap

Build in this order: **admin web → store Android → consumer Android**. Each stage extends the same Node.js API and PostgreSQL database; no application connects directly to PostgreSQL. Follow the [Phase 1 scope](phase-1.md), [shared operations](operations.md) and the acceptance checks in each application specification. This is build sequence, not a change to the agreed launch scope: all three apps must work before Phase 1 opens to customers.

## Monorepo layout

```text
apps/
  admin-web/          React admin panel
  store-android/      Kotlin/Jetpack Compose staff app
  consumer-android/   Kotlin/Jetpack Compose customer app
services/
  api/                Node.js API and its PostgreSQL migrations
docs/                 Business, application and shared specifications
```

Keep each application in its own folder and build it with its native tooling; all three communicate through the API in `services/api/`, which alone connects to PostgreSQL. Add shared packages only when there is code to share, and add the future iOS consumer app under `apps/` when it is planned. The app folders are placeholders; the API folder holds the [initial Phase 1 SQL schema](../services/api/migrations/001_phase1.sql), with no application source or build configuration yet.

## 1. Admin web and shared foundation

- Set up the Node.js API, apply and evolve the initial PostgreSQL schema, and build the React admin app and secure HTTPS entrypoint. Implement admin sign-in, role checks, revocable sessions and private database access first.
- Add store configuration for daily opening/closing hours, weekly closed days, order cutoff, pickup preparation lead time, supported delivery pincodes and fee. Ordering remains disabled until required settings are entered.
- Add flour/rice catalog, weight/age variants, stock, three-language catalog content, staff accounts and configurable reward values. Make the admin panel usable in English, Hindi and Marathi.
- **Ready for store work when:** an admin can configure the Nagpur store, publish a translated flour and rice catalog, set reward values, and create/deactivate a staff account; unauthorized staff cannot change admin settings. Order/payment and refund screens are completed in stage 2, when their backend records exist.

## 2. Store Android and order operations

- Add authenticated staff APIs and the order, order-item, stock-reservation, status-event, payment, refund, reward and marketing-choice records in PostgreSQL. Implement server-calculated quotes, idempotent order submission and server-enforced store/order permissions.
- Build the Kotlin/Jetpack Compose store app for staff-entered pickup/delivery orders, customer name/mobile, optional marketing consent, cash collected at order entry and customer UPI/card payment. Choose the gateway during this stage; the backend verifies online payment and manages failed/expired attempts and refunds. Add mobile OTP verification for points redemption and claiming staff-order points.
- Add the paid-order queue, flour grind-on-arrival or ready-at-selected-time preparation, updated ready estimates, stock adjustments, pickup/delivery transitions and manual cash refund recording. Complete the admin order/payment/refund views and cash reconciliation using the same backend records. Support English, Hindi and Marathi in the store app.
- **Ready for consumer work when:** staff can place and fulfill a cash order and a provider-verified online order without the consumer app, handle both flour pickup modes, reconcile a cancellation/refund in admin, and see points credited only once at completion. Pending payments never enter the queue; repeat submissions and unauthorized status changes are rejected.

## 3. Consumer Android and Phase 1 release

- Add customer OTP sessions and customer-owned order/reward APIs to the existing backend. Reuse the catalog, quotes, payment verification, fulfillment and reward rules from stage 2; do not create a second order or payment implementation.
- Build the Kotlin/Jetpack Compose consumer app for language choice, flour/rice browsing, pickup or supported-pincode delivery, both flour pickup modes, name/mobile verification, minimum-balance points redemption, UPI/card checkout, order/refund history and refreshed ready-time estimates. Support English, Hindi and Marathi throughout checkout.
- **Ready to launch when:** a customer can complete and track pickup and delivery orders in all three languages while store staff fulfill them and admin reconciles them. Verify failed/late payment, stale price/stock, closed hours, duplicate submission, cancellation/refund, reward reversal and cross-account access against the [consumer](consumer.md), [store](store.md) and [admin](admin.md) release checks and [shared security rules](operations.md). Configure real store/reward values and provider settings, review translations, and test database backup/restore before accepting live orders.

After a stable Phase 1 pilot, use the [Phase 2 specification](phase-2.md) for a second Nagpur store. A future iOS consumer app uses the same backend API and customer data; its mobile-code approach is decided when that work begins.
