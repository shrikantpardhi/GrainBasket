BEGIN;

CREATE TABLE stores (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL CHECK (btrim(name) <> ''),
    address text NOT NULL CHECK (btrim(address) <> ''),
    contact_phone varchar(20) NOT NULL,
    timezone text NOT NULL DEFAULT 'Asia/Kolkata',
    preparation_lead_minutes integer CHECK (preparation_lead_minutes > 0),
    delivery_fee numeric(12, 2) CHECK (delivery_fee >= 0),
    ordering_enabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE store_hours (
    store_id bigint NOT NULL REFERENCES stores(id),
    weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    closed boolean NOT NULL DEFAULT false,
    opens_at time,
    closes_at time,
    order_cutoff_at time,
    PRIMARY KEY (store_id, weekday),
    CHECK (
        (closed AND opens_at IS NULL AND closes_at IS NULL AND order_cutoff_at IS NULL)
        OR (NOT closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL
            AND order_cutoff_at IS NOT NULL AND opens_at < closes_at
            AND order_cutoff_at BETWEEN opens_at AND closes_at)
    )
);

CREATE TABLE store_pickup_times (
    store_id bigint NOT NULL,
    weekday smallint NOT NULL,
    pickup_at time NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    PRIMARY KEY (store_id, weekday, pickup_at),
    FOREIGN KEY (store_id, weekday) REFERENCES store_hours(store_id, weekday)
);

CREATE TABLE store_delivery_pincodes (
    store_id bigint NOT NULL REFERENCES stores(id),
    pincode char(6) NOT NULL CHECK (pincode ~ '^[0-9]{6}$'),
    PRIMARY KEY (store_id, pincode)
);

CREATE TABLE staff_accounts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    store_id bigint NOT NULL REFERENCES stores(id),
    login_name text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('ADMIN', 'STAFF')),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (btrim(login_name) <> '' AND btrim(password_hash) <> '')
);

CREATE TABLE customers (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mobile varchar(20) NOT NULL UNIQUE CHECK (btrim(mobile) <> ''),
    name text NOT NULL CHECK (btrim(name) <> ''),
    verified_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    staff_id bigint REFERENCES staff_accounts(id),
    customer_id bigint REFERENCES customers(id),
    token_hash text NOT NULL UNIQUE CHECK (btrim(token_hash) <> ''),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((staff_id IS NULL) <> (customer_id IS NULL))
);

CREATE TABLE reward_settings (
    store_id bigint PRIMARY KEY REFERENCES stores(id),
    points_per_inr numeric(12, 4) NOT NULL CHECK (points_per_inr > 0),
    minimum_redemption_points integer NOT NULL CHECK (minimum_redemption_points > 0),
    point_value_inr numeric(12, 2) NOT NULL CHECK (point_value_inr > 0),
    maximum_redemption_points integer NOT NULL CHECK (maximum_redemption_points > 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind text NOT NULL UNIQUE CHECK (kind IN ('FLOUR', 'RICE')),
    name_en text NOT NULL,
    description_en text,
    active boolean NOT NULL DEFAULT true
);

CREATE TABLE products (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id bigint NOT NULL REFERENCES categories(id),
    name_en text NOT NULL,
    description_en text,
    image_ref text,
    active boolean NOT NULL DEFAULT true
);

CREATE TABLE product_variants (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id bigint NOT NULL REFERENCES products(id),
    weight_grams integer NOT NULL CHECK (weight_grams > 0),
    rice_age text CHECK (rice_age IS NULL OR btrim(rice_age) <> ''),
    price_inr numeric(12, 2) NOT NULL CHECK (price_inr >= 0),
    stock_on_hand integer NOT NULL DEFAULT 0 CHECK (stock_on_hand >= 0),
    stock_reserved integer NOT NULL DEFAULT 0 CHECK (stock_reserved >= 0),
    active boolean NOT NULL DEFAULT true,
    CHECK (stock_reserved <= stock_on_hand)
);

CREATE UNIQUE INDEX product_variant_choice ON product_variants
    (product_id, weight_grams, coalesce(rice_age, ''));

CREATE TABLE catalog_translations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id bigint REFERENCES categories(id),
    product_id bigint REFERENCES products(id),
    language_code text NOT NULL CHECK (language_code IN ('en', 'hi', 'mr')),
    name text NOT NULL,
    description text,
    CHECK ((category_id IS NULL) <> (product_id IS NULL))
);

CREATE UNIQUE INDEX category_translation_language ON catalog_translations
    (category_id, language_code) WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX product_translation_language ON catalog_translations
    (product_id, language_code) WHERE product_id IS NOT NULL;

CREATE TABLE ui_translations (
    translation_key text NOT NULL,
    language_code text NOT NULL CHECK (language_code IN ('en', 'hi', 'mr')),
    version integer NOT NULL CHECK (version > 0),
    text_value text NOT NULL,
    PRIMARY KEY (translation_key, language_code, version)
);

CREATE TABLE orders (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_number text NOT NULL UNIQUE CHECK (btrim(order_number) <> ''),
    store_id bigint NOT NULL REFERENCES stores(id),
    customer_id bigint REFERENCES customers(id),
    created_by_staff_id bigint REFERENCES staff_accounts(id),
    source text NOT NULL CHECK (source IN ('CONSUMER', 'STORE')),
    checkout_key text NOT NULL UNIQUE CHECK (btrim(checkout_key) <> ''),
    contact_name text NOT NULL CHECK (btrim(contact_name) <> ''),
    contact_mobile varchar(20) NOT NULL CHECK (btrim(contact_mobile) <> ''),
    fulfillment text NOT NULL CHECK (fulfillment IN ('PICKUP', 'DELIVERY')),
    delivery_name text,
    delivery_mobile varchar(20),
    delivery_address text,
    delivery_pincode char(6),
    flour_pickup_mode text CHECK (flour_pickup_mode IN ('IN_FRONT', 'IN_ADVANCE')),
    requested_pickup_at timestamptz,
    arrived_at timestamptz,
    estimated_ready_at timestamptz,
    actual_ready_at timestamptz,
    status text NOT NULL CHECK (status IN (
        'AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PLACED', 'ACCEPTED', 'PREPARING',
        'READY_FOR_PICKUP', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY',
        'COLLECTED', 'DELIVERED', 'CANCELLED'
    )),
    cancellation_reason text,
    item_subtotal numeric(12, 2) NOT NULL CHECK (item_subtotal >= 0),
    delivery_fee numeric(12, 2) NOT NULL CHECK (delivery_fee >= 0),
    points_redeemed integer NOT NULL DEFAULT 0 CHECK (points_redeemed >= 0),
    points_value_inr numeric(12, 2) NOT NULL DEFAULT 0 CHECK (points_value_inr >= 0),
    amount_due numeric(12, 2) NOT NULL CHECK (amount_due > 0),
    currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (amount_due = item_subtotal + delivery_fee - points_value_inr),
    CHECK (
        (source = 'CONSUMER' AND customer_id IS NOT NULL AND created_by_staff_id IS NULL)
        OR (source = 'STORE' AND created_by_staff_id IS NOT NULL)
    ),
    CHECK (
        (fulfillment = 'PICKUP' AND delivery_name IS NULL AND delivery_mobile IS NULL
            AND delivery_address IS NULL AND delivery_pincode IS NULL)
        OR (fulfillment = 'DELIVERY' AND delivery_name IS NOT NULL AND btrim(delivery_name) <> ''
            AND delivery_mobile IS NOT NULL AND btrim(delivery_mobile) <> ''
            AND delivery_address IS NOT NULL AND btrim(delivery_address) <> ''
            AND delivery_pincode IS NOT NULL AND delivery_pincode ~ '^[0-9]{6}$'
            AND flour_pickup_mode IS NULL AND requested_pickup_at IS NULL AND arrived_at IS NULL)
    ),
    CHECK (
        (flour_pickup_mode IS NULL AND requested_pickup_at IS NULL AND arrived_at IS NULL)
        OR (flour_pickup_mode IS NOT NULL AND (
            (flour_pickup_mode = 'IN_FRONT' AND requested_pickup_at IS NULL)
            OR (flour_pickup_mode = 'IN_ADVANCE' AND requested_pickup_at IS NOT NULL AND arrived_at IS NULL)
        ))
    )
);

CREATE INDEX orders_store_status ON orders(store_id, status, created_at);
CREATE INDEX orders_customer_created ON orders(customer_id, created_at DESC);

CREATE TABLE order_items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders(id),
    variant_id bigint NOT NULL REFERENCES product_variants(id),
    product_type text NOT NULL CHECK (product_type IN ('FLOUR', 'RICE')),
    product_name_en text NOT NULL,
    translated_names jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(translated_names) = 'object'),
    weight_grams integer NOT NULL CHECK (weight_grams > 0),
    rice_age text,
    grind_choice text CHECK (grind_choice IN ('FINE', 'MEDIUM', 'COARSE')),
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price_inr numeric(12, 2) NOT NULL CHECK (unit_price_inr >= 0),
    line_total_inr numeric(12, 2) NOT NULL,
    CHECK (line_total_inr = unit_price_inr * quantity),
    CHECK (
        (product_type = 'FLOUR' AND grind_choice IS NOT NULL AND rice_age IS NULL)
        OR (product_type = 'RICE' AND grind_choice IS NULL)
    )
);

CREATE TABLE stock_reservations (
    order_item_id bigint PRIMARY KEY REFERENCES order_items(id),
    quantity integer NOT NULL CHECK (quantity > 0),
    status text NOT NULL CHECK (status IN ('HELD', 'COMMITTED', 'RELEASED')),
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (status <> 'HELD' OR expires_at IS NOT NULL)
);

CREATE TABLE stock_adjustments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    variant_id bigint NOT NULL REFERENCES product_variants(id),
    staff_id bigint NOT NULL REFERENCES staff_accounts(id),
    quantity_change integer NOT NULL CHECK (quantity_change <> 0),
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders(id),
    method text NOT NULL CHECK (method IN ('CASH', 'UPI', 'CARD')),
    amount_inr numeric(12, 2) NOT NULL CHECK (amount_inr > 0),
    currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
    status text NOT NULL CHECK (status IN ('PENDING', 'PAID', 'FAILED')),
    attempt_key text NOT NULL UNIQUE CHECK (btrim(attempt_key) <> ''),
    provider text,
    provider_reference text,
    expires_at timestamptz,
    paid_at timestamptz,
    collected_by_staff_id bigint REFERENCES staff_accounts(id),
    collected_at timestamptz,
    refund_status text NOT NULL DEFAULT 'NONE' CHECK (refund_status IN ('NONE', 'PENDING', 'FAILED', 'REFUNDED')),
    refund_amount_inr numeric(12, 2),
    refund_reference text,
    refund_requested_at timestamptz,
    refund_confirmed_at timestamptz,
    refunded_by_staff_id bigint REFERENCES staff_accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (status <> 'PAID' OR paid_at IS NOT NULL),
    CHECK (
        (method = 'CASH' AND status = 'PAID' AND provider IS NULL AND provider_reference IS NULL
            AND collected_by_staff_id IS NOT NULL AND collected_at IS NOT NULL)
        OR (method IN ('UPI', 'CARD') AND provider IS NOT NULL AND expires_at IS NOT NULL
            AND collected_by_staff_id IS NULL AND collected_at IS NULL)
    ),
    CHECK (method = 'CASH' OR status <> 'PAID' OR
        (provider_reference IS NOT NULL AND btrim(provider_reference) <> '')),
    CHECK (refund_amount_inr IS NULL OR (refund_amount_inr > 0 AND refund_amount_inr <= amount_inr)),
    CHECK (refund_status = 'NONE' OR status = 'PAID'),
    CHECK (
        (refund_status = 'NONE' AND refund_amount_inr IS NULL AND refund_requested_at IS NULL
            AND refund_confirmed_at IS NULL AND refund_reference IS NULL AND refunded_by_staff_id IS NULL)
        OR (refund_status <> 'NONE' AND refund_amount_inr IS NOT NULL AND refund_requested_at IS NOT NULL)
    ),
    CHECK (refund_status <> 'REFUNDED' OR
        (refund_confirmed_at IS NOT NULL AND (method <> 'CASH' OR refunded_by_staff_id IS NOT NULL)))
);

CREATE UNIQUE INDEX one_cash_payment_per_order ON payments(order_id) WHERE method = 'CASH';
CREATE UNIQUE INDEX one_active_paid_payment_per_order ON payments(order_id)
    WHERE status = 'PAID' AND refund_status = 'NONE';
CREATE UNIQUE INDEX provider_payment_reference ON payments(provider, provider_reference)
    WHERE provider_reference IS NOT NULL;
CREATE UNIQUE INDEX provider_refund_reference ON payments(provider, refund_reference)
    WHERE refund_reference IS NOT NULL;
CREATE INDEX payments_order_created ON payments(order_id, created_at DESC);

CREATE TABLE reward_reservations (
    order_id bigint PRIMARY KEY REFERENCES orders(id),
    customer_id bigint NOT NULL REFERENCES customers(id),
    points integer NOT NULL CHECK (points > 0),
    status text NOT NULL CHECK (status IN ('HELD', 'COMMITTED', 'RELEASED')),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reward_reservations_customer_status ON reward_reservations(customer_id, status);

CREATE TABLE reward_transactions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    store_id bigint NOT NULL REFERENCES stores(id),
    order_id bigint REFERENCES orders(id),
    customer_id bigint REFERENCES customers(id),
    action text NOT NULL CHECK (action IN ('EARN', 'REDEEM', 'RESTORE', 'ADJUST')),
    points integer NOT NULL CHECK (points <> 0),
    action_key text NOT NULL UNIQUE CHECK (btrim(action_key) <> ''),
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (customer_id IS NOT NULL OR (action = 'EARN' AND order_id IS NOT NULL)),
    CHECK (order_id IS NOT NULL OR action = 'ADJUST'),
    CHECK (action <> 'ADJUST' OR (reason IS NOT NULL AND btrim(reason) <> '')),
    CHECK ((action IN ('EARN', 'RESTORE') AND points > 0)
        OR (action = 'REDEEM' AND points < 0) OR action = 'ADJUST')
);

CREATE UNIQUE INDEX one_reward_action_per_order ON reward_transactions(order_id, action)
    WHERE order_id IS NOT NULL AND action <> 'ADJUST';
CREATE INDEX reward_transactions_customer_created ON reward_transactions(customer_id, created_at);

CREATE TABLE marketing_choices (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id bigint REFERENCES orders(id),
    customer_id bigint REFERENCES customers(id),
    opted_in boolean NOT NULL DEFAULT false,
    source text NOT NULL CHECK (source IN ('CONSUMER', 'STORE', 'ADMIN')),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CHECK (order_id IS NOT NULL OR customer_id IS NOT NULL)
);

CREATE TABLE order_status_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders(id),
    from_status text CHECK (from_status IN (
        'AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PLACED', 'ACCEPTED', 'PREPARING',
        'READY_FOR_PICKUP', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY',
        'COLLECTED', 'DELIVERED', 'CANCELLED'
    )),
    to_status text NOT NULL CHECK (to_status IN (
        'AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PLACED', 'ACCEPTED', 'PREPARING',
        'READY_FOR_PICKUP', 'READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY',
        'COLLECTED', 'DELIVERED', 'CANCELLED'
    )),
    actor_type text NOT NULL CHECK (actor_type IN ('CUSTOMER', 'STAFF', 'SYSTEM')),
    actor_staff_id bigint REFERENCES staff_accounts(id),
    actor_customer_id bigint REFERENCES customers(id),
    reason text,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (actor_type = 'STAFF' AND actor_staff_id IS NOT NULL AND actor_customer_id IS NULL)
        OR (actor_type = 'CUSTOMER' AND actor_customer_id IS NOT NULL AND actor_staff_id IS NULL)
        OR (actor_type = 'SYSTEM' AND actor_staff_id IS NULL AND actor_customer_id IS NULL)
    )
);

CREATE INDEX order_status_events_order_time ON order_status_events(order_id, occurred_at);

CREATE TABLE ready_estimate_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders(id),
    staff_id bigint NOT NULL REFERENCES staff_accounts(id),
    previous_estimate_at timestamptz,
    estimated_ready_at timestamptz NOT NULL,
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ready_estimate_events_order_time ON ready_estimate_events(order_id, recorded_at);

COMMIT;
