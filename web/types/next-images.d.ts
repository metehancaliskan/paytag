/**
 * Types for importing an image as a module (`import mark from "@/public/x.png"`).
 *
 * Next normally supplies this through `next-env.d.ts`, which it generates on
 * `next dev` or `next build` and which its own .gitignore template excludes.
 * That combination is invisible on a developer's machine and fatal in CI: the
 * file is always present locally, never present in a fresh checkout, and our
 * workflow runs `pnpm typecheck` BEFORE `pnpm build`, so nothing has generated
 * it yet when tsc looks for it. `components/Logo.tsx` imports a PNG, and the
 * job failed with TS2307 on a file that compiles perfectly at every desk.
 *
 * One tracked line fixes it. Not `next-env.d.ts` itself, which Next rewrites on
 * every build and tells you not to edit; a separate file it does not own.
 */

/// <reference types="next/image-types/global" />
