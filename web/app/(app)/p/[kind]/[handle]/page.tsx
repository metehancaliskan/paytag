import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  KIND,
  KIND_SLUG,
  identityKey,
  isKindSlug,
  kindLabel,
  kindUrlPrefix,
  normalizeHandle,
  profileUrl,
  toHex,
  type IdentityKind,
  type KindSlug,
} from "@/lib/identity";
import { fetchGithubProfile, type GithubProfile } from "@/lib/github";
import ProfilePanel from "@/components/ProfilePanel";
import ShareLink from "@/components/ShareLink";
import { PersonCardDetail, NoCardYet } from "@/components/PersonCard";
import Avatar from "@/components/Avatar";
import { avatarUrl } from "@/lib/cards";
import { getCard } from "@/lib/cards.server";

// Same reason as the directory: this page's freshness must not depend on
// whether an env var happened to be present at build time. A person's page
// showing "no card yet" forever, cached, is the worst version of that.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ kind: string; handle: string }> };

type Resolved = { slug: KindSlug; kind: IdentityKind; handle: string };

function resolve(rawKind: string, rawHandle: string): Resolved | null {
  if (!isKindSlug(rawKind)) return null;
  const kind = KIND_SLUG[rawKind];
  try {
    return {
      slug: rawKind,
      kind,
      handle: normalizeHandle(decodeURIComponent(rawHandle), kind),
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { kind, handle } = await params;
  const r = resolve(kind, handle);
  if (!r) return { title: "Paytag" };
  return {
    title: `@${r.handle} · ${kindLabel(r.kind)} · Paytag`,
    description: `Pay ${kindUrlPrefix(r.kind)}${r.handle}. It waits until the owner of the account verifies it and claims it.`,
  };
}

export default async function ProfilePage({ params }: Params) {
  const { kind: rawKind, handle: rawHandle } = await params;
  const r = resolve(rawKind, rawHandle);
  if (!r) notFound();
  // Pin the URL to the canonical spelling: /p/gh/Torvalds and /p/gh/torvalds
  // are the same identity and should not look like two pages.
  if (r.handle !== rawHandle) redirect(`/p/${r.slug}/${r.handle}`);

  const [profile, key, card] = await Promise.all([
    r.kind === KIND.GithubUser
      ? fetchGithubProfile(r.handle)
      : Promise.resolve(null),
    identityKey(r.handle, r.kind),
    // The card is what this person says about themselves; the GitHub profile
    // above is what GitHub says. Both, or neither, and the page still works.
    getCard(r.kind, r.handle),
  ]);
  const identityHex = toHex(key);

  return (
    <div className="space-y-8">
      <Link
        href="/app"
        className="inline-block text-sm text-mute hover:text-text"
      >
        ← Back to everyone
      </Link>

      {/* Nothing follows this grid. There used to be a "Pay someone else" field
          under it, which is a strange thing to put at the bottom of one
          person's page: the reader came here for THIS handle, and a search box
          for a different one reads as "or maybe not them". Finding a handle
          belongs where somebody is looking for one — the 404 page, which is
          exactly where a mistyped handle lands.

          Explicit grid placement rather than one sidebar column, so the order
          differs by width: on a phone the identity comes first (who am I
          paying?), then the escrow and the send form, and the supporting cards
          last. A single stacked sidebar would push the actual payment three
          screens down. */}
      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start">
        <div className="lg:col-start-1 lg:row-start-1">
          <IdentityCard resolved={r} profile={profile} />
        </div>

        <section className="space-y-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <ProfilePanel
            handle={r.handle}
            identityHex={identityHex}
            kind={r.kind}
          />
        </section>

        <aside className="space-y-4 lg:col-start-1 lg:row-start-2">
          {card?.hasCard ? (
            <PersonCardDetail card={card} />
          ) : (
            <NoCardYet handle={r.handle} kind={r.kind} />
          )}
          <ShareLink path={`/p/${r.slug}/${r.handle}`} />
        </aside>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------- identity

function IdentityCard({
  resolved,
  profile,
}: {
  resolved: Resolved;
  profile: GithubProfile | null;
}) {
  const { kind, handle } = resolved;
  const label = kindLabel(kind);

  return (
    <div className="card p-5">
      <span className="badge">{label} identity</span>

      <div className="mt-4 flex items-center gap-4">
        {/* GitHub's answer if we have it, otherwise the derived URL — which is
            how an X page gets a picture at all (lib/cards.ts). */}
        <Avatar
          src={profile?.avatarUrl ?? avatarUrl({ kind, handle })}
          handle={handle}
          size={64}
        />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold">
            {profile?.name ?? handle}
          </h1>
          <a
            className="text-sm text-mute hover:text-text"
            href={profileUrl(kind, handle)}
            target="_blank"
            rel="noreferrer"
          >
            {kindUrlPrefix(kind)}
            {handle}
          </a>
        </div>
      </div>

      {profile?.bio && (
        <p className="mt-4 text-sm leading-relaxed text-dim">
          {profile.bio}
        </p>
      )}

      {profile && (
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
          <div>
            <dt className="text-xs text-mute">Followers</dt>
            <dd className="num font-semibold">{profile.followers}</dd>
          </div>
          <div>
            <dt className="text-xs text-mute">Public repos</dt>
            <dd className="num font-semibold">{profile.publicRepos}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-mute">On GitHub since</dt>
            <dd className="num font-semibold">
              {new Date(profile.createdAt).getFullYear()}
            </dd>
          </div>
        </dl>
      )}

      {/* Only when we asked and got nothing back. It used to be a paragraph;
          the fact it carries is one clause long, and the rest was reassurance
          nobody asked for.

          There is no X equivalent, deliberately. X pages carried this line
          permanently, because there is no free preview to fail: it said the
          same thing on every X page forever, which makes it wallpaper rather
          than information. What it asked for is already on the card anyway,
          since the handle above is a link to the profile. A line that is always
          on screen tells a reader nothing about the page they are on. */}
      {!profile && kind === KIND.GithubUser && (
        <p className="mt-4 text-sm text-mute">
          No GitHub preview. You can still send.
        </p>
      )}
    </div>
  );
}
