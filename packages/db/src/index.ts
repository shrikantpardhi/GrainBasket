export { getDb, getBaseClient, type Db } from "./client";
export {
  runWithScope,
  getScope,
  requireScope,
  allowedShopIds,
  customerIdForScope,
  scopeCoversShop,
  toStoreScope,
  toCustomerScope,
  toPublicScope,
  assertFailClosed,
  MissingScopeError,
  type Scope,
  type StoreScope,
  type CustomerScope,
  type PlatformScope,
  type PublicScope,
  type SystemScope,
} from "./scope";
export { tenantExtension, TENANT_MODELS, CUSTOMER_MODELS, GLOBAL_SHARED_MODELS } from "./tenant";
export { Prisma, PrismaClient } from "./generated/prisma/client";
