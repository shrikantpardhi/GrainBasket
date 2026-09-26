# GrainBasket v1.0

The [single v1.0 PRD](docs/prd-v1.0.md) covers **both Nagpur stores**, the consumer and store Android apps, the React admin panel and their shared Node.js API/PostgreSQL data model. Store hours and reward values are configurable; the payment gateway and tax/refund policies are chosen before launch. The implementation order is admin → store → consumer, with all three applications and both stores required for v1.0.

| Document or script | Purpose |
| --- | --- |
| [v1.0 PRD](docs/prd-v1.0.md) | One source of truth for product, application, shared backend and release requirements, including the 30-second OTP resend wait. |
| [Implementation roadmap](docs/implementation-roadmap.md) | Monorepo layout, admin → store → consumer sequence and stage gates. |
| [Implementation tasks](docs/implementation-tasks.md) | Actionable tasks and v1.0 acceptance checks for both stores and all three apps. |
| [Initial PostgreSQL migration](services/api/migrations/001_phase1.sql) | Base schema, including OTP challenge history and common records. |
| [Store-offer migration](services/api/migrations/002_phase2_store_offers.sql) | Required v1.0 per-store price, stock and active offer relationships. |
| [OTP and store-audit migration](services/api/migrations/003_v1_otp_and_store_audit.sql) | Required v1.0 atomic OTP request gate and store-bound payment and audit records. |
| [Admin claim-evidence migration](services/api/migrations/004_admin_claim_evidence.sql) | Verified rice-age, organic and nutrition claim references for catalog publishing. |
| [Schema smoke checks](services/api/tests/schema.sql) | Disposable checks for two-store relationships, OTP request boundaries, payments/refunds and customer ownership. |

The first two migration filenames retain their historical Phase 1/Phase 2 names. **For a fresh v1.0 database apply all four, in order, before creating either store, catalog variants or offers:**

```bash
psql -X -v ON_ERROR_STOP=1 -d <database> -f services/api/migrations/001_phase1.sql
psql -X -v ON_ERROR_STOP=1 -d <database> -f services/api/migrations/002_phase2_store_offers.sql
psql -X -v ON_ERROR_STOP=1 -d <database> -f services/api/migrations/003_v1_otp_and_store_audit.sql
psql -X -v ON_ERROR_STOP=1 -d <database> -f services/api/migrations/004_admin_claim_evidence.sql
```

These scripts create no stores, users, schedule, rewards configuration or provider settings. Configure both stores and their offers via admin after migration; the API reads and writes `store_variant_offers`. An existing populated one-store database needs a backup and a coordinated API migration; the store-offer backfill requires exactly one existing store when variants exist. The third migration backfills any existing OTP request times and store identities for payment and audit records; inconsistent legacy attribution needs correction before it can apply. The fourth records evidence links supplied by an admin for catalog claims. The applications access PostgreSQL only through authorized APIs; the future OTP API must atomically claim a row in `otp_request_cooldowns` before creating a challenge and initiating SMS. Order transactions and payment verification belong to the later store implementation stage.

For a **disposable, otherwise empty** database with all four migrations applied, run `psql -X -v ON_ERROR_STOP=1 -d <database> -f services/api/tests/schema.sql`. The checks roll back their sample data.

## Run the admin foundation locally

Docker Compose supplies PostgreSQL 16, Node.js 22 and the React development server. No host Node or PostgreSQL installation is required.

```bash
docker compose up -d
curl -fsS http://localhost:3000/api/health
```

The API applies pending migrations on startup. Create the **first** administrator and its disabled initial store once, using actual local store details and a password of at least 12 characters. The bootstrap refuses to overwrite an existing administrator. Run from the repository root:

```bash
export ADMIN_LOGIN=owner
export ADMIN_STORE_NAME='Your first Nagpur store'
export ADMIN_STORE_ADDRESS='Your store address'
export ADMIN_STORE_PHONE='Your store contact number'
read -rs -p 'Admin password: ' ADMIN_PASSWORD; echo
export ADMIN_PASSWORD
docker compose exec -T -e ADMIN_LOGIN -e ADMIN_PASSWORD -e ADMIN_STORE_NAME -e ADMIN_STORE_ADDRESS -e ADMIN_STORE_PHONE api npm run db:bootstrap
unset ADMIN_PASSWORD
```

Open the admin development server on port 5173, sign in, create the second store, configure each store's hours, pickup times, delivery coverage, rewards and offers, then enable ordering. Stores begin with ordering disabled. The admin module currently provides configuration, catalog, staff access and availability reads; order placement, OTP delivery and payment processing arrive with the store and consumer stages.

For a disposable test database, create it and run the integration suite:

```bash
docker compose exec -T db createdb -U grainbasket grainbasket_test
docker compose exec -T -e DATABASE_URL=postgres://grainbasket:localdev@db:5432/grainbasket_test api npm test
docker compose exec -T api npm run lint
docker compose exec -T api npm run typecheck
docker compose exec -T api npm run build
```

The test suite refuses to run against a database whose name does not end with `_test`; it clears only that disposable database's application tables. If the test database already exists, skip its creation. The legacy SQL smoke checks are separate and must also run only on a disposable database.

For deployment, serve the built admin site and `/api` under the same HTTPS origin through a reverse proxy. Set `NODE_ENV=production`, `PUBLIC_ORIGIN` to that HTTPS origin, `DATABASE_URL` to a private PostgreSQL connection and `SESSION_SECRET` to a random value of at least 32 characters; do not use Compose's local development values publicly. Keep API and database ports private, cap request sizes at the edge, and terminate TLS there. The production admin cookie is Secure, HttpOnly and SameSite=Lax; mutations require the session's CSRF token.
