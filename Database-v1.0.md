GrainBasket — Complete Database Schema (V1.0)

Database Overview

Supports:

- Consumer App
- Store App
- Admin Panel
- Home Delivery
- Store Pickup
- Multi-Store Architecture
- Store-specific pricing, images, banners, coupons
- Fresh milling & rice age
- Future subscriptions and loyalty

---

1. USERS

Column| Type| Notes
id| UUID| Primary Key
full_name| VARCHAR(150)| Customer name
mobile_number| VARCHAR(15)| Mandatory, Unique
email| VARCHAR(150)| Optional
status| BOOLEAN| Active / Inactive
created_at| TIMESTAMP| Registration date
updated_at| TIMESTAMP| Last update

---

2. USER_ADDRESSES (Phase 2)

Column| Type
id| UUID
user_id| UUID (FK Users)
address_type| HOME / WORK / OTHER
house_no| VARCHAR
street| VARCHAR
landmark| VARCHAR
area| VARCHAR
city| VARCHAR
state| VARCHAR
pincode| VARCHAR
latitude| DECIMAL
longitude| DECIMAL
is_default| BOOLEAN

---

3. STORES

Column| Type
id| UUID
store_name| VARCHAR
username| VARCHAR UNIQUE
password_hash| TEXT
phone| VARCHAR
email| VARCHAR
address| TEXT
city| VARCHAR
area| VARCHAR
state| VARCHAR
pincode| VARCHAR
latitude| DECIMAL
longitude| DECIMAL
delivery_radius_km| DECIMAL
delivery_charge| DECIMAL
free_delivery_above| DECIMAL
minimum_order_amount| DECIMAL
active| BOOLEAN
created_at| TIMESTAMP

---

4. ADMINS

Column| Type
id| UUID
username| VARCHAR UNIQUE
password_hash| TEXT
role| SUPER_ADMIN / ADMIN
active| BOOLEAN

---

5. CATEGORIES

Column| Type
id| UUID
name| VARCHAR
description| TEXT
image_url| TEXT
display_order| INT
active| BOOLEAN

Examples:

- Flour
- Rice
- Millets
- Pulses
- Dry Fruits
- Healthy Snacks
- Protein Foods

---

6. PRODUCTS

Column| Type
id| UUID
category_id| UUID
name| VARCHAR
description| TEXT
brand| VARCHAR
hsn_code| VARCHAR
is_on_demand| BOOLEAN
active| BOOLEAN
created_at| TIMESTAMP

---

7. PRODUCT_IMAGES

Column| Type
id| UUID
product_id| UUID
image_url| TEXT
display_order| INT

Default images.

---

8. STORE_PRODUCTS

Store specific inventory and pricing.

Column| Type
id| UUID
store_id| UUID
product_id| UUID
selling_price| DECIMAL
mrp| DECIMAL
stock_quantity| DECIMAL
stock_unit| KG / GM / PCS
active| BOOLEAN
created_at| TIMESTAMP

---

9. STORE_PRODUCT_IMAGES

Override product images for each store.

Column| Type
id| UUID
store_product_id| UUID
image_url| TEXT
display_order| INT

---

10. PRODUCT_VARIANTS

Column| Type
id| UUID
store_product_id| UUID
weight| VARCHAR
grind_type| FINE / MEDIUM / COARSE
rice_age| NEW / 6_MONTHS / 1_YEAR / 2_YEAR / 3_YEAR_PLUS
organic| BOOLEAN
price| DECIMAL
stock_quantity| DECIMAL
active| BOOLEAN

Supports:

- Flour grind selection.
- Rice aging.
- Different weights.

---

11. TAGS

Column| Type
id| UUID
name| VARCHAR
description| TEXT
icon| TEXT

Examples:

- Organic
- High Protein
- Farm Fresh
- Gluten Free
- Stone Ground
- Cold Pressed

---

12. PRODUCT_TAGS

Column| Type
product_id| UUID
tag_id| UUID

Many-to-many relationship.

---

13. COUPONS

Column| Type
id| UUID
code| VARCHAR UNIQUE
title| VARCHAR
description| TEXT
discount_type| FLAT / PERCENT
discount_value| DECIMAL
minimum_order_amount| DECIMAL
maximum_discount| DECIMAL
usage_limit| INT
start_date| TIMESTAMP
expiry_date| TIMESTAMP
active| BOOLEAN

---

14. COUPON_CATEGORIES

Coupon valid only for selected categories.

Column| Type
coupon_id| UUID
category_id| UUID

---

15. STORE_COUPONS

Coupon valid only for selected stores.

Column| Type
coupon_id| UUID
store_id| UUID

---

16. STORE_BANNERS

Column| Type
id| UUID
store_id| UUID
title| VARCHAR
subtitle| VARCHAR
image_url| TEXT
navigation_type| CATEGORY / PRODUCT / COUPON / URL
navigation_value| VARCHAR
start_date| TIMESTAMP
end_date| TIMESTAMP
display_order| INT
active| BOOLEAN

---

17. ORDERS

Column| Type
id| UUID
order_number| VARCHAR
user_id| UUID
store_id| UUID
address_id| UUID
delivery_type| HOME_DELIVERY / STORE_PICKUP
coupon_id| UUID
subtotal| DECIMAL
discount_amount| DECIMAL
delivery_charge| DECIMAL
tax_amount| DECIMAL
total_amount| DECIMAL
payment_status| PENDING / PAID / FAILED
order_status| PLACED / ACCEPTED / PREPARING / READY / OUT_FOR_DELIVERY / DELIVERED / CANCELLED
created_at| TIMESTAMP

---

18. ORDER_ITEMS

Column| Type
id| UUID
order_id| UUID
product_variant_id| UUID
quantity| DECIMAL
unit_price| DECIMAL
total_price| DECIMAL
grind_type| VARCHAR
rice_age| VARCHAR

Stores customer selection.

---

19. PAYMENTS (Phase 2)

Column| Type
id| UUID
order_id| UUID
payment_method| UPI / CARD / COD / WALLET
transaction_id| VARCHAR
payment_status| SUCCESS / FAILED / PENDING
amount| DECIMAL
paid_at| TIMESTAMP

---

20. DELIVERY_PARTNERS (Phase 2)

Column| Type
id| UUID
store_id| UUID
name| VARCHAR
mobile_number| VARCHAR
vehicle_type| BIKE / CYCLE / CAR
active| BOOLEAN

---

21. ORDER_DELIVERY (Phase 2)

Column| Type
id| UUID
order_id| UUID
delivery_partner_id| UUID
assigned_at| TIMESTAMP
picked_up_at| TIMESTAMP
delivered_at| TIMESTAMP
delivery_status| ASSIGNED / PICKED_UP / DELIVERED

---

22. WISHLIST (Phase 2)

Column| Type
user_id| UUID
product_id| UUID
created_at| TIMESTAMP

---

23. PRODUCT_REVIEWS (Phase 2)

Column| Type
id| UUID
product_id| UUID
user_id| UUID
rating| INT
review| TEXT
created_at| TIMESTAMP

---

24. LOYALTY_TRANSACTIONS (Phase 2)

Column| Type
id| UUID
user_id| UUID
order_id| UUID
points_earned| INT
points_redeemed| INT
balance_points| INT
created_at| TIMESTAMP

---

25. SUBSCRIPTIONS (Phase 2)

Column| Type
id| UUID
user_id| UUID
store_id| UUID
product_variant_id| UUID
quantity| DECIMAL
frequency| WEEKLY / MONTHLY
next_delivery_date| DATE
active| BOOLEAN

---

26. STORE_OFFERS (Phase 2)

Column| Type
id| UUID
store_id| UUID
title| VARCHAR
description| TEXT
discount_type| FLAT / PERCENT
discount_value| DECIMAL
start_date| TIMESTAMP
end_date| TIMESTAMP
active| BOOLEAN

---

Entity Relationships

Users → Orders

Users → Addresses

Stores → Store Products

Products → Categories

Store Products → Product Variants

Products → Product Images

Store Products → Store Product Images

Products ↔ Tags

Coupons ↔ Categories

Coupons ↔ Stores

Orders → Order Items

Orders → Payments

Stores → Banners

Orders → Delivery Partners

---

Stage 1 Features Covered

- Consumer Login (Mobile Mandatory)
- Store Login
- Admin Login
- Multi-Store Ready
- Store Pricing
- Store Delivery Charges
- Store Pickup
- Home Delivery
- Category Coupons
- Store Coupons
- Product Images
- Store Product Images
- Promotional Banners
- Rice Age
- Flour Grind Type
- Organic & Healthy Tags
- GST Ready Billing

This schema is designed to scale from 1 store in Nagpur to hundreds of stores across India without redesigning the database.