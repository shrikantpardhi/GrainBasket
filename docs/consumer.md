# Phase 1 consumer application specification

**Platform:** Android. This app follows the [Phase 1 business scope](phase-1.md); common order/payment and data rules are in [Operations](operations.md). It uses the shared backend API, not a direct database connection.

## Customer flow

| Step | Required behavior | Acceptance check |
| --- | --- | --- |
| Language | Choose English, Hindi or Marathi at first use or in settings. Persist the choice; show localized UI labels, product/category text and status labels. | All three languages allow the full checkout journey. Missing catalog translation falls back to English without hiding a product; prices and identifiers never change with language. |
| Browse | Guest can browse active flour/rice and see images, weight, price, stock availability, grind choice for flour and verified rice age for rice. | Inactive/unavailable variants cannot be ordered. A flour line requires fine/medium/coarse; different grinds remain separate cart lines. |
| Sign in | Verify mobile number by OTP at checkout; optional customer name. | Invalid, expired or reused OTP fails; retry limits apply. Guest browsing does not require login. |
| Fulfillment | Choose store pickup (show location and opening hours) or delivery (enter recipient name, phone, address and supported pincode). | Pickup needs no address. Unsupported pincode or closed ordering window blocks delivery/checkout with a clear reason. |
| Quote and pay | Cart displays estimated totals; server confirms availability, item prices, any required tax breakdown, delivery fee and payable total. Customer explicitly confirms and starts UPI or card payment through the provider. | Stale price/stock requires reconfirmation. Never collect card details in GrainBasket. Repeat taps/retries cannot create duplicate paid orders or charges. |
| Payment outcome | Show pending while awaiting server verification, then paid order number or failure/expiry with retry option. | A client-side success screen alone never marks an order paid. Failed/expired attempt does not enter the store queue; reserved stock is released. If an outcome is uncertain, show pending and let the customer check status without paying blindly again. |
| Order history | Show own paid orders with item choices, amount, payment status, current fulfillment status, cancellation reason and refund progress; refresh online. | Customer cannot view another person's order. A cancelled paid order shows refund pending/completed rather than suggesting cash was returned immediately. |

Offline browsing cache and push notifications are optional later. In Phase 1, failed connectivity shows a retry state and order status is refreshed online; never claim an order was submitted when its result is unknown.

## Release checks

Complete the full pickup and delivery journeys in each of the three languages. Test invalid OTP, unsupported delivery pincode, stale price, sold-out variant, repeated checkout, declined payment, delayed provider confirmation, cancellation/refund, and unauthorized access to another customer's order. Use the same backend prices and statuses in every language.
