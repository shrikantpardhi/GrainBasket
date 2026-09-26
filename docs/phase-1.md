# Phase 1 business specification

**Status:** Proposed Phase 1 baseline for business review. Open decisions are recorded in [Gaps and roadmap](gaps.md); do not treat assumptions as approved policy.

## Why this exists

Customers buying staples may not know when flour was milled or how old rice is. GrainBasket's promise is freshly milled flour prepared after an order, with a choice of fine, medium or coarse grind, and rice whose age is clearly identified. Start with a single Nagpur store to prove that customers can order and staff can fulfill this promise reliably.

## Phase 1 in one sentence

A customer at the single Nagpur store can browse an available staple, select a weight and any relevant grind or rice-age choice, place an order for local delivery to a supported pincode or store pickup, and see its progress; the store can prepare and complete that order.

## Scope

| Include in first release | Boundary |
| --- | --- |
| One store and a small curated catalog: flour and rice first; millets, pulses and dry fruits only where stock and content are ready | No store search, multi-store pricing or store-specific campaigns. One store record can hold address, hours, supported pincodes and delivery charge. |
| Flour weight and grind choice; rice weight and age where verified by the store | Grind is a preparation choice on the order, not a separate stocked SKU. Rice age is a stocked variant. Do not label a product organic, gluten-free or with a specific rice age without evidence. |
| Android customer app with phone OTP, basic catalog/cart/checkout, order list and status | English first; no social login, wishlist, extensive offline sync or push notifications. A refresh retrieves the latest status. |
| Pickup and delivery within configured pincodes; delivery address entered at checkout | No automatic nearby-store selection, GPS radius calculations, saved addresses or rider dispatch. Store staff coordinate delivery outside the app. |
| Pay on delivery or pickup, with the price and delivery fee shown before confirmation | No UPI/card gateway, coupons, free-delivery thresholds or subscription billing. Business must confirm cash collection and tax/receipt policy before launch. |
| One responsive web workspace for store staff and admin | Staff handle orders and stock; admin maintain catalog, prices, store settings and staff access. No separate store Android app or analytics dashboard. |

The first release can launch with **flour and rice only**. Adding the remaining Phase 1 categories means adding stocked catalog entries, not new product behavior. This is a scope recommendation, subject to business approval.

## Order and fulfillment promise

1. Customer browses available products, chooses pickup or enters a supported delivery pincode, and verifies a phone number at checkout.
2. The cart captures product variant, quantity and grind choice if flour. Checkout recalculates availability, prices and delivery fee on the server; the customer sees and confirms the final total.
3. Staff accept or cancel the order. Fresh flour is milled **after** acceptance. Staff prepare and pack the order, then mark it ready for pickup or delivery.
4. For pickup, staff mark it collected after handover and payment. For delivery, staff mark it out for delivery and then delivered after handover and payment. Customers see these updates in their order history when online.

See [Product journeys](product.md) for acceptance checks and [Operations and data](operations.md) for status transitions and stock rules.

## Measure a useful first release

Track weekly: orders placed, accepted, cancelled with reasons, successfully fulfilled, time from placement to ready, and stock-related cancellations. Review customer feedback about flour freshness and rice-age accuracy. Do not set numerical targets before the store confirms capacity and baseline demand.

## Out of scope until later

Multi-store discovery, other cities, delivery partner app, online payment, coupons, banners, loyalty, reviews, subscriptions, healthy snack production, backend-managed UI translations, and advanced reports. See [Gaps and roadmap](gaps.md) for sequencing and unresolved business policies.
