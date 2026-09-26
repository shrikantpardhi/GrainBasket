# Phase 1 operations and technical design

This is the minimum shared model for the [Phase 1 business specification](phase-1.md) and its separate [consumer](consumer.md), [store](store.md) and [admin](admin.md) applications. It is a design guide, not executable SQL or a commitment to a specific framework.

## Order lifecycle

```text
Consumer/staff online: AWAITING_PAYMENT → PLACED (verified payment) / PAYMENT_FAILED (failed or expired)
Staff cash:            PLACED (cash collected and recorded at order entry)
PLACED → ACCEPTED → PREPARING → READY_FOR_PICKUP → COLLECTED
                            └→ READY_FOR_DELIVERY → OUT_FOR_DELIVERY → DELIVERED
PLACED / ACCEPTED / PREPARING / READY_* / OUT_FOR_DELIVERY → CANCELLED (staff reason required)
PLACED → CANCELLED (customer before acceptance)
```

`AWAITING_PAYMENT` and `PAYMENT_FAILED` are visible to the originating app and admin, but not actionable in the store fulfillment queue. `PLACED` requires either verified online payment or a staff-recorded cash collection at order entry. `READY_*` means either ready status, not an additional state. Pickup and delivery branches cannot be swapped after payment. Delivery assignment and handover happen outside the app. Grinding and packing are work within `PREPARING`, not extra statuses. Staff record status changes with actor and time. `PAYMENT_FAILED`, `COLLECTED`, `DELIVERED` and `CANCELLED` are terminal. Staff can cancel before handover with a reason, including when an out-for-delivery order returns undelivered; consumer-app cancellation is limited to its own `PLACED` orders. A paid cancellation starts a refund tracked separately from order status. After handover, returns/refunds follow an approved support policy. Use confirmed store hours/cutoff to reject new checkout outside the allowed window.

## Checkout and stock rules

- Each sellable weight is a variant; rice age differentiates stocked rice variants. Flour grind is a required order-item choice, with the same variant stock and price for all grinds in Phase 1. Flour availability represents grain available to mill, not premilled flour; staff must keep this quantity aligned with physical supply.
- The server validates product/variant activity, quantities, serviceable pincode, prices and delivery fee for **both** consumer and staff checkout. The cart is only an estimate. The server returns a quote that must be reconfirmed if anything changed before payment starts or cash is collected. Staff checkout records the staff actor and a contact/address snapshot; it does not require a consumer account or silently attach an unverified phone number to one.
- Pending payment temporarily reserves stock with an expiry. Order creation and reservation occur atomically; concurrent checkouts cannot drive stock below zero. Release reservation on failed/expired payment. On cancellation return stock only if it is still sellable; after preparation, staff reconcile stock manually. Staff stock adjustments must not consume stock already reserved for orders.
- Store the product name, weight, rice age, flour grind, quantity, unit price, line total, delivery fee and final total on the order. Past orders must not depend on current catalog values. Store the delivery address on each delivery order; pickup has none.
- Money uses decimal amounts in INR with explicit rounding rules and server-calculated totals. Show any legally required tax detail according to the confirmed tax policy; never infer a tax rate from product category alone.
- Use one idempotency key per checkout submission. A retry must return the existing order/payment state rather than creating another charge or cash receipt. Staff must confirm the server saved a cash order before re-entering it after connectivity failure; check the server/provider outcome before retrying an online payment. An order number appears only after persistence.

## Payment and refunds

- Consumer or store staff starts UPI or card payment for the customer after confirming the server quote. The backend creates a payment attempt for the exact amount and INR currency; the customer uses provider-hosted checkout or an approved payment link/QR, without entering card details in the store app. Choose the gateway during implementation; no provider is committed by this specification. Neither app can mark an online payment `PAID`.
- Staff may instead collect cash **when entering the order**. The backend atomically records the order, exact cash amount, staff actor and collection time as `PAID`, then marks it `PLACED`. Cash collection is a staff attestation, subject to admin reconciliation; it is not a provider-verified transaction. Consumer-app checkout does not offer cash. No unpaid cash order enters the queue, and cash on pickup/delivery is not part of Phase 1.
- Verify provider webhook authenticity, provider transaction reference, amount, currency and order association on the backend. Apply each callback once, including duplicate or out-of-order delivery. A verified success changes the order to `PLACED` and exposes it to store staff; a failed/expired attempt changes it to `PAYMENT_FAILED` and releases reserved stock.
- A late payment success after reservation expiry needs a recorded refund/reconciliation path; it must not silently create an unfulfillable order. A customer retry after failure starts a new quote and attempt only after the previous outcome is known. Admin can inspect uncertain payments; the consumer sees `pending`, `paid` or `failed` based on backend state.
- Cancelling a paid order sets refund status `REFUND_PENDING`. For online payment, initiate a provider refund once and record its result. For cash, admin records the manual return of money with amount, actor and time. Surface `REFUNDED` only after provider confirmation or manual cash refund confirmation, otherwise show a failure/pending action for admin. Never treat cancellation as proof that money was returned. Admin and store see refund state; consumer-app customers see the same state for their orders.
- Tax/receipt format, payment provider, fees and refund timing require business confirmation before launch. Do not store card data or provider credentials in application tables or logs.

## Minimal records

| Record | Required fields or relationships |
| --- | --- |
| Store | Name, address, contact, operating hours, enabled delivery pincodes, flat delivery charge, active status. One store in Phase 1. |
| Customer | ID, verified mobile, optional name. |
| Staff account | ID, store, role (`ADMIN` or `STAFF`), password hash, active status. |
| Product/category | English product name/description, category, image reference, flour/rice type, active status. Only verified claims displayed. |
| Sellable variant | Product, weight/unit, rice age if applicable, selling price, available stock, active status. Unique combination of product, weight and rice age. |
| Catalog translation | Product/category reference, language code (`en`, `hi`, `mr`), translated name/description. English fallback for missing display content. |
| UI translation | Key, language code, translated text and version for the three apps; bundled English fallback if translation API is unavailable. UI keys are maintained with releases, not edited as arbitrary admin content. |
| Order | Optional verified customer reference (consumer orders only), source (`CONSUMER`/`STORE`), creating staff actor for store orders, customer contact snapshot, store, order number, pickup/delivery type, address snapshot if delivery, status, item subtotal, delivery charge, total, timestamps, cancellation reason when applicable, checkout idempotency key. |
| Order item | Order, product and variant references, name/weight/age and translated-name snapshots at purchase, grind choice for flour, quantity, unit price and line total. |
| Payment | Order, method (`CASH`/`UPI`/`CARD`), exact amount/currency and `PENDING`/`PAID`/`FAILED` status. Online attempts have provider/reference, idempotency key and expiry; the single cash collection has staff actor and collection time. Refund state/reference or manual cash refund actor/time belongs to the paid payment. |
| Status event | Order, from/to status, actor, time; provides a simple audit trail and customer history. |

Restrict personal data access by role and ownership. Each app calls the **same backend APIs**, which own this single PostgreSQL database; no app queries the database directly. Snapshot names/prices/choices on orders so edits or translations do not rewrite history. No courier, coupon, banner, loyalty, review, wishlist or address-book tables are required for Phase 1.

## Deployment and security baseline

- One API serving the consumer Android app, store Android app and admin web panel, with one PostgreSQL database on a private network. `PRD-v1.0.md` proposes Java/Spring while the app PRDs propose Node.js. Pick **one** before implementation; Node.js is a working assumption, not an approved choice.
- Expose only the public API/web entrypoint over HTTPS. A reverse proxy can terminate TLS, route web/API traffic and enforce request-size limits where needed; keep the backend and database unreachable from the public internet. Do not add a proxy solely to introduce another service if the host already provides these controls.
- Phone OTP must use an approved provider, short expiry and request/verification limits; do not log codes. Staff/admin passwords are hashed, sessions are revocable, and role/store permissions are checked on the server. Admin web sessions use secure, HttpOnly cookies with appropriate SameSite and CSRF protection; Android credentials use secure device storage and short-lived server-issued tokens.
- Validate and authorize every order read/write; never trust client totals, statuses, online payment outcomes or role claims. Limit cash-paid order creation to authenticated staff, record their identity, and reconcile cash receipts and refunds. Verify provider callbacks server-side, limit login and checkout abuse, use parameterized database access, store secrets outside source control and avoid phone/address details in application logs.
- Back up the database, test restoration, and restrict operator access before launch. Retention/deletion policy for customer contact and addresses must be settled with the business. If product images are uploaded, validate file type/size and serve from controlled storage rather than an executable directory.

Interfaces can stay small: catalog/translations; OTP/session; consumer and staff quote/checkout; payment attempt and verified callback or staff cash collection; customer order list/details; staff order entry/list/transition; admin catalog/stock/store/refund settings. Define exact endpoints and migration scripts when implementation begins, after the [open decisions](gaps.md) are resolved.
