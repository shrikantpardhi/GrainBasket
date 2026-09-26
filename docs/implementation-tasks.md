# Phase 1 implementation tasks

Build in the order below: **admin web and API foundation → store Android and order operations → consumer Android and release**. These are implementation tasks, not a change to the [Phase 1 scope](phase-1.md). Each app uses the same Node.js API and PostgreSQL database; apply the [initial schema](../services/api/migrations/001_phase1.sql) first. The [roadmap](implementation-roadmap.md) gives stage gates, and the [shared operations](operations.md) and app specifications give detailed acceptance rules. Keep the application folders as placeholders until their stage begins.

## 1. Admin web and shared API foundation

- [ ] **A1 — Bootstrap the API and admin app.** Set up the Node.js service, PostgreSQL migration runner, React app, environment configuration and local start/test commands. Apply the initial migration and verify a health check; keep database credentials on the server and document HTTPS deployment requirements.
- [ ] **A2 — Secure staff access.** Implement hashed staff/admin passwords, revocable sessions, active-account checks, server-side role and store authorization, and secure admin cookies with CSRF protection. Admin can sign in/out; staff credentials cannot access admin settings; deactivation invalidates access.
- [ ] **A3 — Configure the store.** Implement admin APIs and screens for identity/contact, daily hours and closures, cutoff, pickup slots/lead time, delivery pincodes/fee and ordering switch. Do not enable checkout before required settings are complete; reject closed-hours and unsupported-pincode quotes server-side.
- [ ] **A4 — Publish the catalog and reward rules.** Implement admin APIs and screens for flour/rice categories, weight/rice-age variants, images, stock, active state, English/Hindi/Marathi content, staff accounts and reward values. Validate price/stock and translations or approved English fallback; restrict these writes to admin.
- [ ] **A5 — Verify the admin foundation.** From the React panel configure one store, flour and rice variants, three-language content, reward settings and a staff account; confirm unauthorized access is rejected and the API serves the published catalog and hours for the later Android clients. Follow the [admin acceptance checks](admin.md).

## 2. Store Android and order operations

Depends on A1–A4. The API remains the owner of pricing, stock, payment and status changes.

- [ ] **S1 — Implement quotes and atomic checkout.** Add server-calculated quotes, schedule/delivery validation, order snapshots, idempotent order creation, stock and reward reservations with expiry, and staff cash collection in the same transaction as a placed order. Concurrent checkouts must not oversell or spend points twice; retries return the existing outcome.
- [ ] **S2 — Integrate online payment and refunds.** Select the gateway during implementation. Add provider-hosted UPI/card attempts, authenticated callback verification, duplicate/late callback reconciliation, payment expiry, stock release and tracked online/cash refunds. Neither Android client nor admin can mark online payments paid; pending attempts stay out of the fulfillment queue.
- [ ] **S3 — Enforce order operations and rewards.** Add staff-only queue, valid pickup/delivery transitions, flour arrival and estimate history, stock adjustments with reasons, cancellation/refund initiation, completed-order point awards and restoration. Record actor/time and require staff to access only their store's orders; repeat transitions or point credits must be safe.
- [ ] **S4 — Build staff order entry in Compose.** Add staff sign-in, three-language UI, server-backed cart/quote, required customer name/mobile, pickup/delivery and flour options, separate optional marketing choice, cash confirmation and provider-hosted online checkout. Add OTP verification only for redemption or claiming unverified staff-order points; ordinary staff entry does not require the consumer app.
- [ ] **S5 — Build staff fulfillment in Compose.** Show paid orders and pending payment attempts separately; provide arrival check-in, prepare/ready actions, delayed estimate with reason, handover, cancellation and stock correction. After uncertain network results, refresh the server state before allowing another action.
- [ ] **S6 — Complete admin reconciliation.** Add admin views for order source, cash versus verified online attempts, cancellation reasons, refund progress, manual cash refunds and audited reward corrections. Verify a paid cash order and an online order can each be cancelled and reconciled without double refunds or double point credits. Follow the [store](store.md) and [admin](admin.md) release checks.

## 3. Consumer Android and Phase 1 release

Depends on the verified S1–S6 order and payment paths; reuse them rather than building a second checkout.

- [ ] **C1 — Add customer identity and read APIs.** Implement OTP issuance/verification with expiry and rate limits, customer sessions, order ownership, reward balance/history and marketing choice/withdrawal. Browsing remains public; one customer cannot read another customer's order or points.
- [ ] **C2 — Build browse and fulfillment in Compose.** Add persisted English/Hindi/Marathi choice, translated flour/rice catalog with English fallback, cart/grind choices, configured hours, supported delivery and the two flour pickup modes. Reject inactive stock, closed windows, unsupported pincodes and unavailable advance times on the server.
- [ ] **C3 — Build customer checkout.** Confirm a server quote and eligible minimum-balance redemption; start provider-hosted UPI/card payment; show pending until server verification. Retries must not duplicate charges; changed prices, stock or points require reconfirmation.
- [ ] **C4 — Build history and tracking.** Show the customer's paid orders, flour arrival/requested/updated estimate, fulfillment status, refund progress and earned/used points on refresh. Never show ready or refunded solely because the client expects it.
- [ ] **C5 — Verify launch behavior.** Exercise both flour pickup modes and delivery in all three languages, staff fulfillment, admin reconciliation, payment failure/late success, duplicate checkout, stale quote, cancellation/refund, points restoration and cross-account access. Configure actual store/reward/provider values and test database backup/restore before accepting live orders. Follow the [consumer release checks](consumer.md).

## Later: Phase 2 second-store pilot

Start only after a stable Phase 1 launch and the separate rollout decision in the [Phase 2 specification](phase-2.md). Apply the [store-offers migration](../services/api/migrations/002_phase2_store_offers.sql) with the API changes, not ahead of them.

- [ ] **P2-A — Admin web:** Select a store to configure its hours, delivery coverage, staff and variant offers; set independent price, sellable stock and active state for each store.
- [ ] **P2-S — Store Android:** Keep queue, adjustments and fulfillment restricted to the signed-in staff account's store; reject cross-store order or stock writes on the API.
- [ ] **P2-C — Consumer Android:** Let customers explicitly choose a store and re-quote its catalog, stock, delivery/pickup availability and fee; clear/reconfirm the cart on store changes, and label each order's store in history.

Verify both stores' cash/online pickup and delivery flows, independent stock/prices and shared verified customer points before the pilot. The future iOS consumer app is a separate later task.
