# GrainBasket product documents

GrainBasket starts with one store in Nagpur: customers order freshly milled flour and rice for pickup or local delivery. These documents are the agreed Phase 1 scope and the defined Phase 2 plan. Store hours and reward values are configured in the admin panel; the payment gateway is selected during implementation.

| Read | Purpose |
| --- | --- |
| [Phase 1 business specification](docs/phase-1.md) | One Nagpur store, flour/rice pickup timing, three languages and apps, cash/online staff orders and purchase rewards. **Source of truth for Phase 1 scope.** |
| [Implementation roadmap](docs/implementation-roadmap.md) | Build order: admin, store, then consumer; shared backend work and release checks for each stage. |
| [Consumer Android](docs/consumer.md) | Browse, checkout, payment and order tracking acceptance checks. |
| [Store Android](docs/store.md) | Staff order entry, cash/online payment, paid order queue, preparation, handover and stock checks. |
| [Admin web](docs/admin.md) | Store, catalog, translations, accounts and refund acceptance checks. |
| [Shared operations and data](docs/operations.md) | Fulfillment/payment rules, confirmed technology stack, one database and security baseline. |
| [Phase 2 specification](docs/phase-2.md) | Second-store expansion, entry criteria and future iOS compatibility. |

Read the Phase 1 specification first. The three applications share a backend and PostgreSQL database; only the backend connects to the database. The roadmap sets implementation order; the application and operations specifications define behavior. The seven root-level versioned specifications were consolidated into the six specification documents above; the originals remain available in Git history on `shrikantpardhi-patch-1`.