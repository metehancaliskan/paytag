import { KIND, slugOf, type IdentityKind } from "./identity";
import { MAX_LINKS, isRoleKey, type RoleKey } from "./roles";

/**
 * A contribution card, as the interface uses it.
 *
 * Everything here comes out of the `public_cards` view, which means it comes
 * out of a database row shaped by row level security. Two consequences drive
 * the parsing below:
 *
 *   1. `links` and `linked_identities` are jsonb. Postgres will hand back
 *      whatever was written; nothing about the column type says the shape is
 *      right. So the values are parsed, not cast.
 *   2. A row exists for every verified identity, with or without a card.
 *      `hasCard` is the difference, and the directory filters on it.
 */

export type CardLink = { url: string; host: string };

export type PersonCard = {
  kind: IdentityKind;
  handle: string;
  identityKey: string;
  displayName: string | null;
  role: RoleKey | null;
  headline: string | null;
  summary: string | null;
  ecosystems: string[];
  links: CardLink[];
  updatedAt: string | null;
  hasCard: boolean;
  /** The person's other verified identities — the GitHub ⇄ X link. */
  linked: { kind: IdentityKind; handle: string }[];
};

/** Exactly the columns the interface reads. `select("*")` on a view invites drift. */
export const CARD_COLUMNS =
  "kind, handle, identity_key, display_name, role, headline, summary, ecosystems, links, updated_at, has_card, linked_identities";

function asKind(v: unknown): IdentityKind | null {
  return v === KIND.GithubUser || v === KIND.XUser ? v : null;
}

/**
 * Only http(s), and only an absolute URL. A card is a public page: a
 * `javascript:` href written into the database would run in the reader's
 * browser, and a relative one would silently point at Paytag itself.
 */
export function parseLink(raw: unknown): CardLink | null {
  const text = typeof raw === "string" ? raw : null;
  const obj =
    !text && raw && typeof raw === "object"
      ? (raw as { url?: unknown }).url
      : null;
  const candidate = text ?? (typeof obj === "string" ? obj : null);
  if (!candidate) return null;

  try {
    const url = new URL(candidate.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { url: url.toString(), host: url.host.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

export function toPersonCard(row: unknown): PersonCard | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;

  const kind = asKind(r.kind);
  const handle = typeof r.handle === "string" ? r.handle : null;
  const identityKey =
    typeof r.identity_key === "string" ? r.identity_key : null;
  if (kind === null || !handle || !identityKey) return null;

  const links = Array.isArray(r.links)
    ? r.links
        .map(parseLink)
        .filter((l): l is CardLink => l !== null)
        .slice(0, MAX_LINKS)
    : [];

  const linked = Array.isArray(r.linked_identities)
    ? r.linked_identities.flatMap((v) => {
        if (!v || typeof v !== "object") return [];
        const o = v as { kind?: unknown; handle?: unknown };
        const k = asKind(o.kind);
        return k !== null && typeof o.handle === "string"
          ? [{ kind: k, handle: o.handle }]
          : [];
      })
    : [];

  return {
    kind,
    handle,
    identityKey,
    displayName:
      typeof r.display_name === "string" && r.display_name.trim() !== ""
        ? r.display_name
        : null,
    role: isRoleKey(r.role) ? r.role : null,
    headline: typeof r.headline === "string" ? r.headline : null,
    summary: typeof r.summary === "string" ? r.summary : null,
    ecosystems: Array.isArray(r.ecosystems)
      ? r.ecosystems.filter((e): e is string => typeof e === "string")
      : [],
    links,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
    hasCard: r.has_card === true,
    linked,
  };
}

export function cardPath(card: {
  kind: IdentityKind;
  handle: string;
}): string {
  return `/p/${slugOf(card.kind)}/${card.handle}`;
}

/**
 * The profile picture for a handle, without an API call and without a token.
 *
 * GitHub: `github.com/<user>.png` is a permanent redirect to the avatar. Free,
 * official, unmetered.
 *
 * X: there is no such endpoint. X's own API would charge $0.010 per lookup
 * (docs/API-COSTS.md), and scraping x.com is against their terms and breaks
 * whenever the page changes. So this goes through unavatar.io, which resolves an
 * X handle to its picture. What that buys and what it costs:
 *
 *   - Free, no key. The 25-per-day anonymous quota is counted against the
 *     VISITOR's IP, like GitHub's rate limit, because these URLs are loaded by
 *     the browser as `<img>` sources. Their cache hits do not count at all, so
 *     handles anybody has looked at recently are free.
 *   - `fallback=false` is the important parameter. Without it a name nobody
 *     holds comes back as a generic silhouette WITH a 200 — a picture that
 *     looks like a real account's. With it, an unresolvable handle 404s and
 *     <Avatar> shows initials instead. A missing picture is honest; an invented
 *     one on a page about to move money is not.
 *   - It is a third party in the request path: unavatar sees the visitor's IP
 *     and which X handle is being displayed. The same is already true of
 *     GitHub's avatar CDN. Nothing else is sent, and no picture is ever
 *     evidence: an avatar that loads does not mean the account is the right
 *     one, and the interface must not imply that it does.
 */
export function avatarUrl(card: {
  kind: IdentityKind;
  handle: string;
}): string | null {
  if (card.kind === KIND.GithubUser) {
    return `https://github.com/${card.handle}.png?size=128`;
  }
  if (card.kind === KIND.XUser) {
    return `https://unavatar.io/x/${encodeURIComponent(card.handle)}?fallback=false`;
  }
  return null;
}
