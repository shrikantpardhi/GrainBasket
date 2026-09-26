GrainBasket Store Application PRD (V1.1)

Platform

- Android (Phase 1)
- Node.js Backend
- PostgreSQL
- Offline cache (SQLite/Room)

1. Login

- Username + Password.
- JWT authentication.
- Store session cached on device.

2. Backend Translation (NEW)

The app does not store text permanently.

- Downloads translations from backend ("en", "mr", "hi").
- Caches translations locally.
- Auto-syncs when translation version changes.
- Product names, descriptions, categories, banners, and notifications are translated.

3. Offline Cache

Cache locally:

- Categories
- Products
- Product translations
- Store prices
- Inventory
- Banners
- Pending orders
- Coupons

Works offline and syncs automatically when internet returns.

4. Dashboard

- New Orders
- Preparing Orders
- Ready for Pickup
- Out for Delivery
- Today's Revenue
- Low Stock Alerts

5. Order Management

Status flow:

1. New Order
2. Accepted
3. Grinding
4. Packing
5. Ready for Pickup
6. Out for Delivery
7. Delivered
8. Cancelled

Shows grind type, rice age, notes, and delivery/pickup type.

6. Fresh Preparation Module

Flour

- Fine
- Medium
- Coarse

Protein Laddus (Future)

- Freshly prepared on demand.
- Preparation status tracking.

7. Inventory & Pricing

Store can:

- Update stock.
- Update price.
- Upload store-specific product images.
- Enable/Disable products.
- Manage rice age variants.

8. Banner Management

Create/edit banners.

- Image.
- Title (translated).
- Start/End date.
- Navigate to product/category/coupon.

9. Coupons

View and enable store coupons.
Supports category-wise and store-specific coupons.

10. Notifications

- New order.
- Order cancelled.
- Low stock.
- Coupon expiry.

11. Settings

- Language (English / Marathi / Hindi).
- Change password.
- Store profile.
- Delivery settings.

---

Database Updates

New Table: "product_translations"

- product_id
- language_code
- name
- description

New Table: "translations"

- translation_key
- language_code
- translation_value

Update "store_banners"

- title_translation_key
- subtitle_translation_key

Update "categories"

- translation_key

Update "products"

- translation_key

This keeps the app lightweight, multilingual, offline-capable, and inexpensive to maintain.