/**
 * Local stand-in for Razorpay, for trying the whole payment flow in a browser without real money:
 *
 *   npx tsx tests/support/fake-razorpay-server.ts            # listens on http://localhost:4020
 *
 * Run the app with
 *   RAZORPAY_KEY_ID=rzp_test_FAKEKEY123  RAZORPAY_KEY_SECRET=fake-secret-0123456789
 *   RAZORPAY_TEST_BASE_URL=http://localhost:4020            (add RAZORPAY_ALLOW_TEST_BASE_URL=true for a production build)
 *
 * and serve /checkout.js from here instead of https://checkout.razorpay.com/v1/checkout.js (the browser test
 * script routes that URL to this server). The stand-in checkout.js opens a small "payment window" with Pay and
 * Fail buttons and hands the app the same three fields the real one does, correctly signed.
 *
 *   GET  /__state                 what the fake holds
 *   POST /__settle-refund         { id, status }     settle a refund
 *   POST /__sign                  { order_id, payment_id } → signature (the stand-in checkout.js uses this)
 *   POST /__pay                   { order_id, status? } → marks the order paid, returns the payment
 *   POST /__fail                  { order_id }       a failed try
 */
import { createServer } from "node:http";
import { FakeRazorpay } from "./fake-razorpay";

const port = Number(process.env.FAKE_RAZORPAY_PORT ?? 4020);
/** Where the stand-in checkout.js sends its helper calls. A browser test points this at https://api.razorpay.com
 *  (an origin the page's security policy already allows) and routes it back here. */
const publicBase = process.env.FAKE_RAZORPAY_PUBLIC_BASE ?? `http://localhost:${port}`;
const fake = new FakeRazorpay();

const CHECKOUT_JS = `
(function () {
  function Razorpay(o) { this.o = o; this.h = {}; }
  Razorpay.prototype.on = function (e, cb) { this.h[e] = cb; };
  Razorpay.prototype.open = function () {
    var o = this.o, self = this;
    var w = document.createElement('div');
    w.id = 'fake-rzp';
    w.setAttribute('style', 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:system-ui');
    w.innerHTML = '<div style="background:#fff;border-radius:12px;padding:24px;width:320px"><h2 style="margin:0 0 4px">' + o.name + '</h2><p style="margin:0 0 12px;color:#555">' + o.description + '</p><p id="fake-rzp-amount" style="font-size:28px;margin:0 0 16px">₹' + (o.amount / 100).toFixed(2) + '</p><div id="fake-rzp-msg" style="color:#b00;min-height:20px"></div><button id="fake-rzp-pay" style="padding:10px 16px">Pay</button> <button id="fake-rzp-fail" style="padding:10px 16px">Fail</button> <button id="fake-rzp-close" style="padding:10px 16px">Close</button></div>';
    document.body.appendChild(w);
    function done() { w.remove(); }
    function post(path, body) { return fetch('${"${BASE}"}' + path, { method: 'POST', body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
    document.getElementById('fake-rzp-pay').onclick = function () {
      post('/__pay', { order_id: o.order_id }).then(function (p) {
        return post('/__sign', { order_id: o.order_id, payment_id: p.id }).then(function (s) {
          done();
          o.handler({ razorpay_payment_id: p.id, razorpay_order_id: o.order_id, razorpay_signature: s.signature });
        });
      });
    };
    document.getElementById('fake-rzp-fail').onclick = function () {
      post('/__fail', { order_id: o.order_id }).then(function () {
        document.getElementById('fake-rzp-msg').textContent = 'Payment failed: incorrect PIN. Try again.';
        if (self.h['payment.failed']) self.h['payment.failed']({ error: { description: 'Payment processing failed because of incorrect PIN' } });
      });
    };
    document.getElementById('fake-rzp-close').onclick = function () { done(); if (o.modal && o.modal.ondismiss) o.modal.ondismiss(); };
  };
  window.Razorpay = Razorpay;
})();
`;

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  let body = "";
  for await (const chunk of req) body += chunk;
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors).end();
    return;
  }
  const json = (status: number, b: unknown) => res.writeHead(status, { "Content-Type": "application/json", ...cors }).end(JSON.stringify(b));

  if (url.pathname === "/checkout.js") {
    res.writeHead(200, { "Content-Type": "application/javascript", ...cors }).end(CHECKOUT_JS.replace("${BASE}", publicBase));
    return;
  }
  if (url.pathname === "/__state") return json(200, { orders: [...fake.orders.values()], refunds: [...fake.refunds.values()] });
  if (url.pathname === "/__sign" && req.method === "POST") {
    const b = JSON.parse(body || "{}") as { order_id: string; payment_id: string };
    return json(200, { signature: fake.signCheckout(b.order_id, b.payment_id) });
  }
  if (url.pathname === "/__pay" && req.method === "POST") {
    const b = JSON.parse(body || "{}") as { order_id: string };
    return json(200, fake.pay(b.order_id));
  }
  if (url.pathname === "/__fail" && req.method === "POST") {
    const b = JSON.parse(body || "{}") as { order_id: string };
    fake.failAttempt(b.order_id);
    return json(200, { ok: true });
  }
  if (url.pathname === "/__settle-refund" && req.method === "POST") {
    const b = JSON.parse(body || "{}") as { id: string; status?: "processed" | "failed" };
    fake.settleRefund(b.id, b.status ?? "processed");
    return json(200, { ok: true });
  }
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
  const r = fake.handle(req.method ?? "GET", url.pathname + url.search, body || null, headers);
  json(r.status, r.body);
}).listen(port, () => console.log(`fake Razorpay on http://localhost:${port} (key ${fake.keyId})`));
