# GrainBasket product documents

GrainBasket starts with one store in Nagpur: customers order freshly milled flour and other staple foods for pickup or local delivery. These documents describe a deliberately small first release, not a finished application or database migration.

| Read | Purpose |
| --- | --- |
| [Phase 1 business specification](docs/phase-1.md) | One Nagpur store, flour/rice pickup timing, three languages and apps, cash/online staff orders and purchase rewards. **Source of truth for Phase 1 scope.** |
| [Consumer Android](docs/consumer.md) | Browse, checkout, payment and order tracking acceptance checks. |
| [Store Android](docs/store.md) | Staff order entry, cash/online payment, paid order queue, preparation, handover and stock checks. |
| [Admin web](docs/admin.md) | Store, catalog, translations, accounts and refund acceptance checks. |
| [Shared operations and data](docs/operations.md) | Fulfillment/payment rules, one database and security baseline. |
| [Phase 2 specification](docs/phase-2.md) | Second-store expansion, entry criteria and optional improvements. |
| [Gaps and roadmap](docs/gaps.md) | Conflicts found in the original specifications, open business decisions and later phases. |

Read the Phase 1 specification first. The three applications share a backend and PostgreSQL database; only the backend connects to the database. When a later document disagrees with Phase 1, update it and then the dependent document. The seven root-level versioned specifications were consolidated into these seven documents; the originals remain available in Git history on `shrikantpardhi-patch-1`.