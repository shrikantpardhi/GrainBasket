# Phase 1 operations and technical design

This is the minimum model needed to fulfill the [Phase 1 business specification](phase-1.md). It is a design guide, not executable SQL or a commitment to a specific framework.

## Order lifecycle

```text
PLACED → ACCEPTED → PREPARING → READY_FOR_PICKUP → COLLECTED
                            └→ READY_FOR_DELIVERY → OUT_FOR_DELIVERY → DELIVERED
PLACED / ACCEPTED / PREPARING / READY_* / OUT_FOR_DELIVERY → CANCELLED (staff reason required)
PLACED → CANCELLED (customer before acceptance)
```

`READY_*` means either ready status, not an additional state. Pickup and delivery branches cannot be swapped after confirmation. Delivery assignment and handover happen outside the app. Grinding and packing are work within `PREPARING`, not extra statuses. Staff record status changes with actor and time. `COLLECTED`, `DELIVERED` and `CANCELLED` are terminal; after handover, returns/refunds require a manual process until policy is defined. Staff can cancel before handover with a reason, including when an out-for-delivery order returns undelivered; customer cancellation is limited to `PLACED`. Use confirmed store hours/cutoff to reject new checkout outside the allowed window rather than silently promising immediate fulfillment.

## Checkout and stock rules

- Each sellable weight is a variant; rice age differentiates stocked rice variants. Flour grind is a required order-item choice, with the same variant stock and price for all grinds in Phase 1. Flour availability represents grain available to mill, not premilled flour; staff must keep this quantity aligned with physical supply.
- The server validates product/variant activity, quantities, serviceable pincode, prices and delivery fee. The cart is only an estimate. The server returns a quote that must be confirmed if anything changed.
- Order creation and stock reservation occur atomically; concurrent checkouts cannot drive stock below zero. Return stock on cancellation only if it is still sellable; after preparation, staff reconcile stock manually. Staff stock adjustments must not consume stock already reserved for orders.
- Store the product name, weight, rice age, flour grind, quantity, unit price, line total, delivery fee and final total on the order. Past orders must not depend on current catalog values. Store the delivery address on each delivery order; pickup has none.
- Money uses decimal amounts in INR with explicit rounding rules and server-calculated totals. Show any legally required tax detail according to the confirmed tax policy; never infer a tax rate from product category alone.
- Create each order at most once per customer submission (idempotency key or equivalent). If OTP, network or checkout fails, show the failure without assuming an order exists; an order number appears only after persistence.
- `UNPAID` at placement and `PAID` after staff confirm cash collection. Handover cannot be marked `COLLECTED` or `DELIVERED` until payment is confirmed; unpaid orders remain open for staff to reconcile or cancel. Do not claim a card/UPI transaction occurred.

## Minimal records

| Record | Required fields or relationships |
| --- | --- |
| Store | Name, address, contact, operating hours, enabled delivery pincodes, flat delivery charge, active status. One store in Phase 1. |
| Customer | ID, verified mobile, optional name. |
| Staff account | ID, store, role (`ADMIN` or `STAFF`), password hash, active status. |
| Product/category | Product name, description, category, image reference, flour/rice/other type, active status. Only verified claims displayed. |
| Sellable variant | Product, weight/unit, rice age if applicable, selling price, available stock, active status. Unique combination of product, weight and rice age. |
| Order | Customer, store, order number, pickup/delivery type, address snapshot if delivery, status, payment status, item subtotal, delivery charge, total, timestamps, cancellation reason when applicable, submission idempotency key. |
| Order item | Order, product and variant references, name/weight/age snapshot, grind choice for flour, quantity, unit price and line total. |
| Status event | Order, from/to status, actor, time; provides a simple audit trail and customer history. |

Restrict personal data access by role and ownership. Use reference IDs for catalog relationships, but retain snapshots when catalog content changes. No payments, courier, translation, coupon, banner, loyalty, review, wishlist or address-book tables are required for Phase 1.

## Deployment and security baseline

- One API serving Android and the staff/admin web workspace, with PostgreSQL on a private network. A single backend is enough; `PRD-v1.0.md` proposes Java/Spring while the app PRDs propose Node.js. Pick **one** before implementation; Node.js is a working assumption, not an approved choice.
- Expose only the public API/web entrypoint over HTTPS. A reverse proxy can terminate TLS, route web/API traffic and enforce request-size limits where needed; keep the backend and database unreachable from the public internet. Do not add a proxy solely to introduce another service if the host already provides these controls.
- Phone OTP must use an approved provider, short expiry and request/verification limits; do not log codes. Staff passwords are hashed, staff sessions are revocable, and admin/staff permissions are checked on the server. Web sessions use secure, HttpOnly cookies with appropriate SameSite and CSRF protection; mobile credentials use secure device storage and short-lived server-issued tokens.
- Validate and authorize every order read/write; never trust client totals, statuses or role claims. Limit login and checkout abuse, use parameterized database access, store secrets outside source control and avoid phone/address details in application logs.
- Back up the database, test restoration, and restrict operator access before launch. Retention/deletion policy for customer contact and addresses must be settled with the business. If product images are uploaded, validate file type/size and serve from controlled storage rather than an executable directory.

Interfaces can stay small: catalog and availability; OTP/session; quote and submit order; customer order list/details; staff order list/transition; admin catalog/stock/store settings. Define exact endpoints and migration scripts when implementation begins, after the [open decisions](gaps.md) are resolved.
