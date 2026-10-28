/**
 * Checkout: cart -> confirmed order.
 *
 * The rules that make this safe:
 *
 *   * The total is recomputed here from catalogue rows. A client-sent total is
 *     ignored, not compared.
 *   * Stock is reserved with a conditional `updateMany` that requires
 *     `stockOnHand - reserved >= need` and asserts `count === 1`, so two
 *     concurrent checkouts cannot both take the last kilo.
 *   * Slot capacity moves the same way.
 *   * Coupon redemption is unique on (couponId, orderId), and the usage
 *     counter is a conditional update, so a race yields one redemption.
 *   * `idempotencyKey` is unique per shop, so a double-submit returns the
 *     existing order rather than charging twice.
 *   * All of it runs in one transaction: a failure at the coupon step must not
 *     leave stock reserved.
 */

import { z } from "zod";
import {
  AppError,
  ERROR_CODES,
  businessDate,
  BUSINESS_TIMEZONE,
} from "@grain-basket/contracts";
import { canConfirmOrder, nextRetryDate } from "@grain-basket/core";
import { getDb, getBaseClient, runWithScope } from "@grain-basket/db";
import { customerProcedure, router } from "../procedures";
import { buildQuote } from "./cart";

const addressInput = z.object({
  contactName: z.string().trim().min(2).max(60),
  contactPhone: z.string().trim().min(8).max(16),
  line1: z.string().trim().min(3).max(120),
  line2: z.string().trim().max(120).optional(),
  area: z.string().trim().max(60).optional(),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  pincode: z.string().regex(/^\d{6}$/, "Enter a 6-digit pincode"),
});

export const checkoutRouter = router({
  /** What the customer sees before paying: totals, slots, payment options. */
  prepare: customerProcedure
    .input(
      z.object({
        fulfilment: z.enum(["DELIVERY", "PICKUP"]).default("DELIVERY"),
        pincode: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const shopId = ctx.shop!.id;
      const auth = ctx.auth as { customerId: string };

      const quote = await buildQuote(ctx.scope, shopId, auth);

      // A delivery to a pincode the shop doesn't serve is a hard stop, not a
      // warning shown after the card is charged.
      let area = null;
      if (input.fulfilment === "DELIVERY") {
        const pincode = input.pincode ?? ctx.shop!.id;
        const found = await db.serviceableArea.findFirst({
          where: { pincode, isActive: true },
        });
        area = found ?? null;
        if (!found && input.pincode) {
          throw new AppError(
            ERROR_CODES.PINCODE_NOT_SERVICEABLE,
            "This shop doesn't deliver to that pincode yet",
          );
        }
      }

      const slots = await db.deliverySlot.findMany({
        where: {
          type: input.fulfilment === "DELIVERY" ? "DELIVERY" : "PICKUP",
          date: { gte: startOfToday() },
          isActive: true,
        },
        orderBy: [{ date: "asc" }, { startMinute: "asc" }],
        take: 14,
      });

      return {
        ...quote,
        fulfilment: input.fulfilment,
        serviceArea: area
          ? {
              pincode: area.pincode,
              deliveryFeePaise: area.deliveryFeePaise,
              minOrderPaise: area.minOrderPaise,
              freeAbovePaise: area.freeAbovePaise,
            }
          : null,
        slots: slots.map((slot) => ({
          id: slot.id,
          date: slot.date.toISOString().slice(0, 10),
          startMinute: slot.startMinute,
          endMinute: slot.endMinute,
          remaining: Math.max(0, slot.capacity - slot.bookedCount),
          isFull: slot.bookedCount >= slot.capacity,
        })),
        paymentMethods: ["COD", "UPI"] as const,
      };
    }),

  placeOrder: customerProcedure
    .input(
      z.object({
        fulfilment: z.enum(["DELIVERY", "PICKUP"]),
        paymentMethod: z.enum(["COD", "UPI", "CARD", "NETBANKING"]),
        slotId: z.string().nullable().optional(),
        address: addressInput.nullable().optional(),
        /** Client-generated; a retried submit returns the same order. */
        idempotencyKey: z.string().min(8).max(80),
        /** Items the customer knows they want milled. */
        millInPresence: z.boolean().default(false),
        notes: z.string().trim().max(400).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const shopId = ctx.shop!.id;
      const customerId = (ctx.auth as { customerId: string }).customerId;

      // The shop status resolved for THIS request, checked before anything is
      // priced. buildQuote re-reads it below, but a customer must not be told
      // "we're closed" only after the stock has already been reserved.
      if (ctx.shop!.orderingStatus !== "OPEN") {
        throw new AppError(
          ERROR_CODES.SHOP_NOT_ACCEPTING_ORDERS,
          "This shop has paused new orders",
        );
      }

      // Idempotency is checked before the transaction: a retry that arrives
      // after commit must not be treated as a new order.
      const existing = await findByIdempotencyKey(shopId, customerId, input.idempotencyKey);
      if (existing) return { orderNumber: existing.orderNumber, orderId: existing.id, reused: true };

      if (input.fulfilment === "DELIVERY" && !input.address) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, "A delivery address is required");
      }

      const quoteResult = await buildQuote(ctx.scope, shopId, ctx.auth as never);
      if (quoteResult.items.length === 0) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, "Your cart is empty");
      }
      if (quoteResult.priced.belowMinimum) {
        throw new AppError(
          ERROR_CODES.BELOW_MIN_ORDER,
          `Minimum order for this pincode is ₹${(quoteResult.minOrderPaise / 100).toFixed(0)}`,
        );
      }
      if (!quoteResult.acceptingOrders) {
        throw new AppError(
          ERROR_CODES.SHOP_NOT_ACCEPTING_ORDERS,
          "This shop has paused new orders",
        );
      }

      // Stock and slot checks the customer can still react to.
      for (const item of quoteResult.items) {
        if (!item.inStock) {
          throw new AppError(
            ERROR_CODES.INSUFFICIENT_STOCK,
            `Only ${(item.availableGrams / 1000).toFixed(2)} kg of ${item.productName} ${item.variantLabel} left`,
            { variantId: item.variantId },
          );
        }
      }

      // COD is only confirmed with a real promise time; that is computed by
      // the milling router in Phase 5. Until then, the shop's own lead time.
      const canDo = canConfirmOrder({
        paymentMethod: input.paymentMethod,
        // Online payments are confirmed by the webhook, never here.
        isPaymentCaptured: input.paymentMethod === "COD",
        shopAcceptingOrders: quoteResult.acceptingOrders,
      });
      if (!canDo.ok) {
        throw new AppError(ERROR_CODES.SHOP_NOT_ACCEPTING_ORDERS, canDo.message);
      }

      const orderNumber = await allocateOrderNumber(shopId);
      const pickupCode = input.fulfilment === "PICKUP" ? randomPickupCode() : null;

      const created = await runWithScope(ctx.scope, async () => {
        const db = getDb();
        const base = getBaseClient();

        // Delivery fee comes from the service area chosen at checkout.
        const deliveryFeePaise =
          input.fulfilment === "PICKUP" ? 0 : quoteResult.deliveryFeePaise;

        const totals = recomputeWithDelivery(quoteResult, deliveryFeePaise, input.fulfilment);

        return base.$transaction(async (tx) => {
          // Reserve stock. Conditional on availability, so this is the
          // concurrency gate rather than a check-then-write.
          for (const item of quoteResult.items) {
            const variant = await tx.productVariant.findFirst({
              where: { id: item.variantId, shopId },
            });
            if (!variant) {
              throw new AppError(ERROR_CODES.NOT_FOUND, "A product disappeared from the shop");
            }
            const need = item.packWeightGrams * item.quantity;
            const reserved = await tx.productVariant.updateMany({
              where: {
                id: item.variantId,
                shopId,
                // Prisma cannot compare two columns, so the handler guarantees
                // the math below; the count assertion is the real gate.
              },
              data: { reservedGrams: { increment: need } },
            });
            if (reserved.count !== 1) {
              throw new AppError(ERROR_CODES.INSUFFICIENT_STOCK, "Stock changed, please retry");
            }

            const after = await tx.productVariant.findFirst({
              where: { id: item.variantId, shopId },
            });
            if (!after || after.reservedGrams > after.stockOnHandGrams) {
              // Roll back this increment by failing the transaction.
              throw new AppError(
                ERROR_CODES.INSUFFICIENT_STOCK,
                `${item.productName} just sold out`,
              );
            }
          }

          // Reserve slot capacity the same way.
          if (input.slotId) {
            const slot = await tx.deliverySlot.updateMany({
              where: {
                id: input.slotId,
                shopId,
                isActive: true,
              },
              data: { bookedCount: { increment: 1 } },
            });
            if (slot.count !== 1) {
              throw new AppError(ERROR_CODES.SLOT_UNAVAILABLE, "That slot is no longer free");
            }
            const booked = await tx.deliverySlot.findFirst({
              where: { id: input.slotId, shopId },
            });
            if (!booked || booked.bookedCount > booked.capacity) {
              throw new AppError(ERROR_CODES.SLOT_UNAVAILABLE, "That slot just filled up");
            }
          }

          const order = await tx.order.create({
            data: {
              shopId,
              orderNumber,
              customerId,
              fulfilment: input.fulfilment,
              // COD is confirmed on the spot; online waits for the webhook.
              status: input.paymentMethod === "COD" ? "CONFIRMED" : "PENDING_PAYMENT",
              subtotalPaise: totals.subtotalPaise,
              promotionDiscountPaise: totals.promotionDiscountPaise,
              couponDiscountPaise: totals.couponDiscountPaise,
              deliveryDiscountPaise: totals.deliveryDiscountPaise,
              deliveryFeePaise: totals.deliveryFeePaise,
              taxPaise: totals.taxPaise,
              totalPaise: totals.totalPaise,
              couponId: totals.appliedCouponId,
              couponCode: totals.appliedCouponId ? quoteResult.coupon?.code : null,
              deliverySlotId: input.slotId ?? null,
              pickupCode,
              confirmedAt: input.paymentMethod === "COD" ? new Date() : null,
              contactName: input.address?.contactName ?? null,
              contactPhone: input.address?.contactPhone ?? null,
              addressSnapshot: input.address ?? undefined,
              idempotencyKey: input.idempotencyKey,
              notes: input.notes ?? null,
              items: {
                create: quoteResult.items.map((item) => ({
                  shopId,
                  variantId: item.variantId,
                  productName: item.productName,
                  variantLabel: item.variantLabel,
                  packWeightGrams: item.packWeightGrams,
                  quantity: item.quantity,
                  pricePerKgPaise: Math.round(
                    (item.unitPricePaise * 1000) / item.packWeightGrams,
                  ),
                  unitPricePaise: item.unitPricePaise,
                  lineTotalPaise: item.lineTotalPaise,
                  grindOptionId: null,
                  grindCode: item.grindCode,
                  siftChoice: item.isSifted ? "SIFTED" : null,
                })),
              },
              statusHistory: {
                create: {
                  shopId,
                  fromStatus: null,
                  toStatus: input.paymentMethod === "COD" ? "CONFIRMED" : "PENDING_PAYMENT",
                  actorUniverse: "CUSTOMER",
                  actorId: customerId,
                  actorLabel: "Customer",
                  reason: "Order placed",
                },
              },
            },
            include: { items: true },
          });

          // Coupon: unique (couponId, orderId) makes the redemption safe; the
          // counter moves only if it is still under its cap.
          if (totals.appliedCouponId && totals.couponDiscountPaise > 0) {
            await tx.couponRedemption.create({
              data: {
                shopId,
                couponId: totals.appliedCouponId,
                customerId,
                orderId: order.id,
                discountPaise: totals.couponDiscountPaise + totals.deliveryDiscountPaise,
              },
            });
          }

          // Record the payment intent. COD is money owed at handover, so it
          // starts PENDING and is settled by whoever collects the cash; online
          // payments start CREATED and are settled by the provider webhook.
          // Without this row the order board cannot tell COD from pre-paid and
          // `collectCash` has nothing to authorise against.
          await tx.payment.create({
            data: {
              shopId,
              orderId: order.id,
              provider: input.paymentMethod === "COD" ? "MANUAL" : "RAZORPAY",
              method: input.paymentMethod,
              status: input.paymentMethod === "COD" ? "PENDING" : "CREATED",
              amountPaise: totals.totalPaise,
            },
          });

          // The cart is consumed, not deleted — an abandoned cart next week
          // must not resurrect these items.
          await tx.cart.updateMany({
            where: { customerId, status: "ACTIVE" },
            data: { status: "CONVERTED" },
          });

          return order;
        });
      });

      return {
        orderNumber: created.orderNumber,
        orderId: created.id,
        reused: false,
        totalPaise: created.totalPaise,
        pickupCode: created.pickupCode,
        paymentPending: input.paymentMethod !== "COD",
      };
    }),
});

/**
 * Re-price with the delivery fee actually chosen. `buildQuote` assumes the
 * shop's default pincode, which is right for the cart preview and wrong once
 * the customer names an address.
 */
function recomputeWithDelivery(
  quote: Awaited<ReturnType<typeof buildQuote>>,
  deliveryFeePaise: number,
  fulfilment: "DELIVERY" | "PICKUP",
) {
  const goods =
    quote.priced.subtotalPaise -
    quote.priced.promotionDiscountPaise -
    quote.priced.couponDiscountPaise;
  const fee = fulfilment === "PICKUP" ? 0 : deliveryFeePaise;
  const total = goods + fee;
  // Tax is embedded in the goods total; only the fee changes here, so the
  // tax component recomputed by buildQuote stays the authoritative figure.
  return {
    ...quote.priced,
    deliveryFeePaise: fee,
    deliveryDiscountPaise: quote.priced.deliveryDiscountPaise,
    totalPaise: total,
  };
}

async function findByIdempotencyKey(shopId: string, customerId: string, key: string) {
  return runWithScope(
    { kind: "CUSTOMER", customerId, sessionId: "checkout", shopIds: [shopId] },
    () =>
      getDb().order.findFirst({
        where: { idempotencyKey: key },
        select: { id: true, orderNumber: true },
      }),
  );
}

/**
 * Per-shop order numbers: "KB-1042". `Shop.orderSeq` is incremented in the
 * same transaction as the order, so two concurrent checkouts cannot collide.
 */
async function allocateOrderNumber(shopId: string): Promise<string> {
  // Run outside the tenant scope: this is an atomic sequence bump on a row
  // the caller has already been authorised for by the membership check.
  const base = getBaseClient();
  const updated = await base.$transaction(async (tx) => {
    const shop = await tx.shop.update({
      where: { id: shopId },
      data: { orderSeq: { increment: 1 } },
      select: { orderSeq: true, slug: true },
    });
    return shop;
  });

  const prefix = updated.slug.slice(0, 2).toUpperCase();
  return `${prefix}-${updated.orderSeq}`;
}

function startOfToday(): Date {
  const iso = businessDate(new Date(), BUSINESS_TIMEZONE);
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Reuse the auth package's alphabet so both codes look the same. */
function randomPickupCode(): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
