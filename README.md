# GrainBasket product documents

GrainBasket starts with one store in Nagpur: customers order freshly milled flour and rice for pickup or local delivery. These documents are the agreed Phase 1 scope and the defined Phase 2 plan. Store hours and reward values are configured in the admin panel; the payment gateway is selected during implementation.

| Read | Purpose |
| --- | --- |
| [Phase 1 business specification](docs/phase-1.md) | One Nagpur store, flour/rice pickup timing, three languages and apps, cash/online staff orders and purchase rewards. **Source of truth for Phase 1 scope.** |
| [Implementation roadmap](docs/implementation-roadmap.md) | Build order: admin, store, then consumer; shared backend work and release checks for each stage. |
| [Implementation tasks](docs/implementation-tasks.md) | Actionable admin, store and consumer work with shared API dependencies and completion checks. |
| [Consumer Android](docs/consumer.md) | Browse, checkout, payment and order tracking acceptance checks. |
| [Store Android](docs/store.md) | Staff order entry, cash/online payment, paid order queue, preparation, handover and stock checks. |
| [Admin web](docs/admin.md) | Store, catalog, translations, accounts and refund acceptance checks. |
| [Shared operations and data](docs/operations.md) | Fulfillment/payment rules, confirmed technology stack, one database and security baseline. |
| [Initial PostgreSQL schema](services/api/migrations/001_phase1.sql) | Phase 1 tables, relationships and constraints; apply once to a new database. |
| [Phase 2 store offers migration](services/api/migrations/002_phase2_store_offers.sql) | Per-store price, sellable stock and active status for the second-store pilot. |
| [Schema smoke checks](services/api/tests/schema.sql) | Disposable data checks for customer, store and admin records, refunds and store-specific relationships after both migrations. |
| [Phase 2 specification](docs/phase-2.md) | Second-store expansion, entry criteria and future iOS compatibility. |

Read the Phase 1 specification first. The three applications share a backend and PostgreSQL database; only the backend connects to the database. The roadmap defines the monorepo folders and implementation order; the application and operations specifications define behavior. The seven root-level versioned specifications were consolidated into the six specification documents above; the originals remain available in Git history on `shrikantpardhi-patch-1`.

To create the Phase 1 tables in a fresh PostgreSQL database, run `psql -X -v ON_ERROR_STOP=1 -d <database> -f services/api/migrations/001_phase1.sql`. The script creates no users, store schedule, reward values or payment-provider configuration. The API must validate business rules and use transactions for checkout, stock, payment and points changes.

For the later second-store pilot, apply `002_phase2_store_offers.sql` after `001_phase1.sql` and alongside the corresponding API changes. With existing variants, it requires exactly one Phase 1 store, transfers its variant price/stock/activity into store offers, and removes those fields from the shared variants. Back up an existing database before applying it; create the second store and its offers only after migration. Do not apply the Phase 2 migration to a running Phase 1 application until it reads and writes store offers.

To check a **disposable** PostgreSQL database, apply both migrations in order and run `psql -X -v ON_ERROR_STOP=1 -d <database> -f services/api/tests/schema.sql`. The checks insert sample records inside a transaction that rolls back; they require an otherwise empty database.

## Application data coverage

| Application flow | Stored by the migrations | Backend responsibility |
| --- | --- | --- |
| Consumer | Catalog/UI translations, OTP challenges and sessions, customer/order ownership, delivery and flour timing snapshots, payment attempts, marketing choices and reward history. | Verify OTP and payment callbacks, validate schedule/availability and quotes, restrict reads to the customer, and calculate points. |
| Store | Staff sessions, cash collections and online attempts, fulfillment/arrival/estimate history, stock reservations and reasoned corrections. | Authorize active staff for the store; serialize checkout, stock and points changes; enforce status transitions and refund initiation. |
| Admin | Store schedules, pickup slots, delivery fees/coverage, catalog and translations, staff roles, reward settings, payment/refund records and attributed reward corrections. | Restrict admin actions, validate flour/rice variant details, reconcile payments and cash refunds, and apply approved reward/refund policy. |
| Second store | Per-store offers, order/item/store links, staff-created order and arrival ownership, and order-bound reward store ownership. | Use offers for quotes and inventory; restrict all other store actions by role/store and reject mixed-store carts. |

Database constraints protect relationships and field combinations; they do not establish that an order is paid, stock is reserved, an OTP was delivered, or an actor is authorized. Tax/receipt requirements, reward rates, post-completion refund policy and the payment provider still need business/implementation decisions before launch.
