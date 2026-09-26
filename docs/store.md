# Phase 1 store application specification

**Platform:** Android for the one Nagpur store. This is a separate staff app using the same authorized backend and database as the [consumer](consumer.md) and [admin](admin.md) apps; staff never connect to PostgreSQL directly.

## Staff flow

| Step | Required behavior | Acceptance check |
| --- | --- | --- |
| Access and language | Sign in with an admin-created staff account; choose English, Hindi or Marathi. | Only active staff for this store can enter. All order actions and status labels work in each language; changing language does not change saved order values. |
| Queue | Refresh and see consumer orders with verified online payment and staff-created orders with verified online payment or cash collected at entry. Show order number, source, time, fulfillment type, contact, address where applicable, item choices and amount paid. | Unverified online payments and unpaid cash orders never appear as actionable orders. Staff see only their store's orders. No offline status changes are queued. |
| Place order for a customer | Staff can build an order in the store app without the consumer app: select flour/rice variants, grind if flour, quantity, pickup/delivery and customer name/phone; collect a delivery address if needed. Server confirms stock, fees and total before staff submit. | No customer app account or OTP is required for staff entry. Staff identity and customer contact snapshot are recorded; an unverified phone number is never silently linked to an existing customer account. Unsupported pincodes and stale price/stock block submission. |
| Take payment | Staff select cash or online for their entered order. For cash, **collect it before submitting** and record staff actor and amount in the same server operation as order creation. For online payment, provide a provider-hosted customer payment flow without entering card details in the store app. | Staff cannot set an online transaction to `PAID`; only backend verification can. No cash order is placed without staff confirming collection. A repeat submit cannot create duplicate charges/orders. Cash collections and manual refunds are visible to admin for reconciliation. |
| Pending online orders | Show staff-entered online orders awaiting verification separately from the fulfillment queue, with their payment expiry/failure state. | Staff can check the server outcome after an uncertain connection without creating a second order or assuming the customer's payment succeeded. |
| Accept or cancel | Accept a new order, or cancel a paid order before handover with a reason. Consumer-app customers see the status on refresh; staff contact customers whose orders they entered themselves. | Duplicate/invalid transitions are rejected by the server. Cancelling a paid order initiates the tracked refund workflow; prepared stock is not automatically returned as sellable. |
| Prepare | Start preparing, mill flour only after acceptance, pack, then mark ready for pickup or ready for delivery. | Grind and rice-age selection remain visible while preparing. Each update records staff actor/time and appears in the consumer order on refresh where applicable. |
| Handover | For pickup mark collected; for delivery mark out for delivery and then delivered. Delivery coordination happens outside the app. | Cannot finish the wrong fulfillment branch, hand over a cancelled order or mark an unpaid order completed. Failed delivery is resolved by staff cancellation with reason and refund review. |
| Stock | View and adjust available stock of sellable flour weights and rice age/weight variants; give a reason for a manual correction. | Stock never goes below zero or consumes stock reserved for paid orders; only admin changes catalog/price/translation. |

The store app needs online access for changes. If the network fails, show the last confirmed state and ask staff to retry or refresh rather than assuming a transition succeeded. [Operations](operations.md) defines the shared state machine and payment/refund handling.

## Release checks

In each language, staff receive a verified paid flour order, accept, prepare, mark ready and complete pickup; repeat for rice delivery. Place a walk-in cash order and a staff-entered online order without the consumer app, checking the server total, payment recording and duplicate-submit handling. Check cancellation/refund visibility, invalid transition, manual stock correction, failed network write and attempted access to an order outside the assigned store.
