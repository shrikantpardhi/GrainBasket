/**
 * The root router. Everything the web app (and later the Expo app) calls.
 */

import { z } from "zod";
import { assertUniversesDistinct, getUniverseConfigs } from "@grain-basket/auth";
import { assertFailClosed } from "@grain-basket/db";
import { getBaseClient } from "@grain-basket/db";
import { createCallerFactory, publicProcedure, router } from "./procedures";
import { authRouter } from "./routers/auth";
import { catalogueRouter } from "./routers/catalogue";
import { cartRouter } from "./routers/cart";
import { checkoutRouter } from "./routers/checkout";
import { ordersRouter } from "./routers/orders";
import { storeOrdersRouter } from "./routers/store-orders";

export const appRouter = router({
  auth: authRouter,
  catalogue: catalogueRouter,
  cart: cartRouter,
  checkout: checkoutRouter,
  orders: ordersRouter,
  admin: router({
    orders: storeOrdersRouter,
  }),

  /** Liveness + the boot canary. */
  health: publicProcedure.query(async () => {
    return { ok: true, at: new Date().toISOString() };
  }),
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);

/**
 * Run once at process start (the Next instrumentation hook calls this).
 *
 * Both assertions are the difference between a security boundary and a
 * comment. If the tenant extension is not installed, or two auth universes
 * share a secret, the app must not serve a single request.
 */
export function runBootAssertions(): void {
  assertUniversesDistinct(getUniverseConfigs());
  assertFailClosed(() => {
    // A tenant model, queried with no scope. Must throw.
    return (getBaseClient() as unknown as {
      product: { findMany: () => unknown };
    }).product.findMany();
  });
}

export const healthInput = z.object({});
