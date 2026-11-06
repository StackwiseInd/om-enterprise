import type { Metadata } from "next";
import { Bullets, contactLine, PLink, PolicyPage, type Business } from "@/components/public/policy";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What personal details the OM ENTERPRISE website collects, why, who they are shared with, how long they are kept, and your rights.",
  alternates: { canonical: "/privacy" },
};

const sections = (b: Business) => [
  {
    id: "summary",
    title: "In short",
    body: (
      <p>
        We collect only what we need to answer your enquiries and to sell you the items you order. We don&apos;t sell your details, we don&apos;t show ads, and the website has no advertising or tracking cookies. {b.name} is responsible for your data.
      </p>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <Bullets
        items={[
          <>
            <strong>Customer account:</strong> your name, mobile number, email if you give it, and your password, which is stored only in scrambled (hashed) form that nobody can read back.
          </>,
          <>
            <strong>Orders:</strong> the items, amounts, any discount code, and payment details that PhonePe gives us: the payment status, payment method (for example UPI or card), the transaction ID and the bank reference (UTR). We never receive your card number, CVV, bank password or UPI PIN.
          </>,
          <>
            <strong>Enquiries and order requests:</strong> the name, mobile number, email, city, address and message you type in the form, and how you prefer to be contacted.
          </>,
          <>
            <strong>Security records:</strong> the date and time of sign-ins and of each step of an order, your browser type, and your IP address. The IP address is kept as a one-way code, used to limit abuse such as repeated sign-up or code-guessing attempts.
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
          "To call or WhatsApp you about your order or enquiry.",
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
              <strong>PhonePe Payment Gateway</strong> (PhonePe Limited), to process your payment and any refund. We send PhonePe the order reference, amount and your mobile number; PhonePe&apos;s own privacy policy covers what you enter on its payment page.
            </>,
            <>
              <strong>Our hosting and database providers</strong>, which store the website and its data for us under their security terms and may not use it for anything else.
            </>,
            <>
              <strong>Government authorities</strong>, only when the law requires it, for example for tax records.
            </>,
          ]}
        />
        <p>When you choose to message us on WhatsApp, that conversation is also covered by WhatsApp&apos;s terms.</p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and your browser",
    body: (
      <Bullets
        items={[
          "One sign-in cookie keeps you signed in to your customer account for up to 30 days, or until you sign out. Staff have a separate sign-in cookie for the shop's system.",
          "Your cart is saved only in your own browser (local storage) until you place the order or clear it. It isn't sent to us until you check out or send a request.",
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
        Orders, payments and bills are kept for as long as tax law requires us to keep accounts (under GST, generally six years after the year they relate to). Enquiries you send without ordering are kept while they are useful for following up, and deleted when you ask. Your account stays until you ask us to close it; we then remove your sign-in details and keep only the order records the law requires.
      </p>
    ),
  },
  {
    id: "security",
    title: "Keeping it safe",
    body: <p>The website is served only over encrypted connections (HTTPS). Passwords are hashed, access for shop staff is limited by role and protected by sign-in, and every change to an order is recorded in an audit log. No system is perfectly secure, but we will tell you and the authorities as the law requires if a breach affects your details.</p>,
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>Under India&apos;s Digital Personal Data Protection Act, 2023, you can ask us:</p>
        <Bullets
          items={[
            "for a summary of the personal details we hold about you;",
            "to correct or update them;",
            "to delete them, except records we must keep by law (such as bills and payment records);",
            "to stop using them for anything you had agreed to, such as being contacted about an enquiry.",
          ]}
        />
        <p>
          To make a request or raise a complaint, {contactLine(b)}. We reply within 30 days. If you are not satisfied with our answer, you can complain to the Data Protection Board of India.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: <p>Online ordering is for adults. If you are under 18, please ask a parent or guardian to place the order.</p>,
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        If we change what we collect or how we use it, we will update this page and its date. See also our <PLink href="/terms">Terms of use</PLink>.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return <PolicyPage title="Privacy policy" path="/privacy" intro="What we collect when you use this website, why we need it, and how you stay in control of it." sections={sections} />;
}
