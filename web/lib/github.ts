// GitHub's public profile endpoint.
//
// Needs no token (60 requests per hour per IP). What happens here is NOT
// VERIFICATION: it shows that a profile exists, not who owns that account.
// Ownership is only ever proven through OAuth (Phase 3), and only at the
// moment of a claim.

export type GithubProfile = {
  login: string;
  id: number;
  name: string | null;
  bio: string | null;
  avatarUrl: string;
  htmlUrl: string;
  company: string | null;
  blog: string | null;
  location: string | null;
  followers: number;
  publicRepos: number;
  createdAt: string;
};

type RawUser = {
  login: string;
  id: number;
  name: string | null;
  bio: string | null;
  avatar_url: string;
  html_url: string;
  company: string | null;
  blog: string | null;
  location: string | null;
  followers: number;
  public_repos: number;
  created_at: string;
};

export async function fetchGithubProfile(
  handle: string,
): Promise<GithubProfile | null> {
  try {
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(handle)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "paytag",
        },
        next: { revalidate: 300 },
      },
    );

    if (res.status === 404) return null;
    if (!res.ok) {
      // If the rate limit is spent, paying should still work; returning null
      // drops the page to its plain view instead of tying it to GitHub.
      return null;
    }

    const u = (await res.json()) as RawUser;
    return {
      login: u.login,
      id: u.id,
      name: u.name,
      bio: u.bio,
      avatarUrl: u.avatar_url,
      htmlUrl: u.html_url,
      company: u.company,
      blog: u.blog,
      location: u.location,
      followers: u.followers,
      publicRepos: u.public_repos,
      createdAt: u.created_at,
    };
  } catch {
    // GitHub being unreachable must never take the payment page down with it.
    return null;
  }
}

/**
 * Does this handle still belong to the account we verified?
 *
 * The handle-transfer problem (SPEC §6.2): somebody verifies `bob`, gives the
 * name up, and a stranger takes it on GitHub. The stranger cannot verify it
 * here — `unique (kind, handle)` still points at the first account — but the
 * first account can now claim money that senders left for the *new* bob.
 *
 * `external_id` is the antidote, because it does not change hands. GitHub's
 * public profile endpoint answers with the numeric id for a handle, so at claim
 * time the two can be compared.
 *
 * Three answers, not two, and the third one is the important one:
 *
 *   true   the handle still resolves to that id
 *   false  it resolves to a DIFFERENT id — the name changed hands
 *   null   could not tell (rate limit, outage, 404)
 *
 * `null` must not block a claim. A rate-limited GitHub would otherwise freeze
 * everybody's money, which is a far more likely event than a handle transfer
 * and a far worse outcome. So: refuse on a definite `false`, proceed on `null`.
 */
export async function handleStillBelongsTo(
  handle: string,
  externalId: string,
): Promise<boolean | null> {
  try {
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(handle)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "paytag",
        },
        cache: "no-store",
      },
    );
    // A 404 is not proof of a transfer: a deleted account also 404s, and the
    // escrow of a deleted account is still its owner's to claim.
    if (!res.ok) return null;

    const u = (await res.json()) as { id?: unknown };
    if (typeof u.id !== "number") return null;
    return String(u.id) === externalId;
  } catch {
    return null;
  }
}
