# Gaps, decisions and roadmap

This is a review of the seven original root-level specifications on `shrikantpardhi-patch-1`. [Phase 1](phase-1.md) sets the proposed first-release boundary; [Product](product.md) and [Operations](operations.md) make it testable. [Phase 2](phase-2.md) describes the proposed second-store expansion. **Open** means a business or technical choice still needs an owner to confirm before the relevant launch work.

## Contradictions resolved for the proposed baseline

| Original documents | Conflict or missing link | Phase 1 treatment |
| --- | --- | --- |
| `PRD-v1.0.md` vs `ConsumerPRD-v1.0.md`, `StorePRD-v1.0.md`, `AdminPRD-v1.0.md` | Spring Boot vs Node.js backend; separate Android store app vs small one-store launch | One backend and one staff/admin web workspace; Node.js is an unapproved working assumption. No second store app at launch. |
| `PRD-v1.0.md`, `Database-v1.0.md` vs `ConsumerPRD-v1.0.md` | Saved delivery addresses needed at checkout, but `USER_ADDRESSES` is marked Phase 2 | Capture a delivery address on each order in Phase 1; defer an address book. |
| `PRD-v1.0.md` vs `Database-v1.0.md` | Store pricing, coupons and banners assume multiple stores despite one-store MVP | Keep a store reference for orders/catalog; postpone coupons, banners and per-store overrides. |
| `StorePRD-v1.0.md`, `DeliveryStatusPRD-v1.0.md`, `Database-v1.0.md` | Different status names/paths; database omits pickup completion, cancellation reason and event history | One channel-specific lifecycle and a status event with actor/time. `COLLECTED` closes pickup; `DELIVERED` closes delivery. |
| `ConsumerPRD-v1.0.md`, `TranslationPRD-v1.0.md` vs `Database-v1.0.md` | English/Marathi/Hindi backend translation tables described separately, missing from core schema | English UI and catalog first. Localized content/UI and translation storage require a later content plan. |
| `PRD-v1.0.md`, `ConsumerPRD-v1.0.md` vs `Database-v1.0.md` | UPI/card/COD and GST invoice promised while payments table is Phase 2 and tax rules are undefined | Pay on handover; server-calculated totals and a basic receipt/order summary. Tax invoice requirements remain open; no claim of GST readiness until checked. |

## Missing decisions and safeguards

First, the product owner should approve the proposed Phase 1 cuts together: **flour and rice to launch; English first; a web workspace instead of a store Android app; pay on handover; no coupons or banners**. These depart from features called Phase 1 in the original documents. If any are essential to launch, identify which one before implementation and update the [Phase 1 specification](phase-1.md).

| Priority | Gap / consequence | Proposed small first step | Owner to confirm |
| --- | --- | --- | --- |
| **Before launch** | Store hours, order cutoff, capacity and delivery area are unspecified; customers may order when the store cannot fulfill. | Confirm hours, cutoff and supported pincodes; reject orders outside the confirmed rules. | Store owner |
| **Before launch** | Delivery fee, minimum order, travel/fulfillment expectations and who takes payment are unspecified. | Confirm one flat delivery fee, whether there is a minimum, who delivers and payment collection process; show the fee before confirmation. | Store owner |
| **Before launch** | Tax treatment, product classification, receipts and invoice obligations are unspecified. | Obtain local accounting advice, define tax-inclusive/exclusive display and required receipt/invoice fields before taking real orders. | Business/accountant |
| **Before launch** | “Freshly milled,” rice age, organic and nutrition claims lack a verification process; packaging and food-sale requirements are not documented. | Record supplier/batch and milling/packing practice offline; verify local food-sale and labeling requirements; show only claims the store can substantiate. | Store owner |
| **Before launch** | OTP sender, cost and abuse limits are unspecified. | Choose provider and message template; set expiry, retries and rate limits. | Product/engineering |
| **Before launch** | Cancellation, rejected orders, failed delivery, returns and refund policy are missing. | Publish a simple contact-and-manual-resolution policy; allow in-app cancellation before acceptance and staff cancellation before handover with reason. | Business/operations |
| **Before launch** | Personal data handling and operational security are unspecified. | Approve privacy text, retention/deletion policy, staff access, backup/restore and HTTPS entrypoint. | Business/engineering |
| **Before launch** | The tech stack differs across the old PRDs. | Choose one backend language/framework and hosting/TLS arrangement; use a reverse proxy where hosting does not already cover TLS/routing. | Engineering |
| **During build** | Variant vs grind inventory, stock races, price changes, duplicate submits and past-order integrity are undefined. | Use variant stock and order-item grind; atomic reservation, explicit quote confirmation, idempotent submission and item snapshots. | Engineering/store |
| **During build** | How customers learn order progress is vague (“live notifications” promised). | Show status on refresh; set support contact on order details. Add push only after operational reliability is proven. | Product/store |

Open items above are not silently approved requirements. If a decision changes scope (for example online payment or three languages at launch), revise [Phase 1](phase-1.md) and then its acceptance checks before implementation.

## Release order

1. **Phase 1: validate one store in Nagpur.** Flour and rice, pickup/delivery, phone checkout, pay on handover, order statuses, staff stock/catalog management. Add millets, pulses and dry fruits through the catalog after they have verified stock and content.
2. **Phase 2: expand the proven journey.** Add a second Nagpur store with store-specific catalog and fulfillment. Consider multilingual content, saved addresses, payment gateway, promotions and richer notifications as separate increments after measuring demand. See the [Phase 2 specification](phase-2.md).
3. **Expansion after operations work for one store.** Multi-store pricing/discovery, couriers, new cities, loyalty, reviews, subscriptions, on-demand snacks and B2B sales. Introduce multi-store data and dispatch workflows when a second store is real.

## Source coverage

| Original file | Where its useful content now lives |
| --- | --- |
| `PRD-v1.0.md` | [Phase 1](phase-1.md), [Phase 2](phase-2.md), this roadmap |
| `ConsumerPRD-v1.0.md` | [Product](product.md), this roadmap |
| `StorePRD-v1.0.md` | [Product](product.md), [Operations](operations.md), this roadmap |
| `AdminPRD-v1.0.md` | [Product](product.md), [Operations](operations.md) |
| `DeliveryStatusPRD-v1.0.md` | [Operations](operations.md) |
| `Database-v1.0.md` | [Operations](operations.md), this roadmap |
| `TranslationPRD-v1.0.md` | This roadmap |
