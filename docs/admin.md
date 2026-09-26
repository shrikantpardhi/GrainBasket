# Phase 1 admin application specification

**Platform:** React web panel for the one Nagpur store. It is separate from the [store Android app](store.md), uses the same Node.js backend and PostgreSQL database as the [consumer app](consumer.md), and never exposes database credentials in the browser.

## Admin flow

| Step | Required behavior | Acceptance check |
| --- | --- | --- |
| Access and language | Sign in as an active admin; choose English, Hindi or Marathi for the panel. | Staff credentials cannot enter admin functions. All essential settings and order/refund actions are usable in each language. |
| Store setup | Set store name, address/contact, local opening and closing times for each day (including weekly closed days), order cutoff, available pickup times and a simple preparation lead time, serviceable delivery pincodes and flat delivery fee; activate/deactivate ordering for temporary closure. | Show opening/closing times in the customer and store apps. Reject checkout when ordering is closed or past cutoff; offer flour pickup only during open hours and with enough preparation lead time. |
| Catalog | Manage flour/rice categories, product images, weight variants, rice age, price, initial stock and active status. Enter and review product/category names and descriptions for all three languages. | An active product has valid nonnegative price/stock and required translations or an explicitly approved English fallback. Claims about age/organic/nutrition require store evidence before publication. Historic order snapshots do not change on edits. |
| Staff | Create/deactivate staff accounts and assign the store role; reset access when needed. | Only admin can change account roles or store settings; deactivated staff lose access. |
| Orders and payments | View consumer and staff-created orders, their source and staff actor, cash collections and provider payment status. Inspect cancellation reasons and refund status. Reconcile provider refunds and record cash refunds per the approved policy. | Never infer online payment from the browser callback. Repeat refund requests do not refund twice; outstanding refunds remain visible. Admin can distinguish collected cash from verified online payment. |
| Rewards and consent | Configure the approved earning rate, minimum points for redemption, point value and redemption limit. Review points earned/used/restored against orders and recorded marketing choices; correct an error only with a reason and audit entry. | Completed orders earn points once; failed/cancelled orders do not. Redemption never uses an unverified mobile or exceeds the server-confirmed balance. Marketing opt-out does not affect rewards. |
| Basic review | Review order counts, cash collected, online payment failures/refunds, cancellations and stock corrections for the single store. | Counts distinguish payment attempts from placed orders and cash from online; no cross-store dashboard is needed. |

Admin cannot directly edit confirmed order totals or mark provider payments successful. Customer data is shown only where needed for support and fulfillment. [Operations](operations.md) defines the shared security and storage rules.

## Release checks

Create a flour variant and a rice-age variant with three-language content, configure the store, create/deactivate staff, and verify both Android apps receive the resulting catalog and access changes. Reconcile a staff-created cash order and an online payment. Confirm cancellation triggers the right cash or provider refund workflow and returns redeemed points once. Verify reward settings and an optional marketing opt-out in all three languages.
