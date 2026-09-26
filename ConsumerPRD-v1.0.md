### GrainBasket — Consumer Application PRD (V1.0)

Designed for Android (Jetpack Compose) first, with iOS support later using a shared backend (Node.js + PostgreSQL).

# GrainBasket Consumer Application PRD (V1.0)

## Vision

A fast, multilingual healthy grocery app for fresh flour, rice, grains, dry fruits, and future healthy products with Home Delivery and Store Pickup.

---

## Platform

- Android: Jetpack Compose.
- iOS: Future support with the same backend APIs.
- Backend: Node.js.
- Database: PostgreSQL.

---

## Authentication

### Mandatory
- Mobile Number (OTP verification).

### Optional Sign-In
- Google Sign-In.
- Apple Sign-In (required when iOS launches).
- Email can be linked to the account.

**Rule:** Every account must have a verified mobile number, even if the user signs in with Google or Apple.

---

## Multilingual Support

Languages in Phase 1:
- English (`en`)
- Marathi (`mr`)
- Hindi (`hi`)

All translations come from the backend and are cached on the device.

---

## Onboarding

- Choose Language.
- Enter Mobile Number.
- OTP Verification.
- Name and Email (optional).
- Allow Location (optional but recommended).

---

## Home Screen

1. Location selector (Nearby / Pincode / Area / City).
2. Search bar.
3. Store promotional banners (clickable).
4. Coupons & offers.
5. Categories.
6. Freshly Milled Today.
7. Organic Collection.
8. Best Selling Products.

---

## Product Details

Every product supports:
- Multiple images.
- Name and description (translated).
- Weight variants.
- Organic/Healthy tags.
- Rice age.
- Grind type (Fine/Medium/Coarse where applicable).
- Nutrition information.
- Store-specific price.

---

## Store Discovery

Customers can find stores by:
- Current location.
- Nearby stores.
- Pincode.
- Area/Locality.
- City search.

---

## Shopping Cart

- Add/update quantity.
- Apply coupon.
- Delivery or Store Pickup.
- Show complete bill before payment.

---

## Checkout

- Saved addresses.
- Delivery instructions.
- Payment methods (UPI, Card, COD).
- Order summary and invoice.

---

## Order Tracking

Statuses:
- Order Placed.
- Accepted.
- Grinding/Preparing.
- Packed.
- Out for Delivery.
- Ready for Pickup.
- Delivered.

---

## Profile

- Personal details.
- Mobile (mandatory).
- Linked Google/Apple account.
- Saved addresses.
- Order history.
- Language selection.
- Wishlist (Phase 2).

---

## Offline & Caching

Cache locally:
- Categories.
- Products.
- Translations.
- Banners.
- Last viewed products.
- Cart.

Sync automatically when internet is available.

---

## Future Phase 2

- Wishlist.
- Reorder.
- Loyalty points.
- Monthly subscriptions.
- Reviews & Ratings.
- Voice search (English/Marathi/Hindi).

### Consumer App Principles

* Fast on low-end Android phones.

* Minimal internet usage through backend-driven translations and local caching.

* Same APIs will support Android Compose now and iOS later without backend changes.
