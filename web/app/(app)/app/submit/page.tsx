import type { Metadata } from "next";
import Link from "next/link";
import CardEditor from "@/components/CardEditor";

export const metadata: Metadata = {
  title: "Submit yourself — Paytag",
  description:
    "Say what you contribute to the Stellar ecosystem, and let people pay your handle for it.",
};

export default function SubmitPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/app"
          className="inline-block text-sm text-mute hover:text-text"
        >
          ← Back to everyone
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          Submit yourself
        </h1>
        <p className="mt-2 max-w-xl text-dim">
          A role and two fields. It puts you in the list, where people pay your
          handle.
        </p>
      </div>

      <CardEditor />
    </div>
  );
}
