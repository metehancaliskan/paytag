import type { Metadata } from "next";
import Link from "next/link";
import PersonCardView from "@/components/PersonCard";
import HandleSearch from "@/components/HandleSearch";
import YouStrip from "@/components/YouStrip";
import { listCards, countByRole } from "@/lib/cards.server";
import { ROLE_LIST, isRoleKey, type RoleKey } from "@/lib/roles";

export const metadata: Metadata = {
  title: "Discover — Paytag",
  description:
    "Developers and amplifiers in the Stellar ecosystem, each one payable by handle. The money waits in escrow until they withdraw it.",
};

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role: rawRole } = await searchParams;
  const role: RoleKey | null = isRoleKey(rawRole) ? rawRole : null;

  // Both at once: the counts draw the filter the list sits under, so waiting
  // for one and then the other would show a filter with no numbers first.
  const [cards, counts] = await Promise.all([listCards(role), countByRole()]);
  const total = counts.shiller + counts.dev;

  return (
    <div className="space-y-6">
      {/* The only row about the reader. Everything below is about everyone
          else, which is the right proportion for a directory. */}
      <YouStrip />

      {/* Paying a handle that is not listed is the original promise and must
          stay one field away, not behind a menu. */}
      <div className="card p-4">
        <p className="mb-2.5 text-sm text-mute">
          Know who you want to pay? Type their handle.
        </p>
        <HandleSearch />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">People to pay</h1>
          <p className="mt-1 text-sm text-dim">
            They named what they do. You name the amount.
          </p>
        </div>

        {/* Links rather than buttons: a filtered list is worth sharing, and
            the back button should undo a filter. */}
        <nav className="flex flex-wrap items-center gap-2" aria-label="Filter">
          <Filter href="/app" active={role === null} label="Everyone" n={total} />
          {ROLE_LIST.map((r) => (
            <Filter
              key={r.key}
              href={`/app?role=${r.key}`}
              active={role === r.key}
              label={r.label}
              n={counts[r.key]}
            />
          ))}
        </nav>
      </div>

      {cards.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <li key={`${c.kind}:${c.handle}`}>
              <PersonCardView card={c} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="card p-6">
          <h2 className="font-semibold">
            {total === 0 ? "Nobody is listed yet" : "Nobody in this group yet"}
          </h2>
          <p className="mt-1.5 text-sm text-mute">
            {total === 0
              ? "Be the first. Verify a handle, write two sentences, and the list has a first entry."
              : "Try the other group — or put yourself in this one."}
          </p>
          <Link className="btn btn-ghost mt-4" href="/app/submit">
            Submit yourself
          </Link>
        </div>
      )}
    </div>
  );
}

function Filter({
  href,
  active,
  label,
  n,
}: {
  href: string;
  active: boolean;
  label: string;
  n: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
        active
          ? "border-accent bg-accent text-accent-fg"
          : "border-line text-mute hover:border-line-strong hover:text-text"
      }`}
    >
      {label}
      <span className={`num ml-1.5 ${active ? "opacity-70" : "text-mute"}`}>
        {n}
      </span>
    </Link>
  );
}
