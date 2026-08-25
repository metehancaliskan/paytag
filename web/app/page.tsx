import Link from "next/link";
import Logo from "@/components/Logo";
import { ROLE_LIST } from "@/lib/roles";
import { slugOf } from "@/lib/identity";

/**
 * The landing page. One job: explain the thing in ten seconds and put "Open
 * app" within reach at every scroll position.
 *
 * It carries its own header — no wallet bar, no navigation — because a first
 * visitor has no wallet to show and no account to manage. The product chrome
 * starts at /app.
 */

const STEPS = [
  {
    n: "1",
    title: "Pick a handle",
    body: "A GitHub username is enough. They need no wallet, no account, nothing.",
  },
  {
    n: "2",
    title: "The contract holds it",
    body: "Not us. A Soroban escrow on Stellar, with the money bound to the handle.",
  },
  {
    n: "3",
    title: "They prove it and withdraw",
    body: "GitHub login, then their own wallet. Unclaimed money comes back to you.",
  },
];

export default function Landing() {
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-4">
          <span className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="text-lg font-bold tracking-tight">Paytag</span>
          </span>

          <nav className="ml-auto flex items-center gap-1" aria-label="Landing">
            <a
              href="#how"
              className="hidden rounded-lg px-2.5 py-1.5 text-sm font-medium text-mute transition-colors hover:text-text sm:block"
            >
              How it works
            </a>
            <Link
              href="/evidence"
              className="hidden rounded-lg px-2.5 py-1.5 text-sm font-medium text-mute transition-colors hover:text-text sm:block"
            >
              Proof
            </Link>
            <Link className="btn btn-primary ml-2" href="/app">
              App →
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {/* ------------------------------------------------------------ hero */}
        <section className="mx-auto max-w-6xl px-5 pb-14 pt-16 sm:pt-24">
          <div className="max-w-3xl">
            <span className="badge">Stellar · Soroban escrow</span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">
              Pay the people who
              <br />
              carry the ecosystem.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-dim">
              Send money to a GitHub or X handle. It waits in a contract until
              the owner proves the account is theirs.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link className="btn btn-primary btn-lg" href="/app">
                Open the app
              </Link>
              <Link className="btn btn-ghost btn-lg" href="/app/submit">
                Submit yourself
              </Link>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- who it is for */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-mute">
              Which one are you
            </h2>

            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <div className="card p-5">
                {/* "Sender", not "Community" — Community is now the label of a
                    card role, and one word cannot mean both the person paying
                    and the person being paid. */}
                <span className="badge">Sender</span>
                <h3 className="mt-3 text-lg font-bold">You send</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-mute">
                  Browse who is listed, pick someone whose work you have
                  actually used, pay their handle.
                </p>
                <Link className="link mt-4 inline-block text-sm" href="/app">
                  Open the directory →
                </Link>
              </div>

              {ROLE_LIST.map((r) => (
                <div key={r.key} className="card p-5">
                  <span className="badge">{r.label}</span>
                  <h3 className="mt-3 text-lg font-bold">{r.pick}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-mute">
                    {r.blurb} Fill one short form and people can pay you for it.
                  </p>
                  {/* Straight to the right platform. The role IS the platform
                      (lib/roles.ts), so "I build" can only mean the GitHub
                      card — landing on the form with the other one selected
                      would be the page contradicting itself. */}
                  <Link
                    className="link mt-4 inline-block text-sm"
                    href={`/app/submit?for=${slugOf(r.kind)}`}
                  >
                    Submit yourself →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- the steps */}
        <section id="how" className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="text-2xl font-bold tracking-tight">How it works</h2>
          <ol className="mt-6 grid gap-4 lg:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="card p-5">
                <span className="grid h-7 w-7 place-items-center rounded-full border border-accent text-sm font-bold text-accent-text">
                  {s.n}
                </span>
                <h3 className="mt-3 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-mute">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------------------------------------------------------- the trust */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-14">
            <dl className="grid gap-6 sm:grid-cols-3">
              <Fact term="Who holds the money">
                An open source Soroban contract. It pays the verified owner, or
                refunds you when the window closes. Nobody else can move it.
              </Fact>
              <Fact term="What you have to trust">
                Whoever holds the verifier key could authorize a claim. A real
                assumption of this MVP, written down rather than hidden.
              </Fact>
              <Fact term="Proof it works">
                <Link className="link" href="/evidence">
                  Every transaction this deployment has made
                </Link>
                , with hashes you can open in an explorer.
              </Fact>
            </dl>

            <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-line pt-8">
              <p className="text-lg font-semibold">
                Somebody shipped something you use. Pay them.
              </p>
              <Link className="btn btn-primary ml-auto" href="/app">
                Open the app
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

function Fact({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-sm font-semibold">{term}</dt>
      <dd className="mt-1.5 text-sm leading-relaxed text-mute">{children}</dd>
    </div>
  );
}
