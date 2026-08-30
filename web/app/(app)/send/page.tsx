import type { Metadata } from "next";
import SendTo from "@/components/SendTo";
import { KIND } from "@/lib/identity";
import { X_ENABLED } from "@/lib/config";

export const metadata: Metadata = {
  title: "Send · Paytag",
  description:
    "Pay a GitHub or X handle directly. The account is checked before anything is sent.",
};

/**
 * Paying a handle you already know.
 *
 * Two sections, one per platform, and that is the whole reason this page exists
 * separately from the directory: the directory is for finding somebody, and this
 * is for when you already have the name. Splitting them by platform rather than
 * putting a picker on one field is deliberate — the same name on GitHub and on X
 * can be two different people, and a field with a platform *selector* makes the
 * most dangerous input on the page look like a filter (docs/DESIGN.md: money
 * paths have no defaults). Two labelled sections cannot be got wrong.
 *
 * Both sections are always shown, X included when the deployment has X sign-in
 * switched off: money can be sent to an X handle whether or not anybody can
 * verify it yet, and hiding the section would hide that the escrow is waiting.
 */
export default function SendPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Send</h1>
        <p className="mt-1.5 text-dim">
          Check the account, then send. It waits in escrow until they claim it.
        </p>
      </header>

      <SendTo kind={KIND.GithubUser} />
      <SendTo kind={KIND.XUser} />

      {!X_ENABLED && (
        <p className="px-1 text-xs text-mute">
          X sign-in is not configured on this deployment, so nobody can verify an
          X handle here yet. Money sent to one waits until they can.
        </p>
      )}
    </div>
  );
}
