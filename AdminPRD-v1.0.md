### GrainBasket — Admin Application PRD (Phase 1 MVP)

Goal: Build one lightweight admin application that can manage the entire platform while keeping hosting and maintenance costs very low.

Tech Recommendation: React + Node + PostgreSQL (single backend, single database).

### 1\. Admin Dashboard

The first screen after login.

### Dashboard Widgets

* Total Orders (Today / This Month)

* Total Revenue

* Active Stores

* Total Customers

* Low Stock Products

* Pending Orders

* Coupon Usage

* Top Selling Products

### 2\. Store Management

Admin can create and manage stores.

### Features

* Add/Edit/Delete Store.

* Store name, address, city, pincode.

* Delivery radius.

* Delivery charge.

* Free delivery amount.

* Store username/password.

* Enable/Disable store.

### 3\. Category Management

Manage product categories.

Examples:

* Flour

* Rice

* Dry Fruits

* Millets

* Pulses

* Healthy Snacks

Fields:

* Name

* Image

* Display order

* Active status

### 4\. Product Management

Create master products once.

### Product Details

* Name

* Description

* Category

* Default images

* Organic/Healthy tags

* On-demand product flag

* Nutrition information (optional)

### 5\. Store Product Management

Assign products to stores.

Each store manages:

* Selling price

* MRP

* Stock quantity

* Store-specific images

* Active/Inactive

### 6\. Banner Management

Create promotional banners.

Banner can navigate to:

* Product

* Category

* Coupon

* Offer

Schedule using start/end dates.

### 7\. Coupon Management

Create coupons.

Options:

* Flat or Percentage discount.

* Category-specific.

* Store-specific.

* Expiry date.

* Minimum order value.

* Usage limit.

### 8\. Order Management

View all orders.

Filters:

* Store

* Date

* Status

* Delivery/Pickup

Admin can update order status if required.

### 9\. Customer Management

View customers.

* Mobile number

* Order history

* Status (Active/Blocked)

### 10\. Reports

Simple reports for MVP:

* Daily sales.

* Store-wise sales.

* Category-wise sales.

* Coupon usage.

### Cost & Maintenance Focus

* Single Node service for Admin + APIs.

* PostgreSQL database.

* Images stored in cloud storage later; local storage during MVP if needed.

* One admin panel serves all stores.

This design is simple enough for a small deployment today, while remaining ready for multi-store expansion later.
