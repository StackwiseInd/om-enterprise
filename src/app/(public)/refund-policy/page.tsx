import type { Metadata } from "next";
import { Bullets, contactLine, PLink, PolicyPage, type Business } from "@/components/public/policy";

export const metadata: Metadata = {
  title: "Refunds & cancellation",
  description: "How to cancel an OM ENTERPRISE online order, when refunds are made, how long they take, and returns at the counter.",
  alternates: { canonical: "/refund-policy" },
};

const sections = (b: Business) => [
  {
    id: "before-paying",
    title: "Cancelling before you pay",
    body: <p>You can cancel an order that hasn&apos;t been paid from its page in My orders. Nothing is charged, and any discount code on the order can be used again. Orders that are not paid in time are closed automatically.</p>,
  },
  {
    id: "after-paying",
    title: "Cancelling after you have paid",
    body: (
      <>
        <p>
          If you no longer want a paid order and haven&apos;t collected it yet, {contactLine(b)} with your order number. We cancel the order and refund the <strong>full amount</strong> you paid. There is no cancellation charge.
        </p>
        <p>We may also cancel a paid order ourselves, with a full refund, if an item is no longer available and you don&apos;t want a replacement, or if a price on the website was clearly wrong.</p>
      </>
    ),
  },
  {
    id: "automatic",
    title: "Automatic refunds",
    body: (
      <Bullets
        items={[
          "If a payment reaches us after the order was cancelled or closed, we refund it automatically in full. You don't need to ask.",
          "If PhonePe reports a payment that doesn't match the order amount, we don't hand over the order until we have checked it with you; any amount that isn't used is refunded.",
          "If money left your account but the payment failed at PhonePe, the amount is returned by PhonePe or your bank, usually within 5–7 working days. Contact us if it hasn't arrived.",
        ]}
      />
    ),
  },
  {
    id: "how",
    title: "How and when refunds reach you",
    body: (
      <>
        <p>
          Refunds of online payments are made through PhonePe to the <strong>same account, card or UPI ID you paid from</strong>. We don&apos;t refund online payments in cash or to a different account. Once we start a refund, the order page shows “Refund in progress” and then “Refunded”.
        </p>
        <p>After we start it, a refund usually reaches you within 5–7 working days, depending on your bank or card issuer. UPI refunds are often quicker.</p>
      </>
    ),
  },
  {
    id: "returns",
    title: "Returns after collection",
    body: (
      <>
        <p>Please check the items at the counter when you collect them; we replace anything damaged or wrong on the spot.</p>
        <Bullets
          items={[
            "Unused items in their original condition and packaging can be returned or exchanged at the shop within 7 days of collection, with the bill.",
            "Items cut to length, tinted or mixed to order, special orders, and opened adhesives, solvents and paints can't be returned unless they are faulty.",
            "Faulty items are handled under the manufacturer's warranty; we help you with the claim.",
            "A return of an online order is refunded to the original payment method through PhonePe. A return of a counter purchase is settled at the counter.",
          ]}
        />
      </>
    ),
  },
  {
    id: "codes",
    title: "Discount codes on refunded orders",
    body: <p>When an order is cancelled or fully refunded, the discount code used on it becomes usable again. The discount itself is never paid out as cash.</p>,
  },
  {
    id: "help",
    title: "Need help with a refund?",
    body: (
      <p>
        Keep your order number (it starts with OL) and, if you have it, the UTR or transaction ID from your bank or UPI app. Then {contactLine(b)}. See also our <PLink href="/terms">Terms of use</PLink>.
      </p>
    ),
  },
];

export default function RefundPolicyPage() {
  return <PolicyPage title="Refunds & cancellation" path="/refund-policy" intro="How to cancel an order, when you get your money back, and returns at the counter." sections={sections} />;
}
