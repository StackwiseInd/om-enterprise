import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { shopAccounts, shopOtps } from "@/server/db/schema";
import { getSettings, saveSettings } from "@/server/settings";
import { shopSignUp, verifyAccountEmail } from "@/server/services/shop-auth";
import { consumeEmailCode, emailVerificationRequired, sendEmailCode } from "@/server/services/shop-otp";
import { placeOnlineOrder } from "@/server/services/online-orders";
import { createProduct, createVariant, setProductPublished, setProductReview } from "@/server/services/catalog";
import { proposePrice } from "@/server/services/pricing";
import type { Actor } from "@/server/auth/actor";
import { client, firstCategoryId, makeUser, rejects, setRegistration, taxClassId, uid } from "./helpers";

let outbox: string;
let admin: Actor;
let item: string;
let seq = 0;
const saved = { from: process.env.EMAIL_FROM, outbox: process.env.EMAIL_OUTBOX_DIR, key: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };

const mobile = () => `7${String(Date.now() % 1_000_000_000).padStart(9, "0").slice(-7)}${String(seq++ % 100).padStart(2, "0")}`;
const email = () => `${uid("cust")}@example.test`;
const ip = () => ({ ...client, ip: `10.7.${seq % 250}.${seq++ % 250}` });

/** The newest email the shop "sent" to this address (the outbox is a folder of messages, one per email). */
async function lastMail(to: string) {
  const dirs = await readdir(outbox);
  const msgs = await Promise.all(
    dirs.map(async (d) => {
      const file = path.join(outbox, d, "message.json");
      return { at: (await stat(file, { bigint: true })).mtimeNs, m: JSON.parse(await readFile(file, "utf8")) as { to: string; subject: string; text: string; html: string } };
    }),
  );
  return msgs.filter((x) => x.m.to === to).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).at(-1)?.m;
}
const codeIn = async (to: string) => (await lastMail(to))!.text.match(/code is (\d{6})/)![1];
/** Make the cooldown between two codes for the same address pass. */
const passCooldown = (to: string) => getDb().update(shopOtps).set({ createdAt: sql`now() - interval '1 minute'` }).where(eq(shopOtps.email, to));

beforeAll(async () => {
  outbox = await mkdtemp(path.join(tmpdir(), "om-otp-"));
  process.env.EMAIL_FROM = "OM ENTERPRISE <shop@example.test>";
  process.env.EMAIL_OUTBOX_DIR = outbox;
  await setRegistration("regular");
  admin = await makeUser("super_admin");
  const name = `Otp ${Date.now().toString(36)}`;
  const p = await createProduct(admin, { name, categoryId: await firstCategoryId(), unitCode: "pcs", taxClassId: await taxClassId("18"), hsnCode: "3917" });
  const v = await createVariant(admin, p.id, { sku: `SKU-${name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`, name: "Std", unitCode: "pcs" });
  await proposePrice(admin, { variantId: v.id, price: "500", priceIncludesTax: true, reason: "test price" });
  await setProductReview(admin, p.id, "approved");
  await setProductPublished(admin, p.id, true);
  item = v.id;
});
beforeEach(() => {
  // The tests that need no checking are the other files'; here it is on, and no real payment keys are around.
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
});
afterAll(async () => {
  for (const [k, v] of [["EMAIL_FROM", saved.from], ["EMAIL_OUTBOX_DIR", saved.outbox], ["RAZORPAY_KEY_ID", saved.key], ["RAZORPAY_KEY_SECRET", saved.secret]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(outbox, { recursive: true, force: true });
});

describe("email verification at sign-up", () => {
  it("makes the account only after the emailed code is entered, and records that the email is verified", async () => {
    expect(await emailVerificationRequired()).toBe(true);
    const e = email();
    const m = mobile();
    // No email, or no code: no account.
    expect((await rejects(shopSignUp({ name: "Asha Mehta", mobile: m, password: "asha-12345" }, ip()))).message).toContain("email");
    expect((await rejects(shopSignUp({ name: "Asha Mehta", mobile: m, password: "asha-12345", email: e }, ip()))).message).toContain("6-digit");
    expect(await getDb().select().from(shopAccounts).where(eq(shopAccounts.mobile, m))).toHaveLength(0);

    const sent = await sendEmailCode({ email: ` ${e.toUpperCase()} `, purpose: "sign_up" }, ip());
    expect(sent).toMatchObject({ email: e, cooldownSeconds: 30, expiresInMinutes: 10 });
    const mail = await lastMail(e);
    expect(mail!.subject).toMatch(/^\d{6} is your .* verification code$/);
    expect(mail!.html).toContain(await codeIn(e));

    // A wrong code is refused and counted; the right one then works, once.
    const code = await codeIn(e);
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await rejects(shopSignUp({ name: "Asha Mehta", mobile: m, password: "asha-12345", email: e, emailCode: wrong }, ip()))).message).toContain("isn't right");
    const up = await shopSignUp({ name: "Asha Mehta", mobile: m, password: "asha-12345", email: e, emailCode: code }, ip());
    expect(up.account).toMatchObject({ mobile: m, email: e });
    expect(up.account.emailVerifiedAt).toBeInstanceOf(Date);
    // The code is used up: it can't make a second account.
    expect((await rejects(shopSignUp({ name: "Other", mobile: mobile(), password: "other-12345", email: e, emailCode: code }, ip()))).message).toMatch(/expired|already used|already exists/);
  });

  it("stores no code in the clear, and gives up after five wrong tries", async () => {
    const e = email();
    await sendEmailCode({ email: e, purpose: "sign_up" }, ip());
    const code = await codeIn(e);
    const [row] = await getDb().select().from(shopOtps).where(eq(shopOtps.email, e));
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    const wrong = code === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) await rejects(consumeEmailCode({ email: e, purpose: "sign_up", code: wrong }));
    // Even the right code no longer works: ask for a new one.
    expect((await rejects(consumeEmailCode({ email: e, purpose: "sign_up", code }))).message).toMatch(/Too many|expired/);
  });

  it("expires a code after ten minutes and only the newest code works", async () => {
    const e = email();
    await sendEmailCode({ email: e, purpose: "sign_up" }, ip());
    const first = await codeIn(e);
    await getDb().update(shopOtps).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(shopOtps.email, e));
    expect((await rejects(consumeEmailCode({ email: e, purpose: "sign_up", code: first }))).message).toContain("expired");

    await passCooldown(e);
    await sendEmailCode({ email: e, purpose: "sign_up" }, ip());
    const second = await codeIn(e);
    await passCooldown(e);
    await sendEmailCode({ email: e, purpose: "sign_up" }, ip());
    const third = await codeIn(e);
    if (second !== third) expect((await rejects(consumeEmailCode({ email: e, purpose: "sign_up", code: second }))).message).toMatch(/isn't right|expired/);
    await expect(consumeEmailCode({ email: e, purpose: "sign_up", code: third })).resolves.toBe(e);
  });

  it("limits how often codes can be asked for", async () => {
    const e = email();
    await sendEmailCode({ email: e, purpose: "sign_up" }, ip());
    expect((await rejects(sendEmailCode({ email: e, purpose: "sign_up" }, ip()))).code).toBe("RATE_LIMITED"); // 30 seconds apart
    expect((await rejects(sendEmailCode({ email: "not-an-email", purpose: "sign_up" }, ip()))).code).toBe("VALIDATION");
    // One device can't flood many addresses.
    const same = ip();
    let limited = false;
    for (let i = 0; i < 20 && !limited; i++) {
      try {
        await sendEmailCode({ email: email(), purpose: "sign_up" }, same);
      } catch (err) {
        limited = (err as { code?: string }).code === "RATE_LIMITED";
        if (!limited) throw err;
      }
    }
    expect(limited).toBe(true);
  });

  it("won't send a sign-up code to an address that already has a verified account", async () => {
    const e = email();
    await sendEmailCode({ email: e, purpose: "sign_up" }, ip());
    await shopSignUp({ name: "Dev Shah", mobile: mobile(), password: "dev-12345", email: e, emailCode: await codeIn(e) }, ip());
    await passCooldown(e);
    expect((await rejects(sendEmailCode({ email: e, purpose: "sign_up" }, ip()))).code).toBe("CONFLICT");
  });
});

describe("email verification before paying", () => {
  async function unverifiedAccount() {
    // An account made before codes were asked for: has no verified email.
    const website = await getSettings("website");
    await getDb().transaction((tx) => saveSettings(tx, { userId: null, label: "test" }, "website", { ...website, requireEmailVerification: false }));
    const up = (await shopSignUp({ name: "Old Customer", mobile: mobile(), password: "old-12345" }, ip())).account;
    await getDb().transaction((tx) => saveSettings(tx, { userId: null, label: "test" }, "website", { ...website, requireEmailVerification: true }));
    return up;
  }

  it("asks an unverified customer to verify first, then lets them order", async () => {
    const a = await unverifiedAccount();
    expect(a.emailVerifiedAt).toBeNull();
    const err = await rejects(placeOnlineOrder(a, { items: [{ variantId: item, quantity: "1" }] }, ip()));
    expect(err.code).toBe("PRECONDITION");
    expect(err.message).toContain("verify your email");

    const e = email();
    await sendEmailCode({ email: e, purpose: "verify", accountId: a.id }, ip());
    // A code asked for by one account can't verify another.
    const other = await unverifiedAccount();
    expect((await rejects(verifyAccountEmail(other, { email: e, code: await codeIn(e) }, ip()))).message).toMatch(/expired|already used/);
    const done = await verifyAccountEmail(a, { email: e, code: await codeIn(e) }, ip());
    expect(done).toMatchObject({ email: e });
    expect(done.emailVerifiedAt).toBeInstanceOf(Date);
    // Now the order goes through to the next rule (no online payment is set up in this test).
    const next = await rejects(placeOnlineOrder(done, { items: [{ variantId: item, quantity: "1" }] }, ip()));
    expect(next.message).not.toContain("verify your email");
  });

  it("is off when the owner switches it off, or when email isn't set up", async () => {
    const website = await getSettings("website");
    await getDb().transaction((tx) => saveSettings(tx, { userId: null, label: "test" }, "website", { ...website, requireEmailVerification: false }));
    expect(await emailVerificationRequired()).toBe(false);
    await getDb().transaction((tx) => saveSettings(tx, { userId: null, label: "test" }, "website", { ...website, requireEmailVerification: true }));
    expect(await emailVerificationRequired()).toBe(true);
    delete process.env.EMAIL_FROM;
    expect(await emailVerificationRequired()).toBe(false);
    process.env.EMAIL_FROM = "OM ENTERPRISE <shop@example.test>";
  });
});
