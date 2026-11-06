import type { Metadata } from "next";
import { Bullets, contactLine, grievanceSection, PAYMENT_PARTNER, PLink, PolicyPage, type Business } from "@/components/public/policy";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What personal details the OM ENTERPRISE website collects, why, who they are shared with (including Razorpay), how long they are kept, and your rights.",
  alternates: { canonical: "/privacy" },
};

const sections = (b: Business) => [
  {
    id: "summary",
    title: "In short",
    body: (
      <>
        <p>
          We collect only what we need to answer your enquiries and to sell you the items you order. We don&apos;t sell your details, we don&apos;t show ads, and the website has no advertising or tracking cookies. {b.name} is the “data fiduciary” that decides why and how your details are used, under the Digital Personal Data Protection Act, 2023 (DPDP Act).
        </p>
        <p>By creating an account, sending a form or placing an order you agree to this policy. You can withdraw that consent at any time (see “Your rights”).</p>
      </>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <Bullets
        items={[
          <>
            <strong>Customer account:</strong> your name, mobile number, email if you give it, and your password, which is stored only in scrambled (hashed) form that nobody, including us, can read back.
          </>,
          <>
            <strong>Orders:</strong> the items, amounts, any discount code, your name and mobile number, and the payment details Razorpay gives us: whether it was paid, the payment method (for example UPI or card), the payment and refund references, and the bank reference (UTR). We never receive your card number, CVV, UPI PIN, net-banking password or OTP.
          </>,
          <>
            <strong>Enquiries and order requests:</strong> the name, mobile number, email, city, address and message you type in the form, and how you prefer to be contacted.
          </>,
          <>
            <strong>Security records:</strong> the time of each sign-in and of each step of an order, your browser type, and your IP address. The IP address is kept as a one-way code, used only to limit abuse such as repeated sign-up or code-guessing attempts.
          </>,
          <>
            <strong>Counter sales:</strong> if you buy at the shop, the bill records what you bought, the amount, and any name, mobile number or GSTIN you give us for the invoice.
          </>,
        ]}
      />
    ),
  },
  {
    id: "use",
    title: "Why we use it",
    body: (
      <Bullets
        items={[
          "To run your account and keep it secure.",
          "To take payment for, prepare and hand over your order, and to make refunds.",
          "To call or WhatsApp you about your order or enquiry, and to reply to what you asked.",
          "To keep the accounts and GST records the law requires.",
          "To stop fraud and misuse of the website, payments and discount codes.",
        ]}
      />
    ),
  },
  {
    id: "share",
    title: "Who we share it with",
    body: (
      <>
        <Bullets
          items={[
            <>
              <strong>{PAYMENT_PARTNER}</strong>, to process your payment and any refund. We send Razorpay the order reference, the amount, your name and your mobile number; what you enter in Razorpay&apos;s payment window (card, bank or UPI details) goes to Razorpay and your bank, not to us. Razorpay&apos;s own privacy policy covers its use of it.
            </>,
            <>
              <strong>Our technology providers</strong>: the hosting service that runs this website and the database service that stores its records. They process data for us under their security terms and may not use it for anything else. Some of their servers are outside India.
            </>,
            <>
              <strong>Government authorities and courts</strong>, only when the law requires it, for example for tax records or a lawful order.
            </>,
            <>
              <strong>Our accountant</strong>, for bookkeeping and GST filing, bound to keep it confidential.
            </>,
          ]}
        />
        <p>We don&apos;t sell, rent or trade your personal details. When you choose to message us on WhatsApp, that conversation is also covered by WhatsApp&apos;s terms.</p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and your browser",
    body: (
      <Bullets
        items={[
          "One sign-in cookie keeps you signed in to your customer account for up to 30 days, or until you sign out. It is needed for the account to work, is marked secure and HttpOnly, and can't be read by scripts. Staff have a separate sign-in cookie for the shop's system.",
          "Your cart is saved only in your own browser (local storage) until you place the order or clear it. It isn't sent to us until you check out or send a request.",
          "While you pay, Razorpay's payment window may set its own cookies or identifiers to complete and secure the payment; those are covered by Razorpay's policy.",
          "We don't use advertising, analytics or third-party tracking cookies.",
        ]}
      />
    ),
  },
  {
    id: "keep",
    title: "How long we keep it",
    body: (
      <p>
        Orders, payments and bills are kept for as long as tax and accounting law requires us to keep them (under GST, generally six years after the year they relate to). Enquiries you send without ordering are kept while they are useful for following up, and are deleted when you ask. Your account stays until you ask us to close it; we then remove your sign-in details and keep only the order records the law requires. Security records are kept for as long as is needed to investigate misuse.
      </p>
    ),
  },
  {
    id: "security",
    title: "Keeping it safe",
    body: (
      <>
        <p>
          We use reasonable security practices suited to the data we hold, as the Information Technology Act, 2000 and its rules expect. The website is served only over encrypted connections (HTTPS). Passwords are hashed. Access for shop staff is limited by role and protected by a second sign-in step. Payment signatures are verified on our server and a payment is confirmed only with Razorpay itself. Every change to an order is recorded in an audit log.
        </p>
        <p>No system is perfectly secure. If a breach affects your details we will tell you and the authorities as the law requires.</p>
      </>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>Under the DPDP Act you can ask us:</p>
        <Bullets
          items={[
            "for a summary of the personal details we hold about you and who we have shared them with;",
            "to correct or update them;",
            "to erase them, except records we must keep by law (such as bills and payment records);",
            "to stop using them for anything you had agreed to, such as being contacted about an enquiry, by withdrawing your consent;",
            "to name another person to exercise these rights for you if you die or become unable to.",
          ]}
        />
        <p>
          To make a request, {contactLine(b)}. We reply within 30 days. We may need to confirm it is you before we act on it, so that your details can&apos;t be taken or changed by someone else.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: <p>Online ordering is for adults. We don&apos;t knowingly collect details of anyone under 18. If you think a child has given us theirs, tell us and we will delete them.</p>,
  },
  grievanceSection(b),
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        If we change what we collect or how we use it, we will update this page and its date, and tell account holders of any important change. See also our <PLink href="/terms">Terms of use</PLink>.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return <PolicyPage title="Privacy policy" path="/privacy" intro="What we collect when you use this website, why we need it, and how you stay in control of it." sections={sections} />;
}
