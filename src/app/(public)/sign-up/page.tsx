import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/page";
import { Container } from "@/components/public/section";
import { ShopAuthForm } from "@/components/public/shop-auth-form";
import { getShopAccount } from "@/server/auth/shop-session";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

export default function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  return (
    <Container className="py-10 sm:py-16">
      <div className="mx-auto max-w-md rounded-xl border border-navy-200 bg-white p-6 shadow-card sm:p-8">
        <h1 className="headline text-[1.75rem] font-bold text-navy-950">Create an account</h1>
        <p className="mt-1.5 text-sm text-navy-500">Just your name, mobile number and a password. You need it to pay online and to follow your orders.</p>
        <div className="mt-6">
          <Suspense fallback={<Skeleton className="h-72 rounded-lg" />}>
            <Form searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </Container>
  );
}

async function Form({ searchParams }: { searchParams: PageProps<"/sign-up">["searchParams"] }) {
  const next = (await searchParams).next;
  const nextPath = typeof next === "string" ? next : null;
  if (await getShopAccount()) redirect(nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/my-orders");
  return <ShopAuthForm mode="sign-up" next={nextPath} />;
}
