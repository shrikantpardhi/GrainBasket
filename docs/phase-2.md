# Phase 2 business and product specification

**Status:** Proposed next phase, not a commitment to build every listed feature. Phase 1 remains the [source of truth](phase-1.md) for the first release.

## Goal and entry criteria

Enable a **second Nagpur store** without mixing its orders, inventory or staff access with the first store. Start this phase only after the first store can routinely accept and fulfill both pickup and delivery orders, admin can reconcile online and staff-collected cash payments/refunds, and the open launch policies in [Gaps and roadmap](gaps.md) have owners and answers. Use Phase 1 order completion, payment failures, cancellation reasons and customer feedback to decide the order of improvements.

## Core scope: second-store pilot

| Capability | Behavior and acceptance check |
| --- | --- |
| Store selection | Customer selects a store explicitly; for delivery, show only stores serving the entered pincode. Show store address and hours for pickup. Changing store clears or reconfirms the cart; do not mix stores in one order. No automatic geolocation is required. |
| Catalog and availability | Admin assigns products/weight variants to each store and sets that store's price, active flag and sellable stock. Flour grind remains an order choice; rice age remains stocked by variant. Customer sees the selected store's current offer. |
| Checkout | Requote using the selected store's inventory, delivery coverage/fee and hours. An order belongs to exactly one store; price, item, address and fee snapshots remain stable if the store later changes its catalog. Orders cannot consume another store's stock. |
| Store operations | Each store Android app account sees and updates only its own store's orders and stock, including staff-entered cash/online orders. Admin web can select either store and manage settings; customer history includes clear store names. Multilingual content, cash collection, verified online payment, refund and status rules remain those of [Operations](operations.md). |
| Pilot verification | Place consumer and staff-created cash/online orders at each store, for pickup and delivery; vary price and stock independently, check overlapping/unsupported pincodes, cancel an order and verify only the selected store's stock changes. Attempt cross-store staff/order access and reject it. |

Keep one backend and database unless measured scale calls for more. Add a store-offer/variant relationship for per-store price, stock and active status; keep product descriptions shared until store-specific content is truly needed. Reuse the existing order store reference and add store-aware uniqueness/authorization checks. No delivery partner application or complex tenant infrastructure is needed for a two-store pilot.

## Separate improvements to prioritize after the pilot

These are candidate **increments**, not prerequisites for adding the second store. Approve one at a time from measured customer/store friction. English, Hindi, Marathi, UPI/card payments and staff-collected cash orders are already required in Phase 1.

| Candidate | Minimum useful version | Decision and acceptance condition |
| --- | --- | --- |
| Saved delivery addresses | Customer can save/edit/remove addresses and choose one at checkout; copy it to the order. | Confirm privacy/retention policy. Changing a saved address never alters a submitted order. |
| Coupons or banners | One store-scoped promotion at a time, with admin-controlled dates/eligibility and a final price shown before confirmation. | Show evidence promotions help conversion. Expired or ineligible offers cannot change an already confirmed order; avoid building a general rules engine. |
| Customer updates | Add a notification channel only if customers miss meaningful status changes on refresh. | Choose delivery channel/cost and consent; failed notification must not change order state. |

## Still later

Delivery partner assignment/app, loyalty, wishlist, reviews, subscriptions, franchise/multi-city operations, B2B, and new on-demand snack production need their own business case and operating model. Additional stocked categories can be added through the catalog when content and supply are ready; they do not require a new phase-wide feature.
