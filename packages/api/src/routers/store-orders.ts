/**
 * Store back office: the order board, status transitions, and cash collection.
 *
 * Every mutation is a compare-and-set on the status that was read, then a
 * history row written in the same transaction. Two staff members tapping
 * "Packed" together produce one success and one conflict, not two history
 * entries and a duplicated downstream effect.
 */

import { z } from "zod";
import {
  AppError,
  ERROR_CODES,
  PERMISSIONS,
  businessDate,
  BUSINESS_TIMEZONE,
} from "@grain-basket/contracts";
import { transitionOrder, type OrderEvent } from "@grain-basket/core";
import { getDb } from "@grain-basket/db";
import { router, storeProcedure, storeProcedureWith } from "../procedures";

export const storeOrdersRouter = router({
  /** The order board. Filterable, and always scoped to this shop. */
  list: storeProcedure
    .input(
      z.object({
        status: z.string().optional(),
        fulfilment: z.enum(["DELIVERY", "PICKUP"]).optional(),
        paymentMethod: z.enum(["COD", "UPI", "CARD", "NETBANKING"]).optional(),
        search: z.string().trim().max(60).optional(),
        /** "today" limits to orders created in the current business day. */
        range: z.enum(["today", "week", "all"]).default("today"),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();

      const since =
        input.range === "today"
          ? new Date(`${businessDate(new Date(), BUSINESS_TIMEZONE)}T00:00:00.000Z`)
          : input.range === "week"
            ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            : undefined;

      const orders = await db.order.findMany({
        where: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.fulfilment ? { fulfilment: input.fulfilment } : {}),
          ...(since ? { createdAt: { gte: since } } : {}),
          ...(input.search
            ? {
                OR: [
                  { orderNumber: { contains: input.search, mode: "insensitive" } },
                  { contactName: { contains: input.search, mode: "insensitive" } },
                  { contactPhone: { contains: input.search } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        include: {
          items: {
            select: {
              productName: true,
              variantLabel: true,
              quantity: true,
              grindCode: true,
            },
          },
          payments: { select: { method: true, status: true } },
          _count: { select: { millingJobs: true } },
        },
      });

      return orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        fulfilment: order.fulfilment,
        totalPaise: order.totalPaise,
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        firstItem: order.items[0]
          ? `${order.items[0].productName} ${order.items[0].variantLabel}`
          : null,
        moreItems: Math.max(0, order.items.length - 1),
        contactName: order.contactName,
        contactPhone: order.contactPhone,
        paymentMethod: order.payments[0]?.method ?? null,
        isCod: order.payments.some((p) => p.method === "COD"),
        codCollectedPaise: order.codCollectedPaise,
        millingJobCount: order._count.millingJobs,
        readyAtEstimate: order.readyAtEstimate?.toISOString() ?? null,
        createdAt: order.createdAt.toISOString(),
      }));
    }),

  detail: storeProcedure
    .input(z.object({ orderNumber: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const order = await db.order.findFirst({
        where: { orderNumber: input.orderNumber },
        include: {
          items: { include: { millingJob: true } },
          statusHistory: { orderBy: { createdAt: "asc" } },
          payments: true,
          millingJobs: { include: { assignee: { select: { id: true, name: true } } } },
          cashCollection: { include: { collectedBy: { select: { id: true, name: true } } } },
        },
      });
      if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, "Order not found");

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        fulfilment: order.fulfilment,
        totals: {
          subtotalPaise: order.subtotalPaise,
          promotionDiscountPaise: order.promotionDiscountPaise,
          couponDiscountPaise: order.couponDiscountPaise,
          deliveryFeePaise: order.deliveryFeePaise,
          taxPaise: order.taxPaise,
          totalPaise: order.totalPaise,
        },
        couponCode: order.couponCode,
        contactName: order.contactName,
        contactPhone: order.contactPhone,
        address: order.addressSnapshot,
        pickupCode: order.pickupCode,
        notes: order.notes,
        internalNotes: order.internalNotes,
        readyAtEstimate: order.readyAtEstimate?.toISOString() ?? null,
        codCollectedPaise: order.codCollectedPaise,
        codCollectedAt: order.codCollectedAt?.toISOString() ?? null,
        items: order.items.map((item) => ({
          id: item.id,
          productName: item.productName,
          variantLabel: item.variantLabel,
          packWeightGrams: item.packWeightGrams,
          quantity: item.quantity,
          unitPricePaise: item.unitPricePaise,
          lineTotalPaise: item.lineTotalPaise,
          grindCode: item.grindCode,
          siftChoice: item.siftChoice,
          milledOn: item.milledOn?.toISOString() ?? null,
          millingJob: item.millingJob
            ? {
                id: item.millingJob.id,
                status: item.millingJob.status,
                mode: item.millingJob.mode,
                orderedInputGrams: item.millingJob.orderedInputGrams,
                actualInputGrams: item.millingJob.actualInputGrams,
                actualOutputGrams: item.millingJob.actualOutputGrams,
              }
            : null,
        })),
        millingJobs: order.millingJobs.map((job) => ({
          id: job.id,
          status: job.status,
          mode: job.mode,
          assignedTo: job.assignee,
          orderedInputGrams: job.orderedInputGrams,
          actualOutputGrams: job.actualOutputGrams,
          completedAt: job.completedAt?.toISOString() ?? null,
        })),
        payments: order.payments,
        cashCollection: order.cashCollection
          ? {
              amountPaise: order.cashCollection.amountPaise,
              expectedPaise: order.cashCollection.expectedPaise,
              collectedBy: order.cashCollection.collectedBy,
              collectedAt: order.cashCollection.createdAt.toISOString(),
              varianceNote: order.cashCollection.varianceNote,
            }
          : null,
        timeline: order.statusHistory.map((h) => ({
          fromStatus: h.fromStatus,
          toStatus: h.toStatus,
          at: h.createdAt.toISOString(),
          actorLabel: h.actorLabel,
          reason: h.reason,
        })),
        createdAt: order.createdAt.toISOString(),
      };
    }),

  /** Advance the order. The event, not the target status, is what's sent. */
  advance: storeProcedureWith(PERMISSIONS.ORDER_ADVANCE_STATUS)
    .input(
      z.object({
        orderNumber: z.string(),
        event: z.enum([
          "START_MILLING",
          "PACK",
          "DISPATCH",
          "DELIVER",
          "READY_FOR_PICKUP",
          "PICKUP_VERIFIED",
          "COMPLETE",
        ]),
        reason: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const order = await loadOrderForTransition(input.orderNumber);
      if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, "Order not found");

      const context = await transitionContext(order);

      // Pickup verification needs the code the customer shows at the counter.
      const event: OrderEvent =
        input.event === "PICKUP_VERIFIED"
          ? { type: "PICKUP_VERIFIED" }
          : ({ type: input.event } as OrderEvent);

      const result = transitionOrder(order.status as never, event, context);
      if (!result.ok) {
        throw new AppError(ERROR_CODES.INVALID_STATE_TRANSITION, result.message, {
          code: result.code,
        });
      }

      const updated = await db.order.updateMany({
        where: { id: order.id, status: order.status },
        data: {
          status: result.next,
          ...(result.next === "COMPLETED" ? { completedAt: new Date() } : {}),
          ...(result.next === "OUT_FOR_DELIVERY" || result.next === "READY_FOR_PICKUP"
            ? { readyAt: new Date() }
            : {}),
        },
      });
      if (updated.count !== 1) {
        throw new AppError(ERROR_CODES.CONFLICT, "Another staff member just changed this order");
      }

      await db.orderStatusHistory.create({
        data: {
          shopId: order.shopId,
          orderId: order.id,
          fromStatus: order.status,
          toStatus: result.next,
          actorUniverse: "STORE",
          actorId: ctx.auth.storeUserId,
          actorLabel: ctx.membership.role,
          reason: input.reason ?? null,
        },
      });

      return { status: result.next };
    }),

  /**
   * Cash handed over at the counter or door.
   *
   * This is the requirement in the user's own words — whoever physically hands
   * the goods over records the money. It is a separate permission from viewing
   * earnings, and it records WHO took the cash so a shortage is traceable.
   *
   * A short payment is recorded, not rounded: `varianceNote` is required when
   * the amount differs, because silently accepting ₹480 on a ₹500 order is how
   * a till loses money invisibly.
   */
  collectCash: storeProcedureWith(PERMISSIONS.COD_COLLECT)
    .input(
      z.object({
        orderNumber: z.string(),
        amountPaise: z.number().int().min(0),
        varianceNote: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const order = await loadOrderForTransition(input.orderNumber);
      if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, "Order not found");

      const isCod = order.payments.some((p) => p.method === "COD" && p.status !== "CAPTURED");
      if (!isCod) {
        throw new AppError(
          ERROR_CODES.CASH_COLLECTION_NOT_ALLOWED,
          "This order is already paid — nothing to collect",
        );
      }
      if (order.status !== "COD_PENDING") {
        throw new AppError(
          ERROR_CODES.CASH_COLLECTION_NOT_ALLOWED,
          `No cash is due on a ${order.status} order`,
        );
      }
      if (input.amountPaise !== order.totalPaise && !input.varianceNote) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          "A short or excess payment needs a note explaining it",
        );
      }

      const base = getDb();
      await base.$transaction(async (tx) => {
        const moved = await tx.order.updateMany({
          where: { id: order.id, status: "COD_PENDING" },
          data: {
            status: "COD_COLLECTED",
            codCollectedPaise: input.amountPaise,
            codCollectedById: ctx.auth.storeUserId,
            codCollectedAt: new Date(),
            codVarianceNote: input.varianceNote ?? null,
          },
        });
        if (moved.count !== 1) {
          throw new AppError(ERROR_CODES.CONFLICT, "This order was just settled by someone else");
        }

        await tx.cashCollection.create({
          data: {
            shopId: order.shopId,
            orderId: order.id,
            amountPaise: input.amountPaise,
            expectedPaise: order.totalPaise,
            collectedById: ctx.auth.storeUserId,
            varianceNote: input.varianceNote ?? null,
          },
        });

        await tx.orderStatusHistory.create({
          data: {
            shopId: order.shopId,
            orderId: order.id,
            fromStatus: "COD_PENDING",
            toStatus: "COD_COLLECTED",
            actorUniverse: "STORE",
            actorId: ctx.auth.storeUserId,
            actorLabel: ctx.membership.role,
            reason:
              input.amountPaise === order.totalPaise
                ? "Cash collected"
                : `Cash collected with variance: ${input.varianceNote}`,
          },
        });
      });

      return { status: "COD_COLLECTED", collectedPaise: input.amountPaise };
    }),

  /**
   * Daily cash reconciliation: who collected what. Restricted to the people
   * who can see earnings — the staff who collected cash specifically cannot.
   */
  cashReconciliation: storeProcedureWith(PERMISSIONS.EARNINGS_VIEW)
    .input(z.object({ date: z.string().optional() }))
    .query(async ({ input }) => {
      const db = getDb();
      const day = input.date ?? businessDate(new Date(), BUSINESS_TIMEZONE);
      const start = new Date(`${day}T00:00:00.000Z`);
      const end = new Date(`${day}T23:59:59.999Z`);

      const collections = await db.cashCollection.findMany({
        where: { createdAt: { gte: start, lte: end } },
        include: {
          collectedBy: { select: { id: true, name: true } },
          order: { select: { orderNumber: true, totalPaise: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      const byCollector = new Map<
        string,
        { name: string; collectedPaise: number; expectedPaise: number; count: number; variances: string[] }
      >();

      let totalCollected = 0;
      let totalExpected = 0;

      for (const row of collections) {
        const key = row.collectedById ?? "unknown";
        const entry = byCollector.get(key) ?? {
          name: row.collectedBy?.name ?? "Unattributed",
          collectedPaise: 0,
          expectedPaise: 0,
          count: 0,
          variances: [],
        };
        entry.collectedPaise += row.amountPaise;
        entry.expectedPaise += row.expectedPaise;
        entry.count += 1;
        if (row.varianceNote) {
          entry.variances.push(`${row.order.orderNumber}: ${row.varianceNote}`);
        }
        byCollector.set(key, entry);
        totalCollected += row.amountPaise;
        totalExpected += row.expectedPaise;
      }

      return {
        date: day,
        totalCollectedPaise: totalCollected,
        totalExpectedPaise: totalExpected,
        variancePaise: totalCollected - totalExpected,
        byCollector: [...byCollector.entries()].map(([id, entry]) => ({
          collectedById: id,
          ...entry,
          variancePaise: entry.collectedPaise - entry.expectedPaise,
        })),
        collections: collections.map((row) => ({
          orderNumber: row.order.orderNumber,
          amountPaise: row.amountPaise,
          expectedPaise: row.expectedPaise,
          collectedBy: row.collectedBy?.name ?? "Unattributed",
          collectedAt: row.createdAt.toISOString(),
          varianceNote: row.varianceNote,
        })),
      };
    }),

  /** Verify a pickup code at the counter. */
  verifyPickupCode: storeProcedureWith(PERMISSIONS.PICKUP_VERIFY)
    .input(z.object({ orderNumber: z.string(), code: z.string().trim().min(4).max(10) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const order = await db.order.findFirst({ where: { orderNumber: input.orderNumber } });
      if (!order || order.fulfilment !== "PICKUP") {
        throw new AppError(ERROR_CODES.NOT_FOUND, "Pickup order not found");
      }
      if (!order.pickupCode || order.pickupCode.toUpperCase() !== input.code.toUpperCase()) {
        throw new AppError(ERROR_CODES.PICKUP_CODE_INVALID, "That code doesn't match");
      }
      return { ok: true, status: order.status };
    }),

  addNote: storeProcedureWith(PERMISSIONS.ORDER_ADD_NOTE)
    .input(z.object({ orderNumber: z.string(), note: z.string().trim().min(1).max(500) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const order = await db.order.findFirst({ where: { orderNumber: input.orderNumber } });
      if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, "Order not found");
      await db.order.update({
        where: { id: order.id },
        data: {
          internalNotes: order.internalNotes
            ? `${order.internalNotes}\n${new Date().toISOString()}: ${input.note}`
            : input.note,
        },
      });
      return { ok: true };
    }),
});

async function loadOrderForTransition(orderNumber: string) {
  const db = getDb();
  return db.order.findFirst({
    where: { orderNumber },
    include: {
      items: true,
      payments: true,
      millingJobs: true,
    },
  });
}

async function transitionContext(order: Awaited<ReturnType<typeof loadOrderForTransition>>) {
  if (!order) throw new Error("order required");
  const incompleteMillingJobs = order.millingJobs.filter((job) => job.status !== "COMPLETED").length;
  const isPrepaid = order.payments.some((p) => p.status === "CAPTURED");
  const codOutstandingPaise = isPrepaid ? 0 : order.totalPaise - (order.codCollectedPaise ?? 0);

  return {
    fulfilment: order.fulfilment as "DELIVERY" | "PICKUP",
    paymentMethod: (order.payments[0]?.method ?? "COD") as never,
    incompleteMillingJobs,
    hasMillingItems: order.millingJobs.length > 0,
    isPrepaid,
    codOutstandingPaise,
  };
}
