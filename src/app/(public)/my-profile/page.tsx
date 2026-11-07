import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/page";
import { Container, PageIntro } from "@/components/public/section";
import { AccountTabs } from "@/components/public/account-tabs";
import { ProfileForm } from "@/components/public/profile-form";
import { getShopAccount } from "@/server/auth/shop-session";
import { getMyProfile } from "@/server/services/shop-profile";

export const metadata: Metadata = { title: "My profile", robots: { index: false } };

export default function MyProfilePage() {
  return (
    <>
      <PageIntro crumbs={[{ href: "/", label: "Home" }, { label: "My profile" }]} title="My profile" />
      <Container className="py-8 sm:py-10">
        <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
          <Content />
        </Suspense>
      </Container>
    </>
  );
}

async function Content() {
  const account = await getShopAccount();
  if (!account) redirect("/sign-in?next=/my-profile");
  const p = await getMyProfile(account);
  return (
    <div className="mx-auto max-w-3xl">
      <AccountTabs active="profile" name={account.name} mobile={account.mobile} />
      <ProfileForm
        profile={{
          name: p.name,
          mobile: p.mobile,
          email: p.email,
          emailVerified: !!p.emailVerifiedAt,
          memberSince: p.createdAt.toISOString(),
          profileUpdatedAt: p.profileUpdatedAt?.toISOString() ?? null,
          businessName: p.businessName,
          gstin: p.gstin,
          altMobile: p.altMobile,
          addressLine1: p.addressLine1,
          addressLine2: p.addressLine2,
          landmark: p.landmark,
          city: p.city,
          state: p.state,
          pincode: p.pincode,
        }}
      />
    </div>
  );
}
