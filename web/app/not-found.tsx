import HandleSearch from "@/components/HandleSearch";

/**
 * Reached both by a genuinely wrong URL and by a handle that failed
 * normalization — /p/x/elon-musk, say, which is a valid GitHub handle and an
 * invalid X one. So the page explains the second case rather than shrugging.
 *
 * It carries its own `<main id="main">`: this page renders OUTSIDE the app route
 * group, so the layout that normally provides one is not above it — and the skip
 * link in the root layout points at `#main`, which was landing on nothing here.
 *
 * The handle field lives here and nowhere else. A 404 is the one screen where
 * somebody is definitely looking for a handle they do not have.
 */
export default function NotFound() {
  return (
    <main id="main" className="mx-auto w-full max-w-xl flex-1 px-5 py-10 text-center">
      <p className="badge">404</p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">
        No identity at this address
      </h1>
      <p className="mt-3 leading-relaxed text-dim">
        Either the page does not exist, or the handle in the URL is not valid
        for that identity kind. GitHub allows hyphens and up to 39 characters; X
        allows underscores and stops at 15. A handle that is fine on one side
        gets rejected on the other, on purpose — guessing would mean paying the
        wrong person.
      </p>

      <div className="mt-8 text-left">
        <HandleSearch showExamples />
      </div>
    </main>
  );
}
