// Stands in for the `server-only` package under Vitest.
//
// That package's entry throws on purpose: importing it from a client bundle
// must fail the build. Node has no client/server split, so the tests alias it
// here — which is what makes `lib/verifier.ts`, the code most worth testing,
// importable at all. The guard it provides is still real in `next build`.
export {};
