import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { getSettings, saveSettings } from "@/server/settings";
import { addLine, createSale, finalizeSale, getSale, requestApproval, updateLine } from "@/server/services/sales";
import { recordVerifiedPayment } from "@/server/services/payments";
import { issueBill, saveSaleCustomer } from "@/server/services/documents";
import { billsOn, notifyApprovalRequest, ownerDay, ownerSearch, ownerWaiting, sendDailySummary, setupChecklist } from "@/server/services/owner";
import { makeItem, makeUser, rejects, setRegistration } from "./helpers";

let outbox = "";
const saved = { from: process.env.EMAIL_FROM, outbox: process.env.EMAIL_OUTBOX_DIR, key: process.env.RESEND_API_KEY };
let registrationBefore: Awaited<ReturnType<typeof getSettings<"tax">>>["registrationType"];

const setAlerts = async (v: { ownerEmail: string; dailySummary: boolean; approvalAlerts: boolean }) =>
  getDb().transaction((tx) => saveSettings(tx, { userId: null, label: "test" }, "alerts", v));

const sent = async () => {
  const folders = await readdir(outbox);
  return Promise.all(folders.map(async (f) => JSON.parse(await readFile(path.join(outbox, f, "message.json"), "utf8"))));
};

beforeAll(async () => {
  outbox = await mkdtemp(path.join(tmpdir(), "owner-mail-"));
  process.env.EMAIL_FROM = "OM ENTERPRISE <bills@example.com>";
  process.env.EMAIL_OUTBOX_DIR = outbox;
  delete process.env.RESEND_API_KEY;
  registrationBefore = (await getSettings("tax")).registrationType;
  await setRegistration("composition");
});
afterAll(async () => {
  for (const [k, v] of [
    ["EMAIL_FROM", saved.from],
    ["EMAIL_OUTBOX_DIR", saved.outbox],
    ["RESEND_API_KEY", saved.key],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await setAlerts({ ownerEmail: "", dailySummary: true, approvalAlerts: true });
  await setRegistration(registrationBefore);
});

/** A bill paid in cash, for a customer with this mobile. */
async function cashBill(mobile: string) {
  const owner = await makeUser("super_admin");
  const item = await makeItem(owner, { price: "1200", gst: "18" });
  const sale = await createSale(owner);
  await addLine(owner, sale.id, { variantId: item.variantId, quantity: "2" });
  await saveSaleCustomer(owner, sale.id, { name: "Owner Test Customer", mobile });
  const s = await finalizeSale(owner, sale.id);
  await recordVerifiedPayment(owner, sale.id, { method: "cash", amount: s.grandTotal, verificationMethod: "cash_counted", confirmReceived: true });
  return { owner, sale, bill: await issueBill(owner, sale.id), sku: item.sku };
}

describe("the owner's day", () => {
  it("counts today's bills and money by method, and lists today's bills", async () => {
    const owner = await makeUser("super_admin");
    const before = await ownerDay(owner);
    const { bill } = await cashBill("9812300001");
    const after = await ownerDay(owner);
    expect(after.bills).toBe(before.bills + 1);
    expect(Number(after.received) - Number(before.received)).toBe(Number(bill.grandTotal));
    const cash = (d: typeof after) => Number(d.byMethod.find((b) => b.method === "cash")?.amount ?? 0);
    expect(cash(after) - cash(before)).toBe(Number(bill.grandTotal));
    expect((await billsOn(owner)).some((b) => b.id === bill.id)).toBe(true);
  });

  it("finds a bill by number, a customer by mobile and a product by SKU, and nothing for too short a search", async () => {
    const { owner, bill, sku } = await cashBill("9812300002");
    expect((await ownerSearch(owner, bill.docNumber)).some((h) => h.kind === "bill" && h.id === bill.id)).toBe(true);
    expect((await ownerSearch(owner, "98123 00002")).some((h) => h.kind === "customer" && h.detail.includes("9812300002"))).toBe(true);
    expect((await ownerSearch(owner, sku!)).some((h) => h.kind === "product")).toBe(true);
    expect(await ownerSearch(owner, "a")).toEqual([]);
    // The owner app's search is for those who see the overview; counter staff can't use it.
    const sachin = await makeUser("sales");
    expect((await rejects(ownerSearch(sachin, bill.docNumber))).code).toBe("FORBIDDEN");
  });

  it("lists the setup steps with the GST type confirmed", async () => {
    const items = await setupChecklist();
    expect(items.map((i) => i.key)).toEqual(["tax", "upi", "prices", "staff", "alerts", "email", "whatsapp"]);
    expect(items.find((i) => i.key === "tax")).toMatchObject({ done: true, registrationType: "composition" });
    expect(items.find((i) => i.key === "email")).toMatchObject({ done: true, optional: true, href: null });
  });
});

describe("emails to the owner", () => {
  it("sends the evening summary only when turned on and an address is given", async () => {
    await setAlerts({ ownerEmail: "", dailySummary: true, approvalAlerts: true });
    expect(await sendDailySummary()).toMatchObject({ sent: false, reason: "no owner email" });
    await setAlerts({ ownerEmail: "kishan@example.com", dailySummary: false, approvalAlerts: true });
    expect(await sendDailySummary()).toMatchObject({ sent: false, reason: "turned off" });

    await setAlerts({ ownerEmail: "kishan@example.com", dailySummary: true, approvalAlerts: true });
    await cashBill("9812300003");
    expect(await sendDailySummary()).toEqual({ sent: true, to: "kishan@example.com" });
    const mail = (await sent()).find((m) => m.subject.includes("received"));
    expect(mail.to).toBe("kishan@example.com");
    expect(mail.subject).toMatch(/today: \d+ bills?, ₹[\d,]+\.\d\d received$/);
    expect(mail.text).toMatch(/Money received: ₹/);
    expect(mail.text).toMatch(/Cash: ₹/);
  });

  it("emails the owner when staff ask for a discount approval, and counts it as waiting", async () => {
    await setAlerts({ ownerEmail: "kishan@example.com", dailySummary: true, approvalAlerts: true });
    const owner = await makeUser("super_admin");
    const sachin = await makeUser("sales");
    const item = await makeItem(owner, { price: "1000", gst: "18" });
    const sale = await createSale(sachin);
    await addLine(sachin, sale.id, { variantId: item.variantId, quantity: "1" });
    const [line] = (await getSale(sachin, sale.id)).lines;
    await updateLine(sachin, sale.id, line.id, { discount: { type: "percent", value: "12" }, discountReason: "Regular contractor" });
    const waitingBefore = (await ownerWaiting(owner)).discounts;
    const req = await requestApproval(sachin, sale.id, "Buys every month");
    expect((await ownerWaiting(owner)).discounts).toBe(waitingBefore + 1);

    await notifyApprovalRequest(req, sachin.displayName);
    const mail = (await sent()).find((m) => m.subject.startsWith("Approve?") && m.subject.includes(sale.saleNumber));
    expect(mail.subject).toBe(`Approve? 12% discount on ${sale.saleNumber} (₹880.00) — asked by ${sachin.displayName}`);
    expect(mail.text).toContain("Reason: Buys every month");

    // Turned off: nothing more is sent, and nothing throws.
    await setAlerts({ ownerEmail: "kishan@example.com", dailySummary: true, approvalAlerts: false });
    const count = (await sent()).length;
    await notifyApprovalRequest(req, sachin.displayName);
    expect((await sent()).length).toBe(count);
  });
});

describe("the evening job", () => {
  it("runs only with the scheduler's secret", async () => {
    const { GET } = await import("@/app/api/cron/daily-summary/route");
    const { NextRequest } = await import("next/server");
    const call = (auth?: string) => GET(new NextRequest("http://localhost/api/cron/daily-summary", { headers: auth ? { authorization: auth } : {} }));
    const savedSecret = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      expect((await call("Bearer ")).status).toBe(401);
      process.env.CRON_SECRET = "a-long-random-cron-secret-for-tests";
      expect((await call()).status).toBe(401);
      expect((await call("Bearer wrong-secret")).status).toBe(401);
      await setAlerts({ ownerEmail: "", dailySummary: true, approvalAlerts: true });
      const ok = await call("Bearer a-long-random-cron-secret-for-tests");
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ok: true, data: { sent: false, reason: "no owner email" } });
    } finally {
      if (savedSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = savedSecret;
    }
  });
});
