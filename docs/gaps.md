# Gaps, decisions and roadmap

This reviews the seven original root-level specifications on `shrikantpardhi-patch-1` against the product owner's clarified [Phase 1](phase-1.md): one Nagpur store, flour/rice and two flour pickup choices, English/Hindi/Marathi, consumer UPI/card payments, staff-entered cash/online orders, purchase reward points, and separate consumer/store/admin apps sharing one backend and database. [Phase 2](phase-2.md) proposes the second-store pilot. **Open** means an implementation or operating decision still needs an owner before launch.

## Contradictions resolved in the revised specification

| Original documents | Conflict or missing link | Phase 1 treatment |
| --- | --- | --- |
| `PRD-v1.0.md` vs `ConsumerPRD-v1.0.md`, `StorePRD-v1.0.md`, `AdminPRD-v1.0.md` | Spring Boot vs Node.js backend; no common application boundary | Node.js backend, PostgreSQL, Kotlin/Jetpack Compose consumer and store Android apps, React web admin. The exact Node.js framework remains open. |
| `PRD-v1.0.md`, `Database-v1.0.md` vs `ConsumerPRD-v1.0.md` | Delivery address needed at checkout, but `USER_ADDRESSES` is marked Phase 2 | Capture a delivery address on each order in Phase 1; defer an address book. |
| `PRD-v1.0.md`, `Database-v1.0.md` | Store pricing, coupons and banners assume multiple stores despite one-store MVP | Keep a store reference for orders; postpone coupons, banners and per-store overrides. |
| `StorePRD-v1.0.md`, `DeliveryStatusPRD-v1.0.md`, `Database-v1.0.md` | Different status paths; database omits pickup completion, cancellation reason and event history | One pickup/delivery lifecycle and a status event with actor/time. `COLLECTED` closes pickup; `DELIVERED` closes delivery. |
| `ConsumerPRD-v1.0.md`, `TranslationPRD-v1.0.md` vs `Database-v1.0.md` | Three languages and translations described but missing from core schema | Phase 1 includes all three apps in English/Hindi/Marathi, shared translations and an English fallback. Assign a translation reviewer before launch. |
| `PRD-v1.0.md`, `ConsumerPRD-v1.0.md` vs `Database-v1.0.md` | UPI/card/COD and GST invoice promised while payments table is Phase 2 and tax rules are undefined | UPI and cards are Phase 1 for consumer and staff checkout; store staff may collect cash when entering an order. Add payment/refund records, provider verification for online and an auditable cash collection. Tax invoice requirements remain open; no claim of GST readiness until checked. |

## Missing decisions and safeguards

The product owner confirmed the core launch scope above. Coupons, banners, saved addresses, cash on pickup/delivery and extra categories remain deferred in this small first release. Confirm any exception before implementation and update [Phase 1](phase-1.md) and the affected application specification.

| Priority | Gap / consequence | Proposed small first step | Owner to confirm |
| --- | --- | --- | --- |
| **Before launch** | Daily store opening/closing times, order cutoff, capacity and delivery area are unspecified; customers may order when the store cannot fulfill. | Confirm local opening/closing hours, cutoff and supported pincodes; display hours and reject orders outside the confirmed rules. | Store owner |
| **Before launch** | Flour pickup choices require realistic arrival waits and available ready-in-advance times. | Confirm whether 30 minutes after arrival is a sustainable baseline, preparation lead time and pickup availability. Show delayed estimates in the store queue and consumer app; do not promise an exact queue position. | Store owner |
| **Before launch** | Delivery fee, minimum order and delivery fulfillment expectations are unspecified. | Confirm one flat fee, any minimum and who delivers; show fee before payment. | Store owner |
| **Before launch** | UPI/card gateway, fees, settlement, refund timing, failure/timeout behavior and support ownership are unspecified. | Choose the gateway during implementation and confirm supported UPI/card flows for both apps; agree reservation expiry, late-success refunds, cancellation refund process and daily reconciliation. No specific provider is required in this specification. | Business/engineering |
| **Before launch** | Staff-entered cash orders need a cash receipt, reconciliation and manual refund policy. | Collect cash at order entry, record staff actor/amount/time, reconcile daily against the till and record manual refunds only once after money is returned. | Store owner/admin |
| **Before launch** | Purchase points have no earning rate, redemption minimum/value/limit or refund adjustment policy. | Approve one simple rule, show its value before payment and keep a positive cash/UPI/card balance. Credit only completed orders and reconcile refunds and unclaimed staff-order points. | Business/store owner |
| **Before launch** | Collecting names/mobile for orders does not authorize marketing; rewards must not depend on marketing permission. | Confirm separate optional opt-in text, withdrawal and retention rules. Use verified mobile ownership before points redemption or claiming staff-order points. | Business/product |
| **Before launch** | Hindi/Marathi UI and catalog text has no assigned translator, review or fallback policy. | Appoint language reviewer; approve three-language content for checkout, payment, order status and catalog. Use English fallback only when approved. | Product/content |
| **Before launch** | Tax treatment, product classification, receipts and invoice obligations are unspecified. | Obtain local accounting advice, define tax-inclusive/exclusive display and required receipt/invoice fields before taking real orders. | Business/accountant |
| **Before launch** | “Freshly milled,” rice age, organic and nutrition claims lack a verification process; packaging and food-sale requirements are not documented. | Record supplier/batch and milling/packing practice offline; verify local food-sale and labeling requirements; show only claims the store can substantiate. | Store owner |
| **Before launch** | OTP sender, cost and abuse limits are unspecified. | Choose provider and message template; set expiry, retries and rate limits. | Product/engineering |
| **Before launch** | Cancellation, rejected orders, failed delivery, returns and paid-order refund policy are missing. | Publish support policy; allow consumer-app cancellation before acceptance and staff cancellation before handover with reason. Track provider refunds for online payments and confirmed manual returns for staff-collected cash. | Business/operations |
| **Before launch** | Personal data handling and operational security are unspecified. | Approve privacy text, retention/deletion policy, staff access, backup/restore and HTTPS entrypoint. | Business/engineering |
| **Before build** | Node.js is confirmed, but its framework and the hosting/TLS arrangement are unspecified. | Choose a Node.js framework and deployment arrangement; use a reverse proxy where hosting does not already cover TLS/routing. | Engineering |
| **During build** | Variant vs grind inventory, stock races, price changes, duplicate charges/cash receipts and past-order integrity are undefined. | Use variant stock and order-item grind; atomic expiring online reservation, atomic cash order/receipt creation, explicit quote confirmation, idempotent submit and item snapshots. | Engineering/store |
| **During build** | How customers learn order progress is vague (“live notifications” promised). | Show status on refresh; set support contact on order details. Add push only after operational reliability is proven. | Product/store |

The open decisions do not change the confirmed three apps, languages, online payment methods, staff-entered cash option, flour pickup modes or purchase rewards. If a decision changes that scope, revise [Phase 1](phase-1.md) and then its acceptance checks before implementation.

## Release order

1. **Phase 1: validate one Nagpur store.** Three apps, three languages, flour/rice, two flour pickup modes with queue estimates, pickup/delivery, consumer phone checkout, staff-entered cash/online orders, verified UPI/card payments, purchase points, refunds and order statuses.
2. **Phase 2: expand the proven journey.** Add a second Nagpur store with store-specific catalog, inventory, delivery and staff permissions. Consider saved addresses, promotions and richer notifications separately. See the [Phase 2 specification](phase-2.md).
3. **Later:** Delivery partner app, other cities, loyalty tiers/campaigns, reviews, subscriptions, new prepared products and B2B sales need separate operating plans.

## Source coverage

| Original file | Where its useful content now lives |
| --- | --- |
| `PRD-v1.0.md` | [Phase 1](phase-1.md), [Phase 2](phase-2.md), this roadmap |
| `ConsumerPRD-v1.0.md` | [Consumer](consumer.md), [Operations](operations.md) |
| `StorePRD-v1.0.md` | [Store](store.md), [Operations](operations.md) |
| `AdminPRD-v1.0.md` | [Admin](admin.md), [Operations](operations.md) |
| `DeliveryStatusPRD-v1.0.md` | [Operations](operations.md) |
| `Database-v1.0.md` | [Operations](operations.md), this roadmap |
| `TranslationPRD-v1.0.md` | [Operations](operations.md), [Consumer](consumer.md), [Store](store.md), [Admin](admin.md) |
