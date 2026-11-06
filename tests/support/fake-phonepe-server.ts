/**
 * Local stand-in for PhonePe, for trying the whole payment flow in a browser without real money:
 *
 *   npx tsx tests/support/fake-phonepe-server.ts            # listens on http://localhost:4010
 *
 * then run the app with PHONEPE_CLIENT_ID / PHONEPE_CLIENT_SECRET / PHONEPE_CLIENT_VERSION set to any
 * values, PHONEPE_TEST_BASE_URL=http://localhost:4010 (and PHONEPE_ALLOW_TEST_BASE_URL=true when
 * running a production build). The "payment page" at /pay offers Pay and Fail buttons and sends the
 * browser back to the shop exactly like PhonePe does. GET /__state shows what the fake holds.
 */
import { createServer } from "node:http";
import { FakePhonePe } from "./fake-phonepe";

const port = Number(process.env.FAKE_PHONEPE_PORT ?? 4010);
const fake = new FakePhonePe(`http://localhost:${port}/pay`);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  let body = "";
  for await (const chunk of req) body += chunk;

  if (url.pathname === "/pay" && req.method === "GET") {
    const id = url.searchParams.get("token") ?? "";
    const o = fake.orders.get(id);
    res.writeHead(o ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      o
        ? `<!doctype html><meta name="viewport" content="width=device-width"><title>Fake PhonePe</title>
<body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px">
<h1 style="color:#5f259f">Fake PhonePe</h1><p>Order <b>${esc(id)}</b></p><p style="font-size:28px">₹${(o.amount / 100).toFixed(2)}</p>
<form method="post" action="/pay/complete"><input type="hidden" name="id" value="${esc(id)}">
<button name="outcome" value="pay" style="padding:12px 20px">Pay</button>
<button name="outcome" value="fail" style="padding:12px 20px">Fail</button></form></body>`
        : "no such order",
    );
    return;
  }
  if (url.pathname === "/pay/complete" && req.method === "POST") {
    const form = new URLSearchParams(body);
    const id = form.get("id") ?? "";
    const o = fake.orders.get(id);
    if (!o) {
      res.writeHead(404).end("no such order");
      return;
    }
    if (form.get("outcome") === "pay") fake.pay(id);
    else fake.fail(id);
    res.writeHead(303, { Location: o.redirectUrl }).end();
    return;
  }
  if (url.pathname === "/__state") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ orders: [...fake.orders.values()], refunds: [...fake.refunds.values()] }, null, 2));
    return;
  }
  if (url.pathname === "/__settle-refund" && req.method === "POST") {
    const { id, state } = JSON.parse(body || "{}") as { id: string; state?: "COMPLETED" | "FAILED" };
    fake.settleRefund(id, state ?? "COMPLETED");
    res.writeHead(200).end("ok");
    return;
  }
  const r = fake.handle(req.method ?? "GET", url.pathname + url.search, body || null);
  res.writeHead(r.status, { "Content-Type": "application/json" }).end(JSON.stringify(r.body));
}).listen(port, () => console.log(`fake PhonePe on http://localhost:${port}`));
