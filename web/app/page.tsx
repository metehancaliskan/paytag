import Link from "next/link";
import Logo from "@/components/Logo";

/**
 * The landing page. One job: say what the thing is before anybody scrolls, and
 * keep "App →" within reach the whole time.
 *
 * It was four stacked sections and 279 words — a hero, three "which one are
 * you" cards, three "how it works" cards, three columns of facts, and a closing
 * call to action that repeated the header's. Every section was defensible on its
 * own, and together they buried the one sentence that matters. This is the same
 * page cut to what a stranger needs in order not to close the tab:
 *
 *   what it is        → the heading
 *   why it is safe    → one line under it, and that line is the refund
 *   what happens      → three labels, no body text
 *   the way in        → one button
 *
 * The rest moved rather than vanished. Roles are derived from the platform now
 * (lib/roles.ts), so "which one are you" asked a question the product answers by
 * itself; "how it works" needed three sentences only because its labels were
 * vague. What stays in full is the accepted risk, folded into a disclosure — the
 * surface gets brevity, the truth gets room (docs/DESIGN.md).
 *
 * Its own header, with no wallet bar and no navigation: a first visitor has no
 * wallet to show and no account to manage. The product chrome starts at /app.
 */

/** Three beats, three or four words each. If one needs a sentence, the label is
 *  wrong. */
const STEPS = [
  "Send to a handle",
  "It waits for them",
  "They verify and withdraw",
];

export default function Landing() {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-5 py-4">
          <span className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="text-lg font-bold tracking-tight">Paytag</span>
          </span>
          {/* The only button on the page, and it stays on screen. That is what
              replaced the closing call to action. */}
          <Link className="btn btn-primary ml-auto" href="/app">
            App →
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-5">
        <section className="pt-14 pb-10 sm:pt-20 sm:pb-14">
          <p className="menu-label">Stellar · Soroban</p>

          <h1 className="mt-4 text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">
            Pay a GitHub or X handle.
          </h1>

          {/* The two things a stranger is actually worried about: that the
              person has to sign up first, and that the money disappears. */}
          <p className="mt-4 max-w-xl text-lg text-dim">
            They need no wallet. Unclaimed money comes back to you.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link className="btn btn-primary btn-lg" href="/app">
              Open the app
            </Link>
            <Link className="link text-sm" href="/app/submit">
              Get paid for what you ship →
            </Link>
          </div>
        </section>

        <ol className="grid gap-3 border-t border-line py-8 sm:grid-cols-3">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-3">
              <span
                aria-hidden
                className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-raised text-xs font-bold text-dim"
              >
                {i + 1}
              </span>
              <span className="font-medium">{label}</span>
            </li>
          ))}
        </ol>

        {/* Folded, not dropped. This is the assumption the whole MVP rests on,
            and a landing page that hides it is selling something. */}
        <details className="border-t border-line py-6 text-sm">
          <summary className="cursor-pointer font-medium text-dim">
            What you have to trust
          </summary>
          <ul className="mt-3 max-w-xl space-y-2 leading-relaxed text-mute">
            <li>
              The money sits in an open source Soroban contract, not in an
              account of ours. It pays the verified owner of the handle, or
              refunds you once the window closes.
            </li>
            <li>
              Whoever holds the verifier key could authorize a claim. A real
              assumption of this MVP, written down rather than hidden.
            </li>
            <li>
              This deployment runs on testnet, where the money is worth nothing.
            </li>
          </ul>
        </details>
      </main>
    </>
  );
}
