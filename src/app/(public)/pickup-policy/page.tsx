import type { Metadata } from "next";
import { addressLines, directionsHref, mapsHref } from "@/components/public/site-data";
import { ShopMap } from "@/components/public/shop-map";
import { Bullets, contactLine, PLink, PolicyPage, type Business } from "@/components/public/policy";

export const metadata: Metadata = {
  title: "Pickup & delivery",
  description: "Online orders at OM ENTERPRISE are collected from the shop. When your order is ready, what to bring, and how delivery of larger orders is arranged.",
  alternates: { canonical: "/pickup-policy" },
};

const sections = (b: Business) => [
  {
    id: "pickup",
    title: "Collect from the shop",
    body: (
      <>
        <p>Orders paid on this website are collected from the shop. We don&apos;t ship online orders by courier or post, so there are no shipping charges on online orders.</p>
        <p className="rounded-lg bg-navy-50 px-4 py-3 text-navy-800">
          <strong>{b.name}</strong>
          <br />
          {addressLines(b).join(", ")}
          {b.openingHours ? (
            <>
              <br />
              Open: {b.openingHours}
            </>
          ) : null}
        </p>
        <ShopMap name={b.name} embedUrl={b.mapEmbedUrl} opensHref={mapsHref(b)} directionsHref={directionsHref(b)} />
      </>
    ),
  },
  {
    id: "when",
    title: "When your order is ready",
    body: (
      <Bullets
        items={[
          "Once Razorpay confirms your payment, the order page shows “Order placed” and we start keeping the items ready.",
          "Items in stock are usually ready the same working day, during shop hours. When the order is packed, the page shows “Ready for pickup”.",
          "If an item has to be ordered in, we call you with the expected date before you travel.",
          "Please collect within 7 days of the order being ready. If you need longer, tell us and we'll keep it aside.",
        ]}
      />
    ),
  },
  {
    id: "bring",
    title: "What to bring",
    body: (
      <Bullets
        items={[
          "Your order number (it starts with OL), on your phone or written down.",
          "The mobile number used on the order. Someone else can collect for you if they have both, and we may ask them for identification.",
          "Check the items at the counter. We replace anything damaged or wrong on the spot, and give you the GST bill.",
        ]}
      />
    ),
  },
  {
    id: "ownership",
    title: "Ownership and risk",
    body: <p>The items stay ours, and at our risk, until you collect them. From the moment you collect them they are yours, and so is the responsibility for loading and carrying them safely. Heavy goods (pipes, tanks, bags) should be loaded with care; ask our staff for help.</p>,
  },
  {
    id: "delivery",
    title: "Delivery of larger orders",
    body: (
      <p>
        For large or heavy orders (pipes, tanks, cement and the like), local delivery may be possible. It is arranged by phone, and the delivery charge, timing and unloading are agreed with you before dispatch; it is not part of the online payment. To ask, {contactLine(b)}, or send your cart as a request from the cart page.
      </p>
    ),
  },
  {
    id: "uncollected",
    title: "Orders not collected",
    body: (
      <p>
        If we can&apos;t reach you and an order isn&apos;t collected within 30 days of being ready, we may cancel it and refund the amount paid to your original payment method, as described in our <PLink href="/refund-policy">Refunds &amp; cancellation policy</PLink>.
      </p>
    ),
  },
];

export default function PickupPolicyPage() {
  return <PolicyPage title="Pickup & delivery" path="/pickup-policy" intro="Online orders are collected from the shop. Here is when they're ready and what to bring." sections={sections} />;
}
