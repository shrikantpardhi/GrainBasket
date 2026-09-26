BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM product_variants)
        AND (SELECT count(*) FROM stores) <> 1 THEN
        RAISE EXCEPTION 'Variant migration requires exactly one Phase 1 store';
    END IF;
END;
$$;

CREATE TABLE store_variant_offers (
    store_id bigint NOT NULL REFERENCES stores(id),
    variant_id bigint NOT NULL REFERENCES product_variants(id),
    price_inr numeric(12, 2) NOT NULL CHECK (price_inr >= 0),
    stock_on_hand integer NOT NULL DEFAULT 0 CHECK (stock_on_hand >= 0),
    stock_reserved integer NOT NULL DEFAULT 0 CHECK (stock_reserved >= 0),
    active boolean NOT NULL DEFAULT true,
    PRIMARY KEY (store_id, variant_id),
    CHECK (stock_reserved <= stock_on_hand)
);

INSERT INTO store_variant_offers
    (store_id, variant_id, price_inr, stock_on_hand, stock_reserved, active)
SELECT stores.id, variants.id, variants.price_inr,
    variants.stock_on_hand, variants.stock_reserved, variants.active
FROM stores CROSS JOIN product_variants AS variants;

ALTER TABLE orders ADD CONSTRAINT orders_id_store_unique UNIQUE (id, store_id);
ALTER TABLE staff_accounts ADD CONSTRAINT staff_id_store_unique UNIQUE (id, store_id);

ALTER TABLE orders ADD CONSTRAINT orders_creating_staff_store_fk
    FOREIGN KEY (created_by_staff_id, store_id) REFERENCES staff_accounts(id, store_id);
ALTER TABLE orders ADD CONSTRAINT orders_arrival_staff_store_fk
    FOREIGN KEY (arrival_recorded_by_staff_id, store_id) REFERENCES staff_accounts(id, store_id);
ALTER TABLE reward_transactions ADD CONSTRAINT reward_transactions_order_store_fk
    FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id);

ALTER TABLE order_items ADD COLUMN store_id bigint;
UPDATE order_items AS items SET store_id = orders.store_id
FROM orders WHERE items.order_id = orders.id;
ALTER TABLE order_items ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE order_items ADD CONSTRAINT order_items_order_store_fk
    FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id);
ALTER TABLE order_items ADD CONSTRAINT order_items_store_offer_fk
    FOREIGN KEY (store_id, variant_id) REFERENCES store_variant_offers(store_id, variant_id);

ALTER TABLE stock_adjustments ADD COLUMN store_id bigint;
UPDATE stock_adjustments AS adjustments SET store_id = staff.store_id
FROM staff_accounts AS staff WHERE adjustments.staff_id = staff.id;
ALTER TABLE stock_adjustments ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE stock_adjustments ADD CONSTRAINT stock_adjustments_store_offer_fk
    FOREIGN KEY (store_id, variant_id) REFERENCES store_variant_offers(store_id, variant_id);

ALTER TABLE product_variants
    DROP COLUMN price_inr,
    DROP COLUMN stock_on_hand,
    DROP COLUMN stock_reserved,
    DROP COLUMN active;

COMMIT;
