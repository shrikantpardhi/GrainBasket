# Phase 1 business specification

**Status:** Phase 1 scope confirmed by the product owner: one Nagpur store, three applications, English/Hindi/Marathi, flour and rice, UPI/card payments, and staff-entered orders with cash or online payment. Operating and gateway decisions remain in [Gaps and roadmap](gaps.md).

## Why this exists

Customers buying staples may not know when flour was milled or how old rice is. GrainBasket's promise is freshly milled flour prepared after an order, with a choice of fine, medium or coarse grind, and rice whose age is clearly identified. Start with a single Nagpur store to prove that customers can order and staff can fulfill this promise reliably.

## Phase 1 in one sentence

A customer can order flour or rice from the single Nagpur store in English, Hindi or Marathi, choose delivery to a supported pincode or pickup, pay online by UPI or card, and follow fulfillment in the consumer app. Staff can also enter an order in the store app without the consumer app, collecting cash at entry or having the customer pay online. Admin manages the store in a separate panel. All three applications use one backend and database.

## Scope

| Include in first release | Boundary |
| --- | --- |
| One Nagpur store with flour and rice | No other categories, store search, multi-store pricing or store-specific campaigns. The store has an address, hours, supported delivery pincodes and delivery charge. |
| Flour weight and grind choice; rice weight and age where verified by the store | Grind is a preparation choice on the order, not a separate stocked SKU. Rice age is a stocked variant. Do not label a product organic, gluten-free or with a specific rice age without evidence. |
| Separate consumer Android and store Android apps, plus a web admin panel | Customer phone OTP; staff/admin protected accounts. Each app supports English, Hindi and Marathi. No social login, wishlist or extensive offline order sync. |
| Pickup and delivery within configured pincodes; delivery address entered at checkout | No automatic nearby-store selection, GPS radius calculations, saved addresses or rider dispatch. Store staff coordinate delivery outside the app. |
| Consumer checkout uses UPI or card; store-entered checkout uses cash collected at entry or UPI/card | Final total appears before payment. Only provider-verified online or staff-confirmed cash orders enter the store queue. Failed/expired online attempts release stock; cancellation after payment requires a tracked provider or cash refund. Choose the payment gateway during implementation. |
| Shared backend and PostgreSQL database | Consumer, store and admin apps access shared data through authorized APIs, never by direct database connections. No coupons, banners, loyalty or analytics dashboard in Phase 1. |

The application responsibilities and acceptance checks are in [Consumer](consumer.md), [Store](store.md) and [Admin](admin.md). Shared order, payment, language and data rules are in [Operations and data](operations.md).

## Order and fulfillment promise

1. Customer browses flour/rice, selects a weight and grind or rice age, selects pickup or an eligible delivery address, verifies a phone number, confirms the server total and starts UPI/card payment in the consumer app.
2. Alternatively, staff enter a pickup or delivery order in the store app without requiring a customer account. They confirm the backend total, collect cash when entering the order or start customer UPI/card payment.
3. Online payment must be verified by the backend; staff-recorded cash collection is auditable. Only paid orders enter the store queue. Staff accept or cancel, mill flour **after** acceptance, prepare and pack, then mark ready for pickup or delivery.
4. Staff mark pickup collected or delivery out for delivery and delivered. Consumer-app customers see the status in their chosen language; staff-entered customers use the store contact channel. Paid cancellations show a tracked provider refund or cash refund record.

See the three application specifications for acceptance checks and [Operations and data](operations.md) for status, payment and stock rules.

## Measure a useful first release

Track weekly: orders by consumer/staff source and online/cash method, payment attempts/success/failures/refunds, paid orders accepted, cancelled with reasons, successfully fulfilled, time from payment confirmation to ready, and stock-related cancellations. Review customer feedback about flour freshness, rice-age accuracy and translation clarity. Do not set numerical targets before the store confirms capacity and baseline demand.

## Out of scope until later

Multi-store discovery, other cities, delivery partner app, cash on delivery/pickup, coupons, banners, loyalty, reviews, subscriptions, healthy snack production, saved addresses and advanced reports. See [Phase 2](phase-2.md) and [Gaps and roadmap](gaps.md) for sequencing and unresolved policies.
