import type { Metadata } from "next";
import Link from "next/link";
import PersonCardView from "@/components/PersonCard";
import HandleSearch from "@/components/HandleSearch";
import YouStrip from "@/components/YouStrip";
import { GithubMark, XMark } from "@/components/icons";
import { listCards, countCards } from "@/lib/cards.server";
import { ROLE_LIST, isRoleKey, type RoleKey } from "@/lib/roles";
import { KIND, type IdentityKind } from "@/lib/identity";

export const metadata: Metadata = {
  title: "Discover — Paytag",
  description:
    "Developers and amplifiers in the Stellar ecosystem, each one payable by handle. The money waits in escrow until they withdraw it.",
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
  const role: RoleKey | null = isRoleKey(rawRole) ? rawRole : null;
  const kind: IdentityKind | null = rawOn ? (PLATFORM[rawOn] ?? null) : null;
  const on = kind === null ? null : rawOn!;

  // Both at once: the counts draw the filters the list sits under, so waiting
  // for one and then the other would show chips with no numbers first.
  const [cards, counts] = await Promise.all([
    listCards({ role, kind }),
    countCards(),
  ]);

  // Keeps the other filter when one changes, so picking "X" does not silently
  // drop the role you were looking at.
  const href = (next: { role?: RoleKey | null; on?: string | null }) => {
    const q = new URLSearchParams();
    const r = next.role === undefined ? role : next.role;
    const o = next.on === undefined ? on : next.on;
    if (r) q.set("role", r);
    if (o) q.set("on", o);
    const s = q.toString();
    return s ? `/app?${s}` : "/app";
  };

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

      {/* The only row about the reader. Everything below is about everyone
          else, which is the right proportion for a directory. */}
      <YouStrip />

      {/* Paying a handle that is not listed is the original promise and must
          stay one field away, not behind a menu. */}
      <div className="card p-4">
        <HandleSearch />
      </div>

      <h1 className="pt-2 text-2xl font-bold tracking-tight">People to pay</h1>

      {/* Two filters, one line. Links rather than buttons: a filtered list is
          worth sharing, and the back button should undo a filter. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <nav className="flex flex-wrap items-center gap-2" aria-label="Platform">
          <Chip href={href({ on: null })} active={on === null} label="All" n={counts.total} />
          <Chip
            href={href({ on: "gh" })}
            active={on === "gh"}
            label="GitHub"
            n={counts.kind.github}
            icon={<GithubMark size={13} />}
          />
          <Chip
            href={href({ on: "x" })}
            active={on === "x"}
            label="X"
            n={counts.kind.x}
            icon={<XMark size={12} />}
            iconIsName
          />
        </nav>

        <nav
          className="flex flex-wrap items-center gap-2 sm:ml-auto"
          aria-label="Role"
        >
          <Chip
            href={href({ role: null })}
            active={role === null}
            label="Everyone"
            quiet
          />
          {ROLE_LIST.map((r) => (
            <Chip
              key={r.key}
              href={href({ role: r.key })}
              active={role === r.key}
              label={r.label}
              n={counts.role[r.key]}
              quiet
            />
          ))}
        </nav>
      </div>

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
  iconIsName = false,
  quiet = false,
}: {
  href: string;
  active: boolean;
  label: string;
  n?: number;
  icon?: React.ReactNode;
  /**
   * The icon already *is* the name — X's mark is the letter X. Printing both
   * gives you "𝕏 X 1". The label stays for screen readers.
   */
  iconIsName?: boolean;
  /** The role row is secondary to the platform row, and reads that way. */
  quiet?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-semibold transition-colors ${
        quiet ? "text-xs" : "text-sm"
      } ${
        active
          ? "border-accent bg-accent text-accent-fg"
          : "border-line text-mute hover:border-line-strong hover:text-text"
      }`}
    >
      {icon}
      <span className={iconIsName ? "sr-only" : undefined}>{label}</span>
      {n !== undefined && (
        <span className={`num ${active ? "opacity-70" : "text-mute"}`}>{n}</span>
      )}
    </Link>
  );
}
