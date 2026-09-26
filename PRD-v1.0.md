🌾 GrainBasket — Business PRD (Version 1.0)

Tagline: Freshly Made. Healthy Every Day.

Vision

GrainBasket is a healthy-food e-commerce platform focused on fresh, authentic, and minimally processed food.

Start with one local store and expand into a multi-store platform across cities.

Customers can choose:

- Home Delivery
- Store Pickup (Click & Collect)

---

Business Problem

People often receive:

- Old packaged flour.
- Rice without knowing its age.
- Dry fruits and healthy products with uncertain quality.

GrainBasket solves this by providing freshly prepared products on demand.

---

Unique Selling Proposition (USP)

Freshly Milled Flour on Demand

Customers choose:

- Fine Grind
- Medium Grind
- Coarse Grind

Flour is milled only after the order is placed.

Fresh Protein Laddus on Demand

Future healthy products are prepared fresh after ordering.

Rice Intelligence

Rice includes age information.

Examples:

- New Crop
- 6 Months
- 1 Year Aged
- 2 Year Aged
- 3+ Years Aged

Customers can buy rice based on cooking preference.

---

Product Categories

Phase 1

- Wheat Flour
- Rice
- Millets
- Pulses
- Dry Fruits

Phase 2

- Protein Laddus
- Healthy Snacks
- Seeds
- Superfoods
- Cold Pressed Oils

---

Product Features

Each product supports:

- Multiple Photos
- Store-specific Photos
- Description
- Weight Variants
- Organic Tags
- Nutrition Information
- On-Demand Preparation
- Stock Availability
- Price per Store

---

Healthy Tags

Examples:

- Organic
- Farm Fresh
- High Protein
- Gluten Free
- Stone Ground
- No Preservatives
- Cold Pressed

Products can have multiple tags.

---

Applications

1. Consumer App

Login:

- Mobile Number (Mandatory)
- Email (Optional)

Features:

- Browse products.
- Search stores.
- Cart.
- Coupons.
- Home Delivery.
- Store Pickup.
- Order History.
- Wishlist (Phase 2).

2. Store App

Login:

- Username
- Password

Features:

- Orders.
- Inventory.
- Product Pricing.
- Grinding Requests.
- Store Banners.
- Coupons.

3. Admin Panel

Login:

- Username
- Password

Features:

- Manage Stores.
- Manage Products.
- Manage Categories.
- Tags.
- Coupons.
- Reports.
- Promotions.

---

Store Discovery

Customers can locate stores using:

- Nearby Location
- Pincode
- Area Name
- City
- Search

Nearest store is automatically selected.

---

Multi-Store Design

Every store has:

- Different Pricing.
- Different Inventory.
- Different Product Images.
- Different Delivery Radius.
- Different Delivery Charges.
- Different Promotional Banners.

---

Coupons

Supports:

- Platform Coupons.
- Store Coupons.
- Category Coupons.
- Flat Discount.
- Percentage Discount.
- Minimum Order Value.
- Expiry Date.

Examples:

- RICE10
- FLOUR50
- WELCOME100

---

Billing Flow

Final bill includes:

- Product Total.
- Coupon Discount.
- Delivery Charge.
- Pickup Discount.
- Taxes (if applicable).
- Grand Total.

GST invoice generated after order completion.

---

Home Delivery

Delivery configuration is per store.

Each store manages:

- Delivery Radius.
- Delivery Charge.
- Free Delivery Above Amount.
- Minimum Delivery Order.

---

Store Promotional Banners

Every store can create banners.

Banner supports navigation to:

- Category
- Product
- Coupon
- Offer
- External URL (Future)

Banner scheduling includes:

- Start Date.
- End Date.
- Display Order.

---

Database Summary

Stage 1 Tables

1. Users
2. Stores
3. Admins
4. Categories
5. Products
6. Product Images
7. Store Products
8. Product Variants
9. Tags
10. Product Tags
11. Coupons
12. Coupon Categories
13. Store Product Images
14. Store Banners
15. Orders
16. Order Items

Phase 2 Tables

17. User Addresses
18. Payments
19. Delivery Partners
20. Order Delivery
21. Wishlist
22. Product Reviews
23. Loyalty Transactions
24. Subscriptions
25. Store Offers

---

Future Roadmap

Phase 1 (Nagpur MVP)

- One Store.
- Home Delivery.
- Store Pickup.
- Fresh Flour.
- Rice Age.
- Coupons.
- Store Banners.

Phase 2

- Multiple Stores.
- Delivery Partners.
- Loyalty Program.
- Wishlist.
- Reviews.
- Monthly Subscriptions.

Phase 3

- Franchise Stores.
- Multi-City Expansion.
- Healthy Marketplace.
- B2B Supply for Gyms, Restaurants & Societies.

---

Architecture: Java Spring Boot + PostgreSQL + React Admin + Android Consumer & Store Apps (multi-store ready from Day 1).