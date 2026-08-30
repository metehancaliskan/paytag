/**
 * Turning a PostgREST failure into an instruction.
 *
 * One failure mode is worth naming precisely, because it is the one a fresh
 * deployment hits and the message it produces explains nothing to the person
 * who can fix it:
 *
 *   Could not find the 'role' column of 'cards' in the schema cache
 *
 * That is not a bug in the app and not a bad input. It means the database is
 * behind the code: a migration was never run, or it ran and PostgREST is still
 * serving its cached view of the schema. Both are fixed from the Supabase SQL
 * editor in under a minute — so the interface should say which file to run
 * rather than printing prose about a cache the reader has never heard of.
 *
 * The mapping from a missing column to a migration file is deliberately
 * explicit. A generic "run the migrations" is the kind of advice that gets
 * ignored; naming the file is the kind that gets followed.
 */

/** Which migration introduced each thing the app writes to. */
const OWNER: { match: RegExp; file: string; what: string }[] = [
  { match: /\brole\b/, file: "db/migration-001-roles.sql", what: "cards.role" },
  {
    match: /payout|address/,
    file: "db/migration-002-account.sql",
    what: "payout_prefs",
  },
];

/**
 * A sentence the reader can act on, or null when this is not a schema problem
 * and the original message should stand.
 */
export function describeSchemaGap(message: string): string | null {
  if (!/schema cache/i.test(message)) return null;

  const owner = OWNER.find((o) => o.match.test(message));
  const file = owner?.file ?? "the migrations in db/";
  const what = owner?.what ?? "something this page writes";

  return (
    `This deployment's database does not have ${what} yet. ` +
    `Run ${file} in the Supabase SQL editor, then try again. ` +
    `(If you already ran it, the API is still holding a stale schema. ` +
    `Run: notify pgrst, 'reload schema';)`
  );
}

/**
 * What to show when a write fails. Prefers the instruction when there is one,
 * and never swallows the original: an unrecognized failure that prints nothing
 * is worse than one that prints too much.
 */
export function describeWriteError(e: unknown): string {
  const message =
    e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
  return describeSchemaGap(message) ?? message;
}
