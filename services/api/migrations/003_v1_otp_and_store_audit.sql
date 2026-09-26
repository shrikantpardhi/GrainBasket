BEGIN;

CREATE TABLE otp_request_cooldowns (
    mobile varchar(20) PRIMARY KEY CHECK (btrim(mobile) <> ''),
    last_issued_at timestamptz NOT NULL,
    next_request_at timestamptz NOT NULL,
    CHECK (next_request_at = last_issued_at + interval '30 seconds')
);

INSERT INTO otp_request_cooldowns (mobile, last_issued_at, next_request_at)
SELECT DISTINCT ON (mobile) mobile, created_at, created_at + interval '30 seconds'
FROM otp_challenges
ORDER BY mobile, created_at DESC, id DESC;

ALTER TABLE payments ADD COLUMN store_id bigint;
UPDATE payments AS payment SET store_id = orders.store_id
FROM orders WHERE payment.order_id = orders.id;
ALTER TABLE payments ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE payments ADD CONSTRAINT payments_order_store_fk
    FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id);
ALTER TABLE payments ADD CONSTRAINT payments_cash_staff_store_fk
    FOREIGN KEY (collected_by_staff_id, store_id) REFERENCES staff_accounts(id, store_id);

ALTER TABLE order_status_events ADD COLUMN store_id bigint;
UPDATE order_status_events AS event SET store_id = orders.store_id
FROM orders WHERE event.order_id = orders.id;
ALTER TABLE order_status_events ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE order_status_events ADD CONSTRAINT order_status_events_order_store_fk
    FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id);
ALTER TABLE order_status_events ADD CONSTRAINT order_status_events_staff_store_fk
    FOREIGN KEY (actor_staff_id, store_id) REFERENCES staff_accounts(id, store_id);
ALTER TABLE order_status_events ADD CONSTRAINT order_status_events_customer_order_fk
    FOREIGN KEY (order_id, actor_customer_id) REFERENCES orders(id, customer_id);

ALTER TABLE ready_estimate_events ADD COLUMN store_id bigint;
UPDATE ready_estimate_events AS event SET store_id = orders.store_id
FROM orders WHERE event.order_id = orders.id;
ALTER TABLE ready_estimate_events ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE ready_estimate_events ADD CONSTRAINT ready_estimate_events_order_store_fk
    FOREIGN KEY (order_id, store_id) REFERENCES orders(id, store_id);
ALTER TABLE ready_estimate_events ADD CONSTRAINT ready_estimate_events_staff_store_fk
    FOREIGN KEY (staff_id, store_id) REFERENCES staff_accounts(id, store_id);

ALTER TABLE marketing_choices ADD CONSTRAINT marketing_choices_customer_order_fk
    FOREIGN KEY (order_id, customer_id) REFERENCES orders(id, customer_id);

COMMIT;
