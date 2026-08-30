import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GithubMark, XMark } from "@/components/icons";
import { KIND, normalizeHandle, type IdentityKind } from "@/lib/identity";

type Params = { params: Promise<{ handle: string }> };

export const metadata: Metadata = {
  title: "Which account? · Paytag",
  description: "The same username can be two different people. Pick one.",
};

/**
 * `/pay/<name>` — a link with a name and no platform.
 *
 * It lives at `/pay/` and not at `/p/` for a mechanical reason: Next refuses two
 * routes whose first dynamic segment has different slug names, so `/p/[handle]`
 * cannot coexist with `/p/[kind]/[handle]`. `next.config.ts` sends the old
 * one-segment links here.
 *
 * This used to be a permanent redirect to `/p/gh/<name>` in next.config.ts, and
 * that was the most dangerous line in the app: `github.com/foo` and `x.com/foo`
 * are different tags that may belong to different people, so a donor who opened
 * a truncated or legacy link meaning the X account got a fully working send form
 * for the GitHub one and paid a stranger. A redirect that invents an identity is
 * worse than a 404, because nothing about the result looks wrong.
 *
 * So the page asks. Two options, both spelled out as the URL they mean, and no
 * pre-selection — there is nothing here to guess with.
 */
export default async function DisambiguatePage({ params }: Params) {
  const { handle: raw } = await params;
  const decoded = decodeURIComponent(raw);

  // A name valid on neither platform is not an ambiguous link, it is a bad one.
  const options = ([KIND.GithubUser, KIND.XUser] as IdentityKind[])
    .map((kind) => {
      try {
        return { kind, handle: normalizeHandle(decoded, kind) };
      } catch {
        return null;
      }
    })
    .filter((o): o is { kind: IdentityKind; handle: string } => o !== null);

  if (options.length === 0) notFound();

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Which account?</h1>
        <p className="mt-1.5 text-dim">
          That link did not say which platform. The same name on GitHub and on X
          can be two different people, so nothing here guesses.
        </p>
      </header>

      <ul className="card divide-y divide-line">
        {options.map(({ kind, handle }) => (
          <li key={kind}>
            <Link
              href={`/p/${kind === KIND.XUser ? "x" : "gh"}/${handle}`}
              className="flex items-center gap-3 p-4 transition-colors hover:bg-raised"
            >
              {kind === KIND.XUser ? (
                <XMark size={15} className="shrink-0 text-dim" />
              ) : (
                <GithubMark size={17} className="shrink-0 text-dim" />
              )}
              <span className="mono min-w-0 flex-1 truncate text-sm font-semibold">
                {kind === KIND.XUser ? "x.com/" : "github.com/"}
                {handle}
              </span>
              <span aria-hidden className="text-mute">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="px-1 text-xs text-mute">
        Check the account on the platform itself before sending anything.
      </p>
    </div>
  );
}
