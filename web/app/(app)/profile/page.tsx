import type { Metadata } from "next";
import type { ReactNode } from "react";
import ConnectPanel from "@/components/ConnectPanel";
import PayoutPanel from "@/components/PayoutPanel";
import MyCards from "@/components/MyCards";
import DeleteAccount from "@/components/DeleteAccount";
import SignOutButton from "@/components/SignOutButton";

export const metadata: Metadata = {
  title: "Settings — Paytag",
  description:
    "Your verified handles, where your escrow pays out, your cards, and the way out.",
};

/**
 * Settings. Four questions, each with one answer.
 *
 * Labels on the left, controls on the right, hairlines between — the shape
 * every settings page has, and the reason is not fashion: a stack of floating
 * cards gives four unrelated things the same weight and no order, so a reader
 * has to read all of it to find the one row they came for. A label column can
 * be scanned.
 *
 * The order is the order of dependency. An identity comes first because nothing
 * else works without one: a payout address needs an identity to hang off, a
 * card needs one to describe, and a claim needs one to pay. Leaving is last,
 * where nobody reaches it by accident.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string; merged?: string }>;
}) {
  const { auth_error: authError, merged } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <SignOutButton className="ml-auto" />
      </header>

      <div className="mt-4 divide-y divide-line">
        <Section
          title="Accounts"
          hint="A provider confirms the handle is yours. One of each, at most."
        >
          <ConnectPanel authError={authError} merged={merged === "1"} />
        </Section>

        <Section
          title="Payout wallet"
          hint="Where a claim pays. Empty means whichever wallet you connect."
        >
          <PayoutPanel empty="Set one once a handle is connected." />
        </Section>

        <Section
          title="Your cards"
          hint="What the directory shows. Your handle is payable without one."
        >
          <MyCards empty="One card per handle, written after you connect." />
        </Section>

        <Section
          title="Leave"
          hint="Deleting frees your handle. Escrow belongs to the handle, so it stays."
        >
          <DeleteAccount empty="Nothing to delete yet." />
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 py-7 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-mute">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
