BEGIN;

CREATE TABLE product_claims (
    product_id bigint NOT NULL REFERENCES products(id),
    kind text NOT NULL CHECK (kind IN ('ORGANIC', 'NUTRITION')),
    text_en text NOT NULL CHECK (btrim(text_en) <> ''),
    evidence_ref text NOT NULL CHECK (btrim(evidence_ref) <> ''),
    verified_by_staff_id bigint NOT NULL REFERENCES staff_accounts(id),
    verified_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, kind)
);

CREATE TABLE variant_claim_evidence (
    variant_id bigint PRIMARY KEY REFERENCES product_variants(id),
    evidence_ref text NOT NULL CHECK (btrim(evidence_ref) <> ''),
    verified_by_staff_id bigint NOT NULL REFERENCES staff_accounts(id),
    verified_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
