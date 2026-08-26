import type { Metadata } from "next";
import Link from "next/link";
import PersonCardView from "@/components/PersonCard";
import { GithubMark, XMark } from "@/components/icons";
import { listCards, countCards } from "@/lib/cards.server";
import { ROLES, isRoleKey, kindForRole, roleForKind } from "@/lib/roles";
import { KIND, type IdentityKind } from "@/lib/identity";

// Read per request, always. Both of the Supabase reads below go through
// `serverSupabase()`, which returns null WITHOUT touching cookies() when the
// deployment has no Supabase env — and cookies() was the only thing making this
// page dynamic. On a build where those vars are runtime-only, the directory was
// prerendered empty and served from the full route cache to everyone.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discover — Paytag",
  description:
    "Developers and community contributors in the Stellar ecosystem, each one payable by handle. The money waits in escrow until they withdraw it.",
};

/** ?on=gh | x — which platform the handle lives on. */
const PLATFORM: Record<string, IdentityKind> = {
  gh: KIND.GithubUser,
  x: KIND.XUser,
};

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; on?: string; deleted?: string }>;
}) {
  const { role: rawRole, on: rawOn, deleted } = await searchParams;

  // ONE filter, because there was only ever one fact. The role is the platform
  // now (lib/roles.ts), so "Developer" and "GitHub" selected the same rows —
  // two rows of chips, one of them a copy of the other, and a `?role=dev&on=x`
  // that could return nothing at all. `?role=` is still read so that links
  // already shared keep working; it resolves to its platform.
  const legacy = isRoleKey(rawRole) ? kindForRole(rawRole) : null;
  const kind: IdentityKind | null =
    (rawOn ? (PLATFORM[rawOn] ?? null) : null) ?? legacy;
  const on = kind === null ? null : kind === KIND.XUser ? "x" : "gh";

  // Both at once: the counts draw the filters the list sits under, so waiting
  // for one and then the other would show chips with no numbers first.
  const [cards, counts] = await Promise.all([
    listCards({ kind }),
    countCards(),
  ]);

  const href = (next: string | null) => (next ? `/app?on=${next}` : "/app");

  return (
    <div className="space-y-6">
      {/* Where a deleted account lands. One line, and it says the part people
          worry about: the money was never in the account. */}
      {deleted === "1" && (
        <p className="card p-4 text-sm">
          Account deleted. Escrow belongs to the handle, so verifying it again
          brings it back.
        </p>
      )}

      {/* Nothing about the reader on this page.
          It carried two things that stopped paying for themselves: a "listed as
          @you" row, when an account holds at most two cards and Settings already
          lists them; and a handle field, when the directory shows everyone. That
          field now lives in exactly one place — the 404 page, where a mistyped
          handle actually lands. It used to sit under a person's page too, which
          read as "or maybe not them". */}

      <h1 className="text-2xl font-bold tracking-tight">People to pay</h1>

      {/* One filter. Links rather than buttons: a filtered list is worth
          sharing, and the back button should undo a filter. The chips carry the
          role word with the platform's mark beside it, because those are now the
          same distinction said two ways. */}
      <nav className="flex flex-wrap items-center gap-2" aria-label="Who">
        <Chip href={href(null)} active={on === null} label="Everyone" n={counts.total} />
        <Chip
          href={href("gh")}
          active={on === "gh"}
          label={ROLES[roleForKind(KIND.GithubUser)].label}
          n={counts.kind.github}
          icon={<GithubMark size={13} />}
        />
        <Chip
          href={href("x")}
          active={on === "x"}
          label={ROLES[roleForKind(KIND.XUser)].label}
          n={counts.kind.x}
          icon={<XMark size={12} />}
        />
      </nav>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <AddTile />
        </li>
        {cards.map((c) => (
          <li key={`${c.kind}:${c.handle}`}>
            <PersonCardView card={c} />
          </li>
        ))}
      </ul>

      {cards.length === 0 && counts.total > 0 && (
        <p className="text-sm text-mute">
          Nothing in this group.{" "}
          <Link className="link" href="/app">
            Clear the filters
          </Link>
          .
        </p>
      )}
    </div>
  );
}

/**
 * "Add me to this list", as a slot in the list.
 *
 * A dashed cell in the first position reads as an empty seat at the table:
 * whatever the filters say, there is always a place for you. It replaces three
 * sentences of invitation copy with one plus sign.
 */
function AddTile() {
  return (
    <Link
      href="/app/submit"
      className="group flex h-full min-h-44 flex-col items-center justify-center gap-2 rounded-[0.875rem] border-2 border-dashed border-line-strong p-4 text-center transition-colors hover:border-accent"
    >
      <span
        aria-hidden
        className="grid h-12 w-12 place-items-center rounded-full bg-accent text-2xl font-bold leading-none text-accent-fg"
      >
        +
      </span>
      <span className="font-semibold">Submit yourself</span>
      <span className="text-xs text-mute">Get paid for what you ship</span>
    </Link>
  );
}

function Chip({
  href,
  active,
  label,
  n,
  icon,
}: {
  href: string;
  active: boolean;
  label: string;
  n?: number;
  icon?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
        active
          ? "border-accent bg-accent text-accent-fg"
          : "border-line text-mute hover:border-line-strong hover:text-text"
      }`}
    >
      {icon}
      <span>{label}</span>
      {n !== undefined && (
        <span className={`num ${active ? "opacity-70" : "text-mute"}`}>{n}</span>
      )}
    </Link>
  );
}
