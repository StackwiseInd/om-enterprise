import type { Metadata } from "next";
import { Bullets, contactLine, grievanceSection, PLink, PolicyPage, type Business } from "@/components/public/policy";

export const metadata: Metadata = {
  title: "Refunds & cancellation",
  description: "How to cancel an OM ENTERPRISE online order, when refunds are made through Razorpay, how long they take, and returns at the counter.",
  alternates: { canonical: "/refund-policy" },
};

const sections = (b: Business) => [
  {
    id: "summary",
    title: "In short",
    body: (
      <Bullets
        items={[
          "Cancel an unpaid order any time: nothing is charged.",
          "Cancel a paid order before you collect it: you get the full amount back, with no cancellation charge.",
          "Refunds of online payments go back to the same card, bank account or UPI ID you paid from, through Razorpay, usually within 5–7 working days.",
          "Your statutory rights as a consumer are not affected by anything on this page.",
        ]}
      />
    ),
  },
  {
    id: "before-paying",
    title: "Cancelling before you pay",
    body: <p>You can cancel an order that hasn&apos;t been paid from its page in My orders. Nothing is charged, and any discount code on the order can be used again. An order that isn&apos;t paid in time is closed automatically, with no charge; you can try again from the order page.</p>,
  },
  {
    id: "after-paying",
    title: "Cancelling after you have paid",
    body: (
      <>
        <p>
          If you no longer want a paid order and haven&apos;t collected it yet, {contactLine(b)} with your order number. We cancel the order and refund the <strong>full amount</strong> you paid. There is no cancellation charge.
        </p>
        <p>We may also cancel a paid order ourselves, with a full refund, if an item is no longer available and you don&apos;t want a replacement, if a price or product on the website was clearly wrong, or if we can&apos;t complete the order for any other reason of ours.</p>
      </>
    ),
  },
  {
    id: "automatic",
    title: "Refunds that happen on their own",
    body: (
      <Bullets
        items={[
          "If a payment reaches us after the order was cancelled or had timed out, we refund it automatically in full. You don't need to ask.",
          "If the amount Razorpay reports for a payment doesn't match the order, we don't hand over the order until we have checked it with you; any amount that isn't used is refunded.",
          "If money left your account but the payment failed, the amount is returned by your bank or Razorpay, usually within 5–7 working days. Contact us if it hasn't arrived by then.",
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
          Refunds of online payments are made through Razorpay to the <strong>same account, card or UPI ID you paid from</strong>. We don&apos;t refund online payments in cash or to a different account. Once we start a refund, your order page shows “Refund in progress”, and then “Refunded”.
        </p>
        <p>After we start it, a refund usually reaches you within 5–7 working days, depending on your bank or card issuer; UPI refunds are often quicker. We can&apos;t speed up your bank, but we can give you the refund reference to ask them with.</p>
      </>
    ),
  },
  {
    id: "returns",
    title: "Returns after you collect",
    body: (
      <>
        <p>Please check the items at the counter when you collect them. We replace anything damaged or wrong on the spot.</p>
        <Bullets
          items={[
            "Unused items in their original condition and packaging can be returned or exchanged at the shop within 7 days of collection, with the bill.",
            "Items cut to length, tinted or mixed to order, special orders, and opened adhesives, solvents and paints can't be returned unless they are faulty.",
            "Faulty or damaged items are replaced or refunded; where the manufacturer's warranty applies, we help you with the claim.",
            "A return of an online order is refunded to the original payment method through Razorpay. A return of a counter purchase is settled at the counter.",
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
    id: "disputes",
    title: "If something is wrong with a payment",
    body: (
      <>
        <p>
          Keep your order number (it starts with OL) and, if you have it, the payment reference or UTR from your bank or UPI app, then {contactLine(b)}. Please contact us before raising a dispute or chargeback with your bank so we can fix it faster. See also our <PLink href="/terms">Terms of use</PLink>.
        </p>
      </>
    ),
  },
  grievanceSection(b),
];

export default function RefundPolicyPage() {
  return <PolicyPage title="Refunds & cancellation" path="/refund-policy" intro="How to cancel an order, when you get your money back, and returns at the counter." sections={sections} />;
}
