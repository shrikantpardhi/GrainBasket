/**
 * Customer order history and the tracking timeline.
 *
 * Signed in, a customer reads their own orders through the tenant extension
 * (scope pins customerId). Signed out, they can still open a deep link from an
 * SMS — but only with the order number, and only the tracking summary. That
 * link is the difference between "your order is ready" working and a customer
 * needing an app install to find out.
 */

import { z } from "zod";
import { AppError, ERROR_CODES } from "@grain-basket/contracts";
import { nextStatuses } from "@grain-basket/core";
import { getDb, getBaseClient } from "@grain-basket/db";
import { customerProcedure, publicProcedure, router } from "../procedures";

export const ordersRouter = router({
  list: customerProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const orders = await db.order.findMany({
        orderBy: { createdAt: "desc" },
        take: input.limit,
        include: {
          items: { select: { productName: true, variantLabel: true, quantity: true } },
          shop: { select: { slug: true, name: true } },
        },
      });

      return orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        shopSlug: order.shop.slug,
        shopName: order.shop.name,
        status: order.status,
        fulfilment: order.fulfilment,
        totalPaise: order.totalPaise,
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        firstItemName: order.items[0]?.productName ?? null,
        moreItems: Math.max(0, order.items.length - 1),
        placedAt: order.createdAt.toISOString(),
        readyAtEstimate: order.readyAtEstimate?.toISOString() ?? null,
        /** The customer's next sensible action, if any. */
        canCancel:
          order.status !== "COMPLETED" &&
          order.status !== "CANCELLED" &&
          order.status !== "REFUNDED" &&
          nextStatuses(order.status as never).includes("CANCELLED"),
      }));
    }),

  byNumber: customerProcedure
    .input(z.object({ orderNumber: z.string() }))
    .query(async ({ input }) => {
      const order = await loadOrderByNumber(input.orderNumber);
      if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, "Order not found");
      return shapeOrderDetail(order);
    }),

  /**
   * Public tracking via a deep link. Takes the order number and the contact
   * phone, so a forwarded link alone isn't enough to read someone's address.
   */
  track: router({
    public: publicProcedure
      .input(z.object({ orderNumber: z.string(), phoneLast4: z.string().length(4) }))
      .query(async ({ input }) => {
        const base = getBaseClient();
        const order = await base.order.findFirst({
          where: { orderNumber: input.orderNumber },
          include: {
            shop: { select: { slug: true, name: true, phone: true } },
            items: { select: { productName: true, variantLabel: true, quantity: true } },
            statusHistory: { orderBy: { createdAt: "asc" } },
          },
        });
        if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, "Order not found");

        const phone = order.contactPhone ?? "";
        if (!phone.endsWith(input.phoneLast4)) {
          throw new AppError(ERROR_CODES.NOT_FOUND, "Order not found");
        }

        // The public view deliberately omits the address and the full phone.
        return {
          orderNumber: order.orderNumber,
          shop: { slug: order.shop.slug, name: order.shop.name, phone: order.shop.phone },
          status: order.status,
          fulfilment: order.fulfilment,
          totalPaise: order.totalPaise,
          readyAtEstimate: order.readyAtEstimate?.toISOString() ?? null,
          items: order.items,
          timeline: order.statusHistory.map((h) => ({
            status: h.toStatus,
            at: h.createdAt.toISOString(),
          })),
        };
      }),

    cancel: customerProcedure
      .input(z.object({ orderNumber: z.string(), reason: z.string().max(200).optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        const order = await db.order.findFirst({ where: { orderNumber: input.orderNumber } });
        if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, "Order not found");

        const allowed = nextStatuses(order.status as never).includes("CANCELLED");
        if (!allowed || order.status === "PICKED_UP" || order.status === "DELIVERED") {
          throw new AppError(
            ERROR_CODES.INVALID_STATE_TRANSITION,
            "This order can no longer be cancelled",
          );
        }

        // Compare-and-set: a shop packing the order at the same moment must
        // win or lose cleanly, never both succeed.
        const updated = await db.order.updateMany({
          where: { id: order.id, status: order.status },
          data: {
            status: "CANCELLED",
            cancelledReason: input.reason ?? "Cancelled by customer",
          },
        });
        if (updated.count !== 1) {
          throw new AppError(ERROR_CODES.CONFLICT, "The order changed, please refresh");
        }

        await db.orderStatusHistory.create({
          data: {
            shopId: order.shopId,
            orderId: order.id,
            fromStatus: order.status,
            toStatus: "CANCELLED",
            actorUniverse: "CUSTOMER",
            actorId: (ctx.auth as { customerId: string }).customerId,
            actorLabel: "Customer",
            reason: input.reason ?? null,
          },
        });

        // Release stock. The cart may already be converted, so this is the
        // only path that gives the weight back.
        const items = await db.orderItem.findMany({ where: { orderId: order.id } });
        for (const item of items) {
          if (!item.variantId) continue;
          await db.productVariant.updateMany({
            where: { id: item.variantId },
            data: {
              reservedGrams: { decrement: item.packWeightGrams * item.quantity },
            },
          });
        }

        // Release the coupon so the customer can use it again.
        await db.couponRedemption.updateMany({
          where: { orderId: order.id, voidedAt: null },
          data: { voidedAt: new Date() },
        });
        await db.coupon.updateMany({
          where: { id: order.couponId ?? "" },
          data: { totalUsed: { decrement: 1 } },
        });

        return { ok: true };
      }),
  }),
});

async function loadOrderByNumber(orderNumber: string) {
  const db = getDb();
  return db.order.findFirst({
    where: { orderNumber },
    include: {
      shop: { select: { slug: true, name: true, phone: true, line1: true, city: true } },
      items: true,
      statusHistory: { orderBy: { createdAt: "asc" } },
      millingJobs: true,
      payments: { select: { provider: true, method: true, status: true, amountPaise: true } },
    },
  });
}

function shapeOrderDetail(order: NonNullable<Awaited<ReturnType<typeof loadOrderByNumber>>>) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    shop: order.shop,
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
    readyAtEstimate: order.readyAtEstimate?.toISOString() ?? null,
    readyAt: order.readyAt?.toISOString() ?? null,
    pickupCode: order.pickupCode,
    address: order.addressSnapshot,
    contactName: order.contactName,
    contactPhone: order.contactPhone,
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
      /** The freshness badge — set when the mill actually finished. */
      milledOn: item.milledOn?.toISOString() ?? null,
    })),
    milling: order.millingJobs.map((job) => ({
      id: job.id,
      status: job.status,
      mode: job.mode,
      orderedInputGrams: job.orderedInputGrams,
      actualOutputGrams: job.actualOutputGrams,
      completedAt: job.completedAt?.toISOString() ?? null,
    })),
    timeline: order.statusHistory.map((h) => ({
      status: h.toStatus,
      at: h.createdAt.toISOString(),
      actorLabel: h.actorLabel,
      reason: h.reason,
    })),
    payments: order.payments,
    createdAt: order.createdAt.toISOString(),
  };
}
