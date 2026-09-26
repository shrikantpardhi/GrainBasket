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
| [Schema smoke checks](services/api/tests/schema.sql) | Disposable checks for two-store relationships, OTP request boundaries, payments/refunds and customer ownership. |

The first two migration filenames retain their historical Phase 1/Phase 2 names. **For a fresh v1.0 database apply all three, in order, before creating either store, catalog variants or offers:**

```bash
psql -X -v ON_ERROR_STOP=1 -d <database> -f services/api/migrations/001_phase1.sql
psql -X -v ON_ERROR_STOP=1 -d <database> -f services/api/migrations/002_phase2_store_offers.sql
psql -X -v ON_ERROR_STOP=1 -d <database> -f services/api/migrations/003_v1_otp_and_store_audit.sql
```

These scripts create no stores, users, schedule, rewards configuration or provider settings. Configure both stores and their offers via admin after migration; the API must read and write `store_variant_offers`. An existing populated one-store database needs a backup and a coordinated API migration; the store-offer backfill requires exactly one existing store when variants exist. The third migration backfills any existing OTP request times and store identities for payment and audit records; inconsistent legacy attribution needs correction before it can apply. The applications access PostgreSQL only through authorized APIs; the API must atomically claim a row in `otp_request_cooldowns` before creating a challenge and initiating SMS. Business transactions, payment verification and other authorization remain backend responsibilities.

For a **disposable, otherwise empty** database with all three migrations applied, run `psql -X -v ON_ERROR_STOP=1 -d <database> -f services/api/tests/schema.sql`. The checks roll back their sample data.
