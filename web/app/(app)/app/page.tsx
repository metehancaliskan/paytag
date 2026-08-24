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
  searchParams: Promise<{ role?: string; on?: string }>;
}) {
  const { role: rawRole, on: rawOn } = await searchParams;
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

      <div className="pt-2">
        <h1 className="text-2xl font-bold tracking-tight">People to pay</h1>
        <p className="mt-1 text-sm text-dim">
          They named what they do. Pick an amount and send it.
        </p>
      </div>

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
            {counts.total === 0
              ? "Nobody is listed yet"
              : "Nobody matches these filters"}
          </h2>
          <p className="mt-1.5 text-sm text-mute">
            {counts.total === 0
              ? "Be the first. Verify a handle, write two sentences, and the list has a first entry."
              : "Clear a filter, or put yourself in this group."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {counts.total > 0 && (
              <Link className="btn btn-ghost" href="/app">
                Clear filters
              </Link>
            )}
            <Link className="btn btn-primary" href="/app/submit">
              Submit yourself
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({
  href,
  active,
  label,
  n,
  icon,
  quiet = false,
}: {
  href: string;
  active: boolean;
  label: string;
  n?: number;
  icon?: React.ReactNode;
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
      {label}
      {n !== undefined && (
        <span className={`num ${active ? "opacity-70" : "text-mute"}`}>{n}</span>
      )}
    </Link>
  );
}
