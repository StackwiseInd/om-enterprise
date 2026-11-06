import type { Metadata } from "next";
import { stateName } from "@/lib/india";
import { Bullets, contactLine, grievanceSection, PAYMENT_PARTNER, PLink, PolicyPage, type Business } from "@/components/public/policy";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms for using the OM ENTERPRISE website: accounts, orders, prices, payments by Razorpay, discount codes, pickup, liability and how to complain.",
  alternates: { canonical: "/terms" },
};

const sections = (b: Business) => [
  {
    id: "about",
    title: "Who we are and what these terms cover",
    body: (
      <>
        <p>
          This website is operated by <strong>{b.name}</strong>, a proprietorship selling building materials from {b.addressLine1}, {b.city}
          {stateName(b.stateCode) ? `, ${stateName(b.stateCode)}` : ""} {b.pincode}
          {b.gstin ? ` (GSTIN ${b.gstin})` : ""}. In these terms, “we”, “us” and “the shop” mean {b.name}; “you” means anyone who uses the website.
        </p>
        <p>
          By browsing the website, creating an account, sending an enquiry or placing an order you agree to these terms and to our <PLink href="/privacy">Privacy policy</PLink>, <PLink href="/refund-policy">Refunds &amp; cancellation policy</PLink> and <PLink href="/pickup-policy">Pickup &amp; delivery policy</PLink>, which are part of them. If you don&apos;t agree, please don&apos;t use the website. These terms are an electronic record under the Information Technology Act, 2000 and need no signature.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Who can order",
    body: (
      <Bullets
        items={[
          "You must be at least 18 and able to enter into a contract under the Indian Contract Act, 1872. If you are younger, a parent or guardian must place the order.",
          "Orders are for use in India and are collected from the shop in person.",
          "The details you give (name, mobile number, email) must be true and belong to you.",
        ]}
      />
    ),
  },
  {
    id: "catalogue",
    title: "Products, prices and availability",
    body: (
      <>
        <p>We try to keep the catalogue, sizes, specifications and prices correct, but mistakes and changes happen. Pictures and descriptions are for guidance; the colour, packaging or markings of the item you collect can differ slightly, and the manufacturer&apos;s own datasheet prevails.</p>
        <Bullets
          items={[
            "Prices are in Indian rupees (₹) and include GST unless a page says otherwise. A tax invoice is issued at the counter when you collect.",
            "Prices and stock can change at any time. The amount shown at checkout when you pay is the price for that order.",
            "Items marked “price on request” and items marked as samples can't be bought online. Ask us for a quote.",
            "If we find a clear mistake in a price, quantity or product after you have ordered, we will tell you before handing anything over and offer you the corrected price or a full refund. You are never charged more than the amount you paid without your agreement.",
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
          "To pay online you need an account with your name, mobile number and a password. One account per mobile number.",
          "Keep your password to yourself and sign out on shared devices. You are responsible for what happens through your account. If you think someone else has used it, contact us straight away.",
          "We may suspend or close an account that is used for fraud, to abuse discount codes or payments, or to harm the website or other customers.",
          "You can ask us to close your account at any time (see the Privacy policy for what we must keep).",
        ]}
      />
    ),
  },
  {
    id: "orders",
    title: "Placing an order",
    body: (
      <>
        <p>
          When you check out we create an order with a number such as OL000123 and open Razorpay&apos;s secure payment window. <strong>Your order is placed only when payment is confirmed</strong>: the order page then shows “Payment verified. Your order is placed.” Until then nothing is reserved for you except the discount code, if you used one.
        </p>
        <Bullets
          items={[
            "You have about 30 minutes to pay. If the time runs out or a payment fails, nothing is charged for that try and you can try again from the order page, or cancel the order.",
            "You can have up to 3 orders waiting for payment at a time. A single online order can be up to ₹1,00,000.",
            "If an item turns out to be unavailable after you have paid, we will call you and offer a replacement or a full refund for it.",
            <>
              Orders are collected from the shop. See our <PLink href="/pickup-policy">Pickup &amp; delivery policy</PLink>.
            </>,
          ]}
        />
        <p>You can also send your cart to us as a request without paying. We then call or WhatsApp you to confirm price and availability; nothing is charged online for a request, and a request is not a confirmed order until we say so.</p>
      </>
    ),
  },
  {
    id: "payments",
    title: "Payments",
    body: (
      <>
        <p>
          Online payments are processed by {PAYMENT_PARTNER}, an RBI-authorised payment aggregator. You can pay with UPI, debit or credit cards, net banking or the other methods Razorpay shows in its payment window. Your card, bank and UPI details are entered in Razorpay&apos;s window and never reach our servers; we receive only the result (paid or not), the payment reference, the payment method and the bank reference number.
        </p>
        <Bullets
          items={[
            "We mark an order paid only after our system has checked the payment directly with Razorpay. A message on your screen alone is not enough, and neither is a message from anyone else.",
            "If money leaves your account but the order doesn't show as paid, don't pay again. Open the order page (it checks with Razorpay) or contact us with the order number. A payment that fails at the bank is returned to you by the bank or Razorpay, usually within 5–7 working days.",
            "We never ask for your card number, CVV, UPI PIN or OTP, by phone, WhatsApp or email. Anyone who does is not us.",
            "Razorpay's own terms and privacy policy apply to the payment itself.",
          ]}
        />
      </>
    ),
  },
  {
    id: "codes",
    title: "Discount codes",
    body: (
      <Bullets
        items={[
          "Discount codes are given out by the shop. Each code can be used once, on one order, and takes the flat amount shown at checkout off the order.",
          "A code may need a minimum order value and may have an end date. It can't be exchanged for cash, resold or combined with another code.",
          "A code is held for your order while you pay. If the payment fails, the order is cancelled or refunded, or the time runs out, the code becomes usable again.",
          "We may cancel codes that were obtained, shared or used in a way we did not intend, and the order they were used on.",
        ]}
      />
    ),
  },
  {
    id: "refunds",
    title: "Cancellations, refunds and returns",
    body: (
      <p>
        How to cancel an order, when your money comes back, how long it takes and how returns at the counter work is set out in our <PLink href="/refund-policy">Refunds &amp; cancellation policy</PLink>. Nothing in these terms limits your rights under the Consumer Protection Act, 2019.
      </p>
    ),
  },
  {
    id: "use",
    title: "Using the website fairly",
    body: (
      <>
        <p>You agree not to:</p>
        <Bullets
          items={[
            "try to break into accounts, the shop's systems or the payment flow, or probe them for weaknesses without our written permission;",
            "place fake or fraudulent orders, use someone else's payment method without permission, or abuse discount codes;",
            "overload the website, or use bots, scrapers or automated tools to copy the catalogue, prices or pictures;",
            "post unlawful, abusive or misleading content in any form on the website.",
          ]}
        />
        <p>If you find a security problem, please tell us ({contactLine(b)}) before making it public, and we will thank you and fix it.</p>
      </>
    ),
  },
  {
    id: "ip",
    title: "Our content and other people's brands",
    body: (
      <p>
        The website&apos;s design, text and the shop&apos;s logo belong to {b.name}. Brand names, logos and product pictures belong to their manufacturers and are used here only to identify the products we sell. You may view and print pages for your own use, but may not copy them for commercial use without our written permission.
      </p>
    ),
  },
  {
    id: "warranty",
    title: "Product information and warranty",
    body: (
      <p>
        Product information is general guidance. For pressure ratings, load, compatibility or fitting advice for your job, ask us or follow the manufacturer&apos;s instructions; we are happy to help you choose. Products carry the manufacturer&apos;s warranty where one is offered, and we help you make a claim. We make no promise of fitness for a particular purpose beyond what the manufacturer states.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Our responsibility",
    body: (
      <>
        <p>
          We are responsible for supplying the goods you ordered, in the condition described, or for refunding what you paid. To the extent the law allows, we are not liable for indirect or consequential loss (such as lost profit or the cost of rework), for loss caused by incorrect installation or use against the manufacturer&apos;s instructions, for interruptions of the website, payment gateway, banks or networks, or for events beyond our reasonable control such as floods, strikes, supply disruptions or power or internet failures. Our total liability for any order is limited to the amount you paid for it.
        </p>
        <p>Nothing here excludes liability that the law does not allow us to exclude, including for fraud or for goods that are defective or not as described.</p>
      </>
    ),
  },
  {
    id: "law",
    title: "Law and disputes",
    body: (
      <p>
        These terms are governed by the laws of India. Please talk to us first about any problem; most are sorted out at the counter or on the phone. Subject to your rights as a consumer to approach the consumer commission where you live or work, any dispute that cannot be settled between us is subject to the courts with jurisdiction over {b.city}
        {b.district ? `, ${b.district} district` : ""}
        {stateName(b.stateCode) ? `, ${stateName(b.stateCode)}` : ""}.
      </p>
    ),
  },
  grievanceSection(b),
  {
    id: "general",
    title: "General",
    body: (
      <Bullets
        items={[
          "We may update these terms; the date at the top shows the latest version. The version in force when you placed an order applies to that order. Carrying on using the website after a change means you accept it.",
          "If any part of these terms is found unenforceable, the rest stays in force.",
          "Our not enforcing a term at some time doesn't mean we give it up.",
          <>
            These terms, with the policies linked above, are the whole agreement between you and us about the website. For any question, {contactLine(b)}.
          </>,
        ]}
      />
    ),
  },
];

export default function TermsPage() {
  return <PolicyPage title="Terms of use" path="/terms" intro="The rules for using this website, your customer account, online orders and payments." sections={sections} />;
}
