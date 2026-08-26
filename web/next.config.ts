import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Avatars come from GitHub and are rendered with `unoptimized`, so nothing
    // here is resized on our side. The hosts are still declared: a production
    // build validates remote `src` against this list, and finding that out from
    // a blank avatar on the live site is a bad way to learn it.
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "github.com" },
    ],
  },

  async redirects() {
    return [
      {
        // A one-segment link says a name and not a platform. It used to become
        // /p/gh/:handle — see the note below — and now it becomes a page that
        // asks. Not permanent: this is a fork in the road, not a canonical
        // address, and the two real pages are the canonical ones.
        source: "/p/:handle",
        destination: "/pay/:handle",
        permanent: false,
      },
      // /p/:handle is no longer redirected to a GUESS. It used to become /p/gh/:handle,
      // which invented an identity kind: a legacy or truncated link meaning
      // x.com/<name> produced a working send form for github.com/<name> — a
      // different person's tag, with nothing on screen to say so. The route now
      // renders a two-option page instead (app/(app)/p/[handle]/page.tsx), and
      // the reader picks. A redirect that guesses which stranger to pay is worse
      // than no redirect at all.
      // The landing page took over "/", so the directory and the form moved
      // behind /app. These two paths were shared while they existed.
      { source: "/people", destination: "/app", permanent: true },
      { source: "/card", destination: "/app/submit", permanent: true },
      // The identity page grew into a profile page. /connect was in the account
      // menu and in the docs while it existed.
      { source: "/connect", destination: "/profile", permanent: true },
    ];
  },
};

export default nextConfig;
