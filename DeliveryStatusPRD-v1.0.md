Store App — Delivery Status Management (Phase 1)

Store staff can update the complete lifecycle of an order.

Order Status Flow

1. New Order
2. Accepted
3. Preparing
4. Grinding (for fresh flour)
5. Packing
6. Ready for Pickup / Ready for Delivery
7. Out for Delivery
8. Delivered
9. Cancelled

Store Actions

- Accept or reject order.
- Start grinding/preparation.
- Mark packing completed.
- Mark Ready for Pickup.
- Mark Out for Delivery.
- Mark Delivered.
- Add cancellation reason (if cancelled).

Consumer App Updates

Customers receive live notifications whenever the store changes the status.

Examples:

- "Your flour is being freshly milled."
- "Your order is packed."
- "Your order is out for delivery."
- "Your order has been delivered."

Database Update

orders table additions:

Column| Type| Purpose
accepted_at| TIMESTAMP| Order accepted time
preparing_at| TIMESTAMP| Preparation started
packed_at| TIMESTAMP| Packing completed
out_for_delivery_at| TIMESTAMP| Delivery started
delivered_at| TIMESTAMP| Delivery completed
cancelled_reason| TEXT| Cancellation reason

This keeps delivery tracking simple in Phase 1 without requiring a separate delivery partner app.