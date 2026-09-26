# Phase 1 product journeys

This document expands the [Phase 1 specification](phase-1.md) into testable customer and staff workflows. It describes behavior, not a screen-by-screen design. The two interfaces are an Android customer app and one responsive web workspace for staff/admin.

## Customer journey

| Step | Behavior | Acceptance check |
| --- | --- | --- |
| Discover | Browse the single store's active, in-stock products by category and open product details without signing in. Show name, image, weight, selling price, and relevant grind or rice-age choices. | Inactive or unavailable variants cannot be added. A rice age is shown only for that stocked variant; flour requires a grind choice. |
| Build cart | Select a stocked weight/age, quantity and flour grind; edit or remove lines. A cart estimate shows item totals. | Two flour lines with different grind choices remain distinct. An unavailable quantity produces a clear correction before checkout. |
| Identify | Verify mobile by OTP at checkout; name is optional. | The customer cannot place an order without a verified mobile; invalid/expired OTP is rejected and retry is limited. |
| Fulfillment | Select pickup (show store address/hours) or delivery (enter recipient name, phone, address and pincode). | Delivery is offered only for an enabled pincode; pickup needs no address. An unsupported pincode cannot submit a delivery order. |
| Confirm | Server returns item prices, delivery fee and payable total; customer explicitly confirms. Payment is collected on handover. | Price or stock changes require a refreshed quote and new confirmation; duplicate submission does not create two orders. |
| Follow up | View own orders, item choices, amounts and latest status; refresh while online. | Customer can see a cancellation reason when staff cancel. Another customer's order is inaccessible. No push notification is promised. |

When offline, show an error/retry state rather than suggesting that the order succeeded. No saved addresses or offline order queue in Phase 1.

## Staff/admin journey

| Step | Behavior | Acceptance check |
| --- | --- | --- |
| Sign in | Staff/admin authenticate to the shared web workspace. | Only admin can edit catalog, prices, serviceable pincodes and staff access; staff can see orders and adjust stock. |
| Maintain catalog | Admin publishes a small active catalog with images, prices and weight variants; rice age has its own stock, flour grind is an instruction. | A variant cannot be offered without a valid nonnegative price and stock. Inactive products disappear from discovery but remain visible on past orders. |
| Receive order | Staff see new orders with phone, address if delivery, items, grind and rice-age choices, amount and payment due. | Staff can accept once; cancellation requires a reason. Stock shortages are surfaced rather than silently substituting another item. |
| Prepare and hand over | Staff mark preparing, then ready for pickup/delivery. For delivery, mark out for delivery, then delivered; for pickup, mark collected. Confirm payment collected at handover. | Invalid status transitions are rejected. Fresh flour is prepared only after acceptance; customer sees each saved change on refresh. |
| Reconcile | Staff can see today's orders and unpaid open orders; admin can review order history and cancellation reasons. | Orders cannot be completed without confirming payment. Admin can inspect the confirmed item selection and price even after a catalog change. |

## Release walk-through

1. Admin enters one flour product with two weight variants, one rice age/weight variant, stock and a supported pincode.
2. Customer checks out one flour line with medium grind for pickup, then staff accept, prepare, mark ready and collect payment at handover. Customer sees `COLLECTED`.
3. Customer checks out one rice variant for delivery in the supported pincode; staff accept, prepare, mark ready, dispatch and mark delivered with payment collected. Customer sees `DELIVERED`.
4. Try an unsupported delivery pincode, stale price, out-of-stock quantity, reused OTP, repeated submit and another customer's order ID. Each must be rejected or require explicit reconfirmation without creating an invalid order.

Order state and stock behavior are specified in [Operations and data](operations.md); business questions that affect checkout or launch are in [Gaps and roadmap](gaps.md).
