import "server-only";
/**
 * The customer's PAYMENT RECEIPT: an A4 page to show at the counter as proof of an online payment, with the
 * items bought, the amount paid and how. It is deliberately NOT a tax invoice or bill of supply: it says so
 * on the page and in a watermark, and the shop issues its own bill at the counter. It carries a short code
 * the shop can check against its record. Roboto (bundled in assets/fonts) draws it, ₹ included.
 */
import path from "node:path";
import PDFDocument from "pdfkit";
import { formatINR, formatQty } from "@/lib/money";
import { paymentModeLabel } from "@/lib/gateway";

export interface ReceiptData {
  shop: { name: string; addressLines: string[]; phone: string | null; gstin: string | null };
  orderNumber: string;
  status: "paid" | "ready" | "collected";
  paidAt: Date | null;
  collectedAt: Date | null;
  customer: { name: string; mobile: string };
  lines: { name: string; variant: string; quantity: string; unit: string; unitPrice: string; lineTotal: string }[];
  subtotal: string;
  discount: string;
  total: string;
  couponCode: string | null;
  payment: { gateway: string; method: string | null; paymentId: string | null; utr: string | null };
  /** XXXX-XXXX, the shop's tamper check. */
  code: string;
}

const W = 595.28;
const H = 841.89;
const M = 40;
const NAVY = "#0b1220";
const GREY = "#5b6472";
const RULE = "#cbd5e1";
const GREEN = "#0f7b4f";
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const LOGO = path.join(process.cwd(), "assets", "brand", "om-enterprise-logo.jpg");

const when = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(d) : "—");

export async function renderPaymentReceiptPdf(r: ReceiptData): Promise<Buffer> {
  const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: false, info: { Title: `Payment receipt ${r.orderNumber}`, Author: r.shop.name, Subject: "Proof of online payment. Not a tax invoice." } });
  doc.registerFont("R", path.join(FONT_DIR, "Roboto-Regular.ttf"));
  doc.registerFont("B", path.join(FONT_DIR, "Roboto-Bold.ttf"));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const text = (s: string, x: number, y: number, o: { w?: number; size?: number; font?: "R" | "B"; color?: string; align?: "left" | "right" | "center" } = {}) => {
    doc.font(o.font ?? "R").fontSize(o.size ?? 9).fillColor(o.color ?? NAVY);
    doc.text(s, x, y, { width: o.w, align: o.align ?? "left", lineBreak: o.w !== undefined });
  };
  const rule = (y: number, color = RULE, width = 0.6) => doc.moveTo(M, y).lineTo(W - M, y).lineWidth(width).strokeColor(color).stroke();
  const height = (s: string, w: number, size = 9, font: "R" | "B" = "R") => doc.font(font).fontSize(size).heightOfString(s, { width: w });

  const newPage = () => {
    doc.addPage({ size: [W, H], margin: 0 });
    // Watermark: this page is a receipt, not an invoice.
    doc.save();
    doc.rotate(-30, { origin: [W / 2, H / 2] });
    doc.font("B").fontSize(54).fillColor("#94a3b8").opacity(0.12);
    doc.text("NOT A TAX INVOICE", W / 2 - 230, H / 2 - 30, { width: 460, align: "center", lineBreak: false });
    doc.restore();
    doc.opacity(1);
  };

  newPage();
  // ---- Header
  doc.image(LOGO, M, 36, { width: 46, height: 46 });
  text(r.shop.name, M + 58, 38, { size: 15, font: "B", w: 270 });
  text(r.shop.addressLines.join(", "), M + 58, 58, { size: 8, color: GREY, w: 270 });
  text([r.shop.phone && `Phone ${r.shop.phone}`, r.shop.gstin && `GSTIN ${r.shop.gstin}`].filter(Boolean).join("   ·   "), M + 58, 58 + height(r.shop.addressLines.join(", "), 270, 8) + 2, { size: 8, color: GREY, w: 270 });
  text("PAYMENT RECEIPT", W - M - 220, 38, { size: 17, font: "B", w: 220, align: "right" });
  text("Proof of online payment", W - M - 220, 60, { size: 9, color: GREY, w: 220, align: "right" });
  text("Not a tax invoice or bill of supply", W - M - 220, 72, { size: 9, font: "B", color: "#b45309", w: 220, align: "right" });
  rule(100, NAVY, 1.2);

  // ---- Status band
  const paidLabel = r.status === "collected" ? `PAID · COLLECTED ${when(r.collectedAt)}` : r.status === "ready" ? "PAID · READY FOR PICKUP" : "PAID";
  doc.roundedRect(M, 112, W - 2 * M, 34, 4).fillColor("#ecfdf5").fill();
  text(paidLabel, M + 14, 122, { size: 12, font: "B", color: GREEN });
  text(`Total paid ${formatINR(r.total)}`, W - M - 214, 122, { size: 12, font: "B", color: GREEN, w: 200, align: "right" });

  // ---- Order + payment details (two columns of label/value pairs)
  let y = 162;
  const method = r.payment.method ? paymentModeLabel(r.payment.method) : null;
  const left: [string, string][] = [
    ["Order number", r.orderNumber],
    ["Paid on", when(r.paidAt)],
    ["Customer", r.customer.name],
    ["Mobile", r.customer.mobile],
  ];
  const right: [string, string][] = [
    ["Paid through", r.payment.gateway + (method ? ` (${method})` : "")],
    ["Payment ID", r.payment.paymentId ?? "—"],
    ...(r.payment.utr ? ([["Bank reference (UTR)", r.payment.utr]] as [string, string][]) : []),
    ["Receipt code", r.code],
  ];
  const col = (rows: [string, string][], x: number, w: number) => {
    let yy = y;
    for (const [k, v] of rows) {
      text(k, x, yy, { size: 8, color: GREY, w });
      const strong = k === "Order number" || k === "Receipt code";
      text(v, x, yy + 10, { size: strong ? 12 : 10, font: strong ? "B" : "R", w });
      yy += 10 + Math.max(14, height(v, w, strong ? 12 : 10, strong ? "B" : "R")) + 6;
    }
    return yy;
  };
  const yEnd = Math.max(col(left, M, 240), col(right, 300, W - M - 300));
  y = yEnd + 6;
  rule(y);
  y += 14;

  // ---- Items
  const cols = { n: M, name: M + 24, qty: 330, unitPrice: 395, amount: 470 };
  const head = () => {
    text("#", cols.n, y, { size: 8, font: "B", color: GREY });
    text("Item", cols.name, y, { size: 8, font: "B", color: GREY });
    text("Qty", cols.qty, y, { size: 8, font: "B", color: GREY, w: 55, align: "right" });
    text("Price", cols.unitPrice, y, { size: 8, font: "B", color: GREY, w: 65, align: "right" });
    text("Amount", cols.amount, y, { size: 8, font: "B", color: GREY, w: W - M - cols.amount, align: "right" });
    y += 14;
    rule(y - 3);
  };
  head();
  r.lines.forEach((l, i) => {
    const label = l.variant && l.variant !== "Std" ? `${l.name} · ${l.variant}` : l.name;
    const h = Math.max(16, height(label, cols.qty - cols.name - 10, 9.5));
    if (y + h > H - 190) {
      newPage();
      y = 50;
      head();
    }
    text(String(i + 1), cols.n, y, { size: 9, color: GREY });
    text(label, cols.name, y, { size: 9.5, w: cols.qty - cols.name - 10 });
    text(`${formatQty(l.quantity)} ${l.unit}`, cols.qty, y, { size: 9.5, w: 55, align: "right" });
    text(formatINR(l.unitPrice), cols.unitPrice, y, { size: 9.5, w: 65, align: "right" });
    text(formatINR(l.lineTotal), cols.amount, y, { size: 9.5, w: W - M - cols.amount, align: "right" });
    y += h + 5;
  });
  rule(y);
  y += 10;

  // ---- Totals
  if (y > H - 200) {
    newPage();
    y = 50;
  }
  const money = (label: string, value: string, bold = false, color = NAVY) => {
    text(label, 330, y, { size: bold ? 12 : 10, font: bold ? "B" : "R", color, w: 130 });
    text(value, cols.amount, y, { size: bold ? 12 : 10, font: bold ? "B" : "R", color, w: W - M - cols.amount, align: "right" });
    y += bold ? 20 : 16;
  };
  money("Items", formatINR(r.subtotal));
  if (Number(r.discount) > 0) money(`Discount${r.couponCode ? ` (${r.couponCode})` : ""}`, `− ${formatINR(r.discount)}`, false, GREEN);
  rule(y - 2, NAVY, 0.8);
  y += 4;
  money("Total paid", formatINR(r.total), true);

  // ---- Notes
  y += 12;
  const note =
    "Please show this receipt, with your order number, at the counter when you collect your items. The shop checks the receipt code against its own record. " +
    "This is a payment receipt only: it is not a GST tax invoice or a bill of supply. The shop issues its bill at the counter when you collect.";
  doc.roundedRect(M, y, W - 2 * M, height(note, W - 2 * M - 28, 9) + 22, 4).lineWidth(0.8).strokeColor(RULE).stroke();
  text(note, M + 14, y + 11, { size: 9, color: GREY, w: W - 2 * M - 28 });
  y += height(note, W - 2 * M - 28, 9) + 38;
  text(`Generated ${when(new Date())} · ${r.shop.name}`, M, y, { size: 7.5, color: GREY, w: W - 2 * M, align: "center" });

  doc.end();
  return done;
}
