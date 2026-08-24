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
