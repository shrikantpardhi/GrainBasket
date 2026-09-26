# Phase 2 business and product specification

**Status:** Defined scope for a second-store pilot after the [Phase 1](phase-1.md) entry criteria are met. Its rollout needs a separate decision.

## Goal and entry criteria

Enable a **second Nagpur store** without mixing its orders, inventory or staff access with the first store. Start this phase only after the first store can routinely accept and fulfill both pickup and delivery orders and admin can reconcile online and staff-collected cash payments/refunds. Use Phase 1 order completion, payment failures, cancellation reasons and customer feedback to decide the order of improvements.

## Core scope: second-store pilot

| Capability | Behavior and acceptance check |
| --- | --- |
| Store selection | Customer selects a store explicitly; for delivery, show only stores serving the entered pincode. Show store address and hours for pickup. Changing store clears or reconfirms the cart; do not mix stores in one order. No automatic geolocation is required. |
| Catalog and availability | Admin assigns products/weight variants to each store and sets that store's price, active flag and sellable stock. Flour grind remains an order choice; rice age remains stocked by variant. Customer sees the selected store's current offer. |
| Checkout | Requote using the selected store's inventory, delivery coverage/fee and hours. An order belongs to exactly one store; price, item, address and fee snapshots remain stable if the store later changes its catalog. Orders cannot consume another store's stock. |
| Store operations | Each store Android app account sees and updates only its own store's orders, flour pickup queue/ready estimates and stock, including staff-entered cash/online orders. Admin web can select either store and configure its own daily hours, weekly closed days, cutoff and pickup availability; customer history includes clear store names. Verified customers keep one shared points balance across both stores; transactions record the order's store. Multilingual content, cash collection, verified online payment, refund and status rules remain those of [Operations](operations.md). |
| Pilot verification | Place consumer and staff-created cash/online orders at each store, for pickup and delivery; vary price and stock independently, check overlapping/unsupported pincodes, cancel an order and verify only the selected store's stock changes. Attempt cross-store staff/order access and reject it. |

Keep one backend and database unless measured scale calls for more. Add a store-offer/variant relationship for per-store price, stock and active status; keep product descriptions shared until store-specific content is truly needed. Reuse the existing order store reference and add store-aware uniqueness/authorization checks. No delivery partner application or complex tenant infrastructure is needed for a two-store pilot.

The [Phase 2 migration](../services/api/migrations/002_phase2_store_offers.sql) moves Phase 1 variant price, stock and active status to the existing store's offers. It requires exactly one existing store when variants exist and must be deployed with API changes that use offers for quotes, stock reservations and adjustments. Add the second store and assign its offers only after migration; order snapshots and customer points remain shared as described above.

## Future iOS consumer app

The future iOS consumer app will use the same backend API, customer accounts, catalog and order rules. Decide whether to share mobile code with Android when planning that app.
