import { api } from "@/server/http";
import { LOG_ACTION_LABEL, LOG_GROUPS, queryOnlineOrderLog, type LogGroup } from "@/server/services/online-order-log";

const cell = (v: unknown) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Quote every cell, and stop spreadsheet apps from running a cell that starts like a formula.
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};
const day = (v: string | null, plus = false) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(new Date(`${v}T00:00:00+05:30`).getTime() + (plus ? 86400_000 : 0)) : undefined);

/** The online orders log as a CSV file (the same filters as the page; up to 5,000 entries). */
export const GET = api({ permission: "audit.view" }, async (ctx) => {
  const p = ctx.req.nextUrl.searchParams;
  const group = p.get("group") as LogGroup | null;
  const rows = [];
  for (let page = 1; page <= 10; page++) {
    const r = await queryOnlineOrderLog(ctx.actor, { q: p.get("q") ?? undefined, group: group && group in LOG_GROUPS ? group : undefined, from: day(p.get("from")), to: day(p.get("to"), true), page, pageSize: 500 });
    rows.push(...r.items);
    if (r.items.length < 500) break;
  }
  const head = ["When (UTC)", "Order", "Customer", "Mobile", "Total", "Order status now", "Deleted", "Step", "Action", "What happened", "By", "IP", "Device", "Details"];
  const body = rows.map((e) =>
    [e.at, e.orderNumber, e.customerName, e.mobile, e.total, e.status, e.deletedAt ? "yes" : "", LOG_ACTION_LABEL[e.action] ?? e.action, e.action, e.summary, e.actorLabel, e.ip, e.userAgent, e.data].map(cell).join(","),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${[head.map(cell).join(","), ...body].join("\r\n")}`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="online-orders-log-${stamp}.csv"`, "cache-control": "no-store" },
  });
});
