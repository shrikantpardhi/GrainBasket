# Phase 1 business specification

**Status:** Final Phase 1 scope baseline confirmed by the product owner: one Nagpur store, three applications, English/Hindi/Marathi, flour and rice, UPI/card payments, staff-entered cash/online orders, flour pickup timing, and points earned on completed purchases with a minimum balance for redemption. Operating values, reward settings and gateway selection must be settled before launch as listed in [Gaps and roadmap](gaps.md).

## Why this exists

Customers buying staples may not know when flour was milled or how old rice is. GrainBasket's promise is freshly milled flour prepared after an order, with a choice of fine, medium or coarse grind, and rice whose age is clearly identified. Start with a single Nagpur store to prove that customers can order and staff can fulfill this promise reliably.

## Phase 1 in one sentence

A customer can order flour or rice from the single Nagpur store in English, Hindi or Marathi, choose delivery to a supported pincode or pickup, pay online by UPI or card, and follow fulfillment in the consumer app. Staff can also enter an order in the store app without the consumer app, collecting cash at entry or having the customer pay online. Admin manages the store in a separate panel. All three applications use one backend and database.

## Scope

| Include in first release | Boundary |
| --- | --- |
| One Nagpur store with flour and rice | No other categories, store search, multi-store pricing or store-specific campaigns. Admin configures opening/closing times per day, weekly closed days and order cutoff; no fixed schedule is specified here. Show the configured schedule to customers and staff, alongside supported delivery pincodes and delivery charge. |
| Flour weight and grind choice; rice weight and age where verified by the store | Grind texture is an order-item choice, not a stocked SKU. For flour pickup, choose grinding in front of the customer (about 30 minutes after arrival) or have it ready for a chosen pickup time. Rice age is a stocked variant. Do not label a product organic, gluten-free or with a specific rice age without evidence. |
| Separate consumer and store Android apps using Kotlin/Jetpack Compose, plus a React admin web panel | One Node.js backend and PostgreSQL database. Customer phone OTP; staff/admin protected accounts. Each app supports English, Hindi and Marathi. No social login, wishlist or extensive offline order sync. |
| Pickup at the store or delivery within configured pincodes; delivery address entered at checkout | No automatic nearby-store selection, GPS radius calculations, saved addresses or rider dispatch. Store staff coordinate delivery outside the app. |
| Consumer checkout uses UPI or card; store-entered checkout uses cash collected at entry or UPI/card | Final total appears before payment. Only provider-verified online or staff-confirmed cash orders enter the store queue. Failed/expired online attempts release stock; cancellation after payment requires a tracked provider or cash refund. Choose the payment gateway during implementation. |
| Name/mobile, optional marketing consent and purchase rewards | Require customer name and mobile number for either checkout. Earn points once on completed purchases and allow redemption only when the confirmed minimum balance is reached. Staff can enter orders without the consumer app or a rewards account; spending points requires phone verification. Marketing permission is separate and optional. Earning rate, minimum, point value and refund policy need business approval before launch. |
| Shared backend and PostgreSQL database | Consumer, store and admin apps access shared data through authorized APIs, never by direct database connections. No coupons, banners, loyalty tiers or analytics dashboard in Phase 1. |

The application responsibilities and acceptance checks are in [Consumer](consumer.md), [Store](store.md) and [Admin](admin.md). Shared order, payment, language and data rules are in [Operations and data](operations.md).

## Order and fulfillment promise

1. Customer browses flour/rice, selects a weight and grind or rice age, selects pickup or an eligible delivery address, supplies a name, verifies a mobile number, confirms the server total (including any eligible points redemption) and starts UPI/card payment in the consumer app.
2. Alternatively, staff enter a pickup or delivery order in the store app with the customer's name/mobile, without requiring a customer account. They confirm the backend total, collect cash when entering the order or start customer UPI/card payment. Points redemption requires phone verification in the store app, not installation of the consumer app.
3. Online payment must be verified by the backend; staff-recorded cash collection is auditable. Only paid orders enter the store queue. For flour pickup, the order records either grind in front of the customer or a requested ready time. Staff accept or cancel, mill flour **after** acceptance (and after customer arrival for in-front grinding), prepare and pack, then mark ready for pickup or delivery. The store queue and consumer order show the relevant target and updated estimate; 30 minutes is an estimate, not a guaranteed completion time.
4. Staff mark pickup collected or delivery out for delivery and delivered. A completed purchase earns points once for a verified customer; unverified staff-entered orders can claim points after phone verification. Consumer-app customers see order and points status in their chosen language; staff-entered customers use the store contact channel. Paid cancellations show a tracked provider refund or cash refund record.

See the three application specifications for acceptance checks and [Operations and data](operations.md) for status, payment and stock rules.

## Measure a useful first release

Track weekly: orders by consumer/staff source and online/cash method, payment attempts/success/failures/refunds, paid orders accepted, cancelled with reasons, successfully fulfilled, points earned/redeemed, promised versus actual flour ready times, and stock-related cancellations. Review customer feedback about flour freshness, rice-age accuracy and translation clarity. Do not set numerical targets before the store confirms capacity and baseline demand.

## Out of scope until later

Multi-store discovery, other cities, delivery partner app, cash on delivery/pickup, coupons, banners, loyalty tiers, reviews, subscriptions, healthy snack production, saved addresses and advanced reports. See [Phase 2](phase-2.md) and [Gaps and roadmap](gaps.md) for sequencing and unresolved policies.
