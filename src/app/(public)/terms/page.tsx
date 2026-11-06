import type { Metadata } from "next";
import { stateName } from "@/lib/india";
import { Bullets, contactLine, PLink, PolicyPage, type Business } from "@/components/public/policy";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms for using the OM ENTERPRISE website, customer accounts, online orders, payments and discount codes.",
  alternates: { canonical: "/terms" },
};

const sections = (b: Business) => [
  {
    id: "about",
    title: "Who we are",
    body: (
      <p>
        This website is run by {b.name}, a building materials shop at {b.addressLine1}, {b.city}
        {stateName(b.stateCode) ? `, ${stateName(b.stateCode)}` : ""}. In these terms, “we” and “the shop” mean {b.name}; “you” means anyone using the website. By using the website or placing an order, you agree to these terms.
      </p>
    ),
  },
  {
    id: "catalogue",
    title: "Products, prices and pictures",
    body: (
      <>
        <p>We try to keep the catalogue, sizes and prices correct, but mistakes and changes happen. Pictures are for guidance; colour, packaging and markings can differ slightly from the item you collect.</p>
        <Bullets
          items={[
            "Prices are in Indian rupees (₹) and include GST unless the page says otherwise.",
            "Prices can change at any time. The amount shown at checkout is the amount you pay for that order.",
            "Items marked “price on request”, and items marked as samples, can't be bought online. Ask us for a quote.",
            "If we find a clear pricing mistake after you have paid, we will tell you before handing over the items and offer you the corrected price or a full refund.",
          ]}
        />
      </>
    ),
  },
  {
    id: "account",
    title: "Your account",
    body: (
      <Bullets
        items={[
          "To pay online you need an account with your name, your mobile number and a password. One account per mobile number.",
          "Keep your password to yourself. You are responsible for orders placed from your account. If you think someone else has used it, contact us straight away.",
          "We may suspend an account that is used to misuse the website, discount codes or payments.",
        ]}
      />
    ),
  },
  {
    id: "orders",
    title: "Placing an order",
    body: (
      <>
        <p>When you check out, we create an order with a number such as OL000123 and send you to PhonePe to pay. The order is confirmed only when PhonePe confirms the full payment to us; you will see “Order placed” on the order page.</p>
        <Bullets
          items={[
            "Pay within 30 minutes. If the payment doesn't go through, you can try again from the order page, or cancel the order.",
            "You can have up to 3 orders waiting for payment at a time, and one order can't be more than ₹1,00,000.",
            "If an item turns out to be unavailable after you have paid, we will call you and offer a replacement or a full refund for it.",
            <>
              Orders are collected from the shop. See <PLink href="/pickup-policy">Pickup &amp; delivery</PLink>.
            </>,
          ]}
        />
        <p>
          You can also send your cart as a request without paying. We will call or WhatsApp you to confirm the price and availability; nothing is charged online for a request.
        </p>
      </>
    ),
  },
  {
    id: "payments",
    title: "Payments",
    body: (
      <>
        <p>
          Online payments are processed by PhonePe Payment Gateway (PhonePe Limited). You can pay with UPI, debit or credit cards, net banking or the other methods PhonePe offers on its payment page. Your card, bank and UPI PIN details are entered on PhonePe&apos;s page; we never see or store them.
        </p>
        <p>We mark an order paid only after our system has checked the payment directly with PhonePe. If money leaves your account but the order doesn&apos;t show as paid, don&apos;t pay again: open the order page, which checks with PhonePe, or contact us with the order number.</p>
      </>
    ),
  },
  {
    id: "codes",
    title: "Discount codes",
    body: (
      <Bullets
        items={[
          "Discount codes are given out by the shop. Each code can be used once, on one order, and gives the flat amount shown at checkout.",
          "A code may need a minimum order value and may have an end date. It can't be exchanged for cash or combined with another code.",
          "A code is held for your order while you pay. If the payment fails, the order is cancelled or it is refunded, the code becomes usable again.",
          "We may cancel codes that were obtained or shared in a way we did not intend.",
        ]}
      />
    ),
  },
  {
    id: "refunds",
    title: "Cancellations and refunds",
    body: (
      <p>
        How to cancel an order, when you get your money back and how returns at the counter work is explained in our <PLink href="/refund-policy">Refunds &amp; cancellation policy</PLink>.
      </p>
    ),
  },
  {
    id: "use",
    title: "Using the website fairly",
    body: (
      <Bullets
        items={[
          "Don't try to break into accounts or the shop's systems, place fake orders, or overload the website.",
          "Don't copy the catalogue or pictures for commercial use without our permission. Brand names and logos belong to their owners.",
          "Product information is general guidance. For pressure ratings, load or fitting advice for your job, ask us or follow the manufacturer's instructions.",
        ]}
      />
    ),
  },
  {
    id: "liability",
    title: "Our responsibility",
    body: (
      <>
        <p>
          Products carry the manufacturer&apos;s warranty, where one is offered, and we help you claim it. Our responsibility for an order is limited to replacing the item or refunding what you paid for it. We are not responsible for losses caused by incorrect installation, use against the manufacturer&apos;s instructions, or delays outside our control. Nothing in these terms takes away your rights under the Consumer Protection Act, 2019.
        </p>
      </>
    ),
  },
  {
    id: "law",
    title: "Law and disputes",
    body: (
      <p>
        These terms are governed by the laws of India. If something goes wrong, please talk to us first; most problems are sorted out at the counter. Any dispute is subject to the courts with jurisdiction over {b.city}
        {b.district ? `, ${b.district} district` : ""}
        {stateName(b.stateCode) ? `, ${stateName(b.stateCode)}` : ""}.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes and contact",
    body: (
      <p>
        We may update these terms; the date at the top shows the latest version, and the version in force when you placed an order applies to it. For any question, {contactLine(b)}. How we handle your details is in our <PLink href="/privacy">Privacy policy</PLink>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return <PolicyPage title="Terms of use" path="/terms" intro="The rules for using this website, your customer account, online orders and payments." sections={sections} />;
}
