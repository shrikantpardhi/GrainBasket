BEGIN;

INSERT INTO stores (name, address, contact_phone) VALUES
    ('First', 'Nagpur', '9999999999'),
    ('Second', 'Nagpur', '8888888888');
INSERT INTO staff_accounts (store_id, login_name, password_hash, role)
SELECT id, name, 'test-hash', 'STAFF' FROM stores;
INSERT INTO staff_accounts (store_id, login_name, password_hash, role)
SELECT id, 'admin', 'test-hash', 'ADMIN' FROM stores WHERE name = 'First';
INSERT INTO customers (mobile, name, verified_at) VALUES
    ('9876543210', 'Customer', now()),
    ('9876543211', 'Another customer', now());
INSERT INTO otp_challenges (mobile, code_digest, expires_at)
VALUES ('9876543210', 'test-digest', now() + interval '5 minutes');
INSERT INTO categories (kind, name_en) VALUES ('FLOUR', 'Flour');
INSERT INTO products (category_id, name_en) SELECT id, 'Wheat' FROM categories;
INSERT INTO product_variants (product_id, weight_grams)
SELECT id, weight FROM products CROSS JOIN (VALUES (1000), (2000)) AS sizes(weight);
INSERT INTO store_variant_offers (store_id, variant_id, price_inr, stock_on_hand)
SELECT s.id, v.id, 120, 10 FROM stores s CROSS JOIN product_variants v
WHERE s.name = 'First';
INSERT INTO store_variant_offers (store_id, variant_id, price_inr, stock_on_hand)
SELECT s.id, v.id, 150, 3 FROM stores s CROSS JOIN product_variants v
WHERE s.name = 'Second' AND v.weight_grams = 1000;

INSERT INTO orders (order_number, store_id, created_by_staff_id, source, checkout_key,
    contact_name, contact_mobile, fulfillment, flour_pickup_mode, status,
    item_subtotal, delivery_fee, amount_due)
SELECT 'first-order', s.id, a.id, 'STORE', 'first-checkout', 'Customer',
    '9876543210', 'PICKUP', 'IN_FRONT', 'PLACED', 120, 0, 120
FROM stores s JOIN staff_accounts a ON a.store_id = s.id
WHERE s.name = 'First' AND a.role = 'STAFF';
INSERT INTO orders (order_number, store_id, created_by_staff_id, source, checkout_key,
    customer_id, contact_name, contact_mobile, fulfillment, status, item_subtotal, delivery_fee, amount_due)
SELECT 'second-order', s.id, a.id, 'STORE', 'second-checkout', c.id, 'Customer',
    '9876543210', 'PICKUP', 'PLACED', 150, 0, 150
FROM stores s JOIN staff_accounts a ON a.store_id = s.id
CROSS JOIN customers c
WHERE s.name = 'Second' AND a.role = 'STAFF' AND c.mobile = '9876543210';
INSERT INTO order_items (order_id, store_id, variant_id, product_type,
    product_name_en, weight_grams, grind_choice, quantity, unit_price_inr, line_total_inr)
SELECT o.id, o.store_id, v.id, 'FLOUR', 'Wheat', 1000, 'FINE', 1, 150, 150
FROM orders o CROSS JOIN product_variants v
WHERE o.order_number = 'second-order' AND v.weight_grams = 1000;
INSERT INTO orders (order_number, store_id, customer_id, source, checkout_key,
    contact_name, contact_mobile, fulfillment, delivery_name, delivery_mobile,
    delivery_address, delivery_pincode, status, item_subtotal, delivery_fee, amount_due)
SELECT 'consumer-delivery', s.id, c.id, 'CONSUMER', 'consumer-checkout',
    'Customer', c.mobile, 'DELIVERY', 'Customer', c.mobile, 'Nagpur',
    '440001', 'AWAITING_PAYMENT', 150, 20, 170
FROM stores s CROSS JOIN customers c
WHERE s.name = 'Second' AND c.mobile = '9876543210';
INSERT INTO order_items (order_id, store_id, variant_id, product_type,
    product_name_en, weight_grams, grind_choice, quantity, unit_price_inr, line_total_inr)
SELECT o.id, o.store_id, v.id, 'FLOUR', 'Wheat', 1000, 'FINE', 1, 150, 150
FROM orders o CROSS JOIN product_variants v
WHERE o.order_number = 'consumer-delivery' AND v.weight_grams = 1000;
INSERT INTO payments (order_id, method, amount_inr, status, attempt_key, provider, expires_at)
SELECT id, 'CARD', 170, 'PENDING', 'consumer-payment', 'test-provider',
    now() + interval '5 minutes' FROM orders WHERE order_number = 'consumer-delivery';
INSERT INTO orders (order_number, store_id, created_by_staff_id, source, checkout_key,
    contact_name, contact_mobile, fulfillment, flour_pickup_mode, arrived_at,
    arrival_recorded_by_staff_id, actual_ready_at, status, item_subtotal, delivery_fee, amount_due)
SELECT 'unclaimed-order', s.id, a.id, 'STORE', 'unclaimed-checkout',
    'Customer', '9876543210', 'PICKUP', 'IN_FRONT', now(), a.id, now(),
    'COLLECTED', 120, 0, 120
FROM stores s JOIN staff_accounts a ON a.store_id = s.id
WHERE s.name = 'First' AND a.role = 'STAFF';
INSERT INTO order_items (order_id, store_id, variant_id, product_type,
    product_name_en, weight_grams, grind_choice, quantity, unit_price_inr, line_total_inr)
SELECT o.id, o.store_id, v.id, 'FLOUR', 'Wheat', 1000, 'FINE', 1, 120, 120
FROM orders o CROSS JOIN product_variants v
WHERE o.order_number = 'unclaimed-order' AND v.weight_grams = 1000;
INSERT INTO payments (order_id, method, amount_inr, status, attempt_key,
    paid_at, collected_by_staff_id, collected_at)
SELECT o.id, 'CASH', 120, 'PAID', 'unclaimed-payment', now(), a.id, now()
FROM orders o JOIN staff_accounts a ON a.id = o.created_by_staff_id
WHERE o.order_number = 'unclaimed-order';

DO $checks$
BEGIN
    IF (SELECT count(*) FROM store_variant_offers) <> 3 THEN
        RAISE EXCEPTION 'Store offer counts differ';
    END IF;
    IF (SELECT price_inr FROM store_variant_offers o JOIN stores s ON s.id = o.store_id
        JOIN product_variants v ON v.id = o.variant_id
        WHERE s.name = 'Second' AND v.weight_grams = 1000) <> 150 THEN
        RAISE EXCEPTION 'Second store price differs';
    END IF;
    UPDATE otp_challenges SET attempts = attempts + 1, consumed_at = now()
    WHERE mobile = '9876543210' AND consumed_at IS NULL AND expires_at > now();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'OTP challenge was not consumed';
    END IF;

    UPDATE payments SET status = 'PAID', paid_at = now(), provider_reference = 'provider-card-1'
    WHERE attempt_key = 'consumer-payment';
    UPDATE orders SET status = 'PLACED' WHERE order_number = 'consumer-delivery';

    BEGIN
        UPDATE orders SET arrived_at = now() WHERE order_number = 'first-order';
        RAISE EXCEPTION 'Arrival without staff attribution was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE orders SET arrived_at = now(), arrival_recorded_by_staff_id =
            (SELECT id FROM staff_accounts WHERE login_name = 'Second')
        WHERE order_number = 'first-order';
        RAISE EXCEPTION 'Cross-store arrival was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;

    UPDATE orders SET arrived_at = now(), arrival_recorded_by_staff_id =
        (SELECT id FROM staff_accounts WHERE login_name = 'First')
    WHERE order_number = 'first-order';
    INSERT INTO ready_estimate_events (order_id, staff_id, estimated_ready_at, reason)
    SELECT o.id, a.id, now() + interval '30 minutes', 'Arrival check-in'
    FROM orders o JOIN staff_accounts a ON a.id = o.arrival_recorded_by_staff_id
    WHERE o.order_number = 'first-order';

    BEGIN
        INSERT INTO orders (order_number, store_id, created_by_staff_id, source,
            checkout_key, contact_name, contact_mobile, fulfillment, delivery_name,
            delivery_mobile, delivery_address, status, item_subtotal, delivery_fee, amount_due)
        SELECT 'missing-pincode', s.id, a.id, 'STORE', 'missing-pincode', 'Customer',
            '9876543210', 'DELIVERY', 'Customer', '9876543210', 'Nagpur', 'PLACED', 120, 0, 120
        FROM stores s JOIN staff_accounts a ON a.store_id = s.id WHERE s.name = 'First';
        RAISE EXCEPTION 'Delivery without pincode was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO orders (order_number, store_id, created_by_staff_id, source,
            checkout_key, contact_name, contact_mobile, fulfillment,
            requested_pickup_at, status, item_subtotal, delivery_fee, amount_due)
        SELECT 'missing-mode', s.id, a.id, 'STORE', 'missing-mode', 'Customer',
            '9876543210', 'PICKUP', now() + interval '1 day', 'PLACED', 120, 0, 120
        FROM stores s JOIN staff_accounts a ON a.store_id = s.id WHERE s.name = 'First';
        RAISE EXCEPTION 'Pickup time without flour mode was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO payments (order_id, method, amount_inr, status, attempt_key,
            paid_at, collected_by_staff_id, collected_at, refund_status,
            refund_amount_inr, refund_requested_at, refund_confirmed_at)
        SELECT o.id, 'CASH', 120, 'PAID', 'cash-refund', now(), a.id, now(),
            'REFUNDED', 120, now(), now()
        FROM orders o JOIN staff_accounts a ON a.id = o.created_by_staff_id
        WHERE o.order_number = 'first-order';
        RAISE EXCEPTION 'Cash refund without actor was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO payments (order_id, method, amount_inr, status, attempt_key,
            paid_at, collected_by_staff_id, collected_at, refund_status)
        SELECT o.id, 'CASH', 120, 'PAID', 'cash-refund', now(), a.id, now(), 'PENDING'
        FROM orders o JOIN staff_accounts a ON a.id = o.created_by_staff_id
        WHERE o.order_number = 'first-order';
        RAISE EXCEPTION 'Pending refund without amount and request time was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    INSERT INTO payments (order_id, method, amount_inr, status, attempt_key,
        paid_at, collected_by_staff_id, collected_at, refund_status,
        refund_amount_inr, refund_requested_at, refund_confirmed_at, refunded_by_staff_id)
    SELECT o.id, 'CASH', 120, 'PAID', 'cash-refund', now(), a.id, now(),
        'REFUNDED', 120, now(), now(), a.id
    FROM orders o JOIN staff_accounts a ON a.id = o.created_by_staff_id
    WHERE o.order_number = 'first-order';

    BEGIN
        INSERT INTO payments (order_id, method, amount_inr, status, attempt_key,
            provider, expires_at, paid_at)
        SELECT id, 'UPI', 150, 'PAID', 'online-payment', 'test-provider',
            now() + interval '1 hour', now()
        FROM orders WHERE order_number = 'second-order';
        RAISE EXCEPTION 'Verified online payment without provider reference was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    INSERT INTO payments (order_id, method, amount_inr, status, attempt_key,
        provider, provider_reference, expires_at, paid_at)
    SELECT id, 'UPI', 150, 'PAID', 'online-payment', 'test-provider',
        'provider-payment-1', now() + interval '1 hour', now()
    FROM orders WHERE order_number = 'second-order';

    BEGIN
        INSERT INTO reward_reservations (order_id, customer_id, points, status, expires_at)
        SELECT o.id, c.id, 5, 'HELD', now() + interval '5 minutes'
        FROM orders o CROSS JOIN customers c
        WHERE o.order_number = 'second-order' AND c.mobile = '9876543211';
        RAISE EXCEPTION 'Points reservation for another customer was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;

    INSERT INTO reward_reservations (order_id, customer_id, points, status, expires_at)
    SELECT id, customer_id, 5, 'HELD', now() + interval '5 minutes'
    FROM orders WHERE order_number = 'second-order';

    BEGIN
        INSERT INTO reward_transactions (store_id, order_id, customer_id, action, points, action_key)
        SELECT s.id, o.id, o.customer_id, 'REDEEM', -5, 'wrong-store-redeem'
        FROM orders o CROSS JOIN stores s
        WHERE o.order_number = 'second-order' AND s.name = 'First';
        RAISE EXCEPTION 'Cross-store reward entry was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;

    INSERT INTO reward_transactions (store_id, order_id, customer_id, action, points, action_key)
    SELECT store_id, id, customer_id, 'REDEEM', -5, 'second-redeem'
    FROM orders WHERE order_number = 'second-order';

    INSERT INTO reward_transactions (store_id, order_id, action, points, action_key)
    SELECT store_id, id, 'EARN', 10, 'first-earn'
    FROM orders WHERE order_number = 'unclaimed-order';
    UPDATE orders SET customer_id = (SELECT id FROM customers WHERE mobile = '9876543210')
    WHERE order_number = 'unclaimed-order';

    BEGIN
        UPDATE reward_transactions SET customer_id =
            (SELECT id FROM customers WHERE mobile = '9876543211')
        WHERE action_key = 'first-earn';
        RAISE EXCEPTION 'Unclaimed points linked to another customer were accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;

    UPDATE reward_transactions SET customer_id =
        (SELECT id FROM customers WHERE mobile = '9876543210')
    WHERE action_key = 'first-earn';

    BEGIN
        INSERT INTO reward_transactions (store_id, customer_id, action, points, action_key, reason)
        SELECT s.id, c.id, 'ADJUST', -1, 'unattributed-adjustment', 'Correction'
        FROM stores s CROSS JOIN customers c
        WHERE s.name = 'Second' AND c.mobile = '9876543210';
        RAISE EXCEPTION 'Reward correction without actor was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    INSERT INTO reward_transactions (store_id, customer_id, action, points,
        action_key, reason, adjusted_by_staff_id)
    SELECT s.id, c.id, 'ADJUST', -1, 'admin-adjustment', 'Correction', a.id
    FROM stores s CROSS JOIN customers c CROSS JOIN staff_accounts a
    WHERE s.name = 'Second' AND c.mobile = '9876543210' AND a.login_name = 'admin';

    BEGIN
        INSERT INTO orders (order_number, store_id, created_by_staff_id, source,
            checkout_key, contact_name, contact_mobile, fulfillment, status,
            item_subtotal, delivery_fee, amount_due)
        SELECT 'wrong-staff', s.id, a.id, 'STORE', 'wrong-staff', 'Customer',
            '9876543210', 'PICKUP', 'PLACED', 150, 0, 150
        FROM stores s CROSS JOIN staff_accounts a
        WHERE s.name = 'Second' AND a.login_name = 'First';
        RAISE EXCEPTION 'Cross-store order actor was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO order_items (order_id, store_id, variant_id, product_type,
            product_name_en, weight_grams, grind_choice, quantity, unit_price_inr, line_total_inr)
        SELECT o.id, o.store_id, v.id, 'FLOUR', 'Wheat', 2000, 'FINE', 1, 150, 150
        FROM orders o CROSS JOIN product_variants v
        WHERE o.order_number = 'second-order' AND v.weight_grams = 2000;
        RAISE EXCEPTION 'Variant not offered at this store was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
END;
$checks$;

ROLLBACK;
