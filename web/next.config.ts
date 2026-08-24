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
        // /p/torvalds links left over from the single-identity era.
        // Permanent, so old links keep working and search engines settle on
        // one canonical address.
        source: "/p/:handle",
        destination: "/p/gh/:handle",
        permanent: true,
      },
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
