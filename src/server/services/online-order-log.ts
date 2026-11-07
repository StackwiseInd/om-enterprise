import "server-only";
import { and, desc, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { auditLogs, onlineOrders } from "@/server/db/schema";
import { requirePermission, type Actor } from "@/server/auth/actor";

/**
 * The online orders log: every step of every website order, A to Z, from the append-only audit log. Placing,
 * paying (and every check with Razorpay), confirming, packing, handing over, cancelling, refunding and deleting:
 * who did it (customer, staff, Razorpay or the system), when, from which IP, and the full details recorded.
 * Deleted orders stay here with everything that was on them.
 */

export const LOG_GROUPS = {
  placed: { label: "Placed", actions: ["online_order.place"] },
  payment: {
    label: "Payments",
    actions: [
      "online_order.gateway_started",
      "online_order.gateway_retry",
      "online_order.gateway_start_failed",
      "online_order.payment_verified",
      "online_order.payment_failed",
      "online_order.payment_signature_invalid",
      "online_order.gateway_amount_mismatch",
      "online_order.utr_submitted",
      "online_order.utr_rejected",
      "online_order.late_payment",
    ],
  },
  progress: { label: "Confirmed, ready, handed over", actions: ["online_order.confirmed", "online_order.ready", "online_order.collected"] },
  cancel: { label: "Cancelled / expired", actions: ["online_order.cancel", "online_order.cancelled", "online_order.cancelled_by_customer", "online_order.expire"] },
  refund: { label: "Refunds", actions: ["online_order.refund_requested", "online_order.cancelled_by_customer", "online_order.refund_started", "online_order.refund_retry", "online_order.refund_failed", "online_order.refunded", "online_order.late_payment"] },
  deleted: { label: "Deleted", actions: ["online_order.deleted"] },
} as const;
export type LogGroup = keyof typeof LOG_GROUPS;

/** Short names for each step, as the log shows them. */
export const LOG_ACTION_LABEL: Record<string, string> = {
  "online_order.place": "Order placed",
  "online_order.gateway_started": "Payment window opened",
  "online_order.gateway_retry": "Payment tried again",
  "online_order.gateway_start_failed": "Payment couldn't start",
  "online_order.payment_verified": "Payment confirmed",
  "online_order.payment_failed": "Payment failed / not found",
  "online_order.payment_signature_invalid": "Bad payment signature",
  "online_order.gateway_amount_mismatch": "Amount mismatch",
  "online_order.utr_submitted": "UTR sent",
  "online_order.utr_rejected": "UTR refused",
  "online_order.late_payment": "Paid after closing",
  "online_order.confirmed": "Confirmed by shop",
  "online_order.ready": "Ready for pickup",
  "online_order.collected": "Handed over",
  "online_order.cancel": "Cancelled by customer",
  "online_order.cancelled": "Cancelled by staff",
  "online_order.cancelled_by_customer": "Cancelled by customer, refund",
  "online_order.expire": "Expired / timed out",
  "online_order.refund_requested": "Refund by staff",
  "online_order.refund_started": "Refund sent to Razorpay",
  "online_order.refund_retry": "Refund retried",
  "online_order.refund_failed": "Refund failed",
  "online_order.refunded": "Refund completed",
  "online_order.deleted": "Order deleted",
};

export interface LogQuery {
  q?: string;
  group?: LogGroup;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

const isOrderEvent = or(sql`${auditLogs.entityType} = 'online_order'`, ilike(auditLogs.action, "online\\_order.%"));

function conditions(opts: LogQuery): SQL {
  const c: (SQL | undefined)[] = [isOrderEvent];
  if (opts.group && LOG_GROUPS[opts.group]) c.push(inArray(auditLogs.action, [...LOG_GROUPS[opts.group].actions]));
  if (opts.from) c.push(gte(auditLogs.at, opts.from));
  if (opts.to) c.push(lt(auditLogs.at, opts.to));
  const term = opts.q?.trim().slice(0, 80);
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    const digits = term.replace(/\D/g, "");
    c.push(
      or(
        ilike(onlineOrders.orderNumber, like),
        ilike(onlineOrders.customerName, like),
        ilike(onlineOrders.mobile, digits.length >= 3 ? `%${digits}%` : like),
        ilike(onlineOrders.customerEmail, like),
        ilike(onlineOrders.gatewayTransactionId, like),
        ilike(onlineOrders.utr, like),
        ilike(onlineOrders.gatewayUtr, like),
        ilike(auditLogs.summary, like),
        ilike(auditLogs.actorLabel, like),
      ),
    );
  }
  return and(...c.filter((x): x is SQL => !!x))!;
}

export async function queryOnlineOrderLog(actor: Actor, opts: LogQuery = {}) {
  requirePermission(actor, "audit.view");
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, opts.pageSize ?? 50));
  const where = conditions(opts);
  const join = sql`${onlineOrders.id}::text = ${auditLogs.entityId}`;
  const items = await db
    .select({
      id: auditLogs.id,
      at: auditLogs.at,
      action: auditLogs.action,
      actorLabel: auditLogs.actorLabel,
      actorUserId: auditLogs.actorUserId,
      summary: auditLogs.summary,
      data: auditLogs.data,
      ip: auditLogs.ip,
      userAgent: auditLogs.userAgent,
      orderId: onlineOrders.id,
      orderNumber: onlineOrders.orderNumber,
      customerName: onlineOrders.customerName,
      mobile: onlineOrders.mobile,
      total: onlineOrders.total,
      status: onlineOrders.status,
      deletedAt: onlineOrders.deletedAt,
    })
    .from(auditLogs)
    .leftJoin(onlineOrders, join)
    .where(where)
    .orderBy(desc(auditLogs.at), desc(auditLogs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).leftJoin(onlineOrders, join).where(where);
  return { items, total, page, pageSize };
}

/** Today's figures for the top of the log page. */
export async function onlineOrderLogStats(actor: Actor) {
  requirePermission(actor, "audit.view");
  const [s] = await getDb()
    .select({
      events: sql<number>`count(*)::int`,
      today: sql<number>`count(*) filter (where ${auditLogs.at} >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')::int`,
      deleted: sql<number>`count(*) filter (where ${auditLogs.action} = 'online_order.deleted')::int`,
      refunds: sql<number>`count(*) filter (where ${auditLogs.action} in ('online_order.refund_requested','online_order.cancelled_by_customer','online_order.late_payment'))::int`,
    })
    .from(auditLogs)
    .where(isOrderEvent);
  return s;
}
