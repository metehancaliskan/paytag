import { describe, expect, it } from "vitest";
import { describeSchemaGap, describeWriteError } from "./db-errors";

/**
 * The failure a fresh deployment actually hits.
 *
 * PostgREST answers a write to a column its cached schema does not know with
 * "Could not find the 'role' column of 'cards' in the schema cache" — which
 * reads like an application bug, is not one, and is fixed by running a
 * migration. These tests pin the translation, because the value of the message
 * is entirely in naming the right file.
 */
describe("describeSchemaGap", () => {
  it("names migration 001 for the role column", () => {
    const out = describeSchemaGap(
      "Could not find the 'role' column of 'cards' in the schema cache",
    );
    expect(out).toContain("db/migration-001-roles.sql");
    expect(out).toContain("cards.role");
  });

  it("names migration 002 for the payout table", () => {
    const out = describeSchemaGap(
      "Could not find the 'address' column of 'payout_prefs' in the schema cache",
    );
    expect(out).toContain("db/migration-002-account.sql");
  });

  it("still helps when the column is one we have not mapped", () => {
    const out = describeSchemaGap(
      "Could not find the 'whatever' column of 'cards' in the schema cache",
    );
    expect(out).toContain("db/");
  });

  it("mentions the cache reload, since a run migration can still fail", () => {
    expect(
      describeSchemaGap("Could not find the 'role' column in the schema cache"),
    ).toContain("reload schema");
  });

  it("stays out of the way of every other failure", () => {
    expect(describeSchemaGap("duplicate key value violates unique constraint")).toBeNull();
    expect(describeSchemaGap("new row violates row-level security policy")).toBeNull();
    expect(describeSchemaGap("")).toBeNull();
  });
});

describe("describeWriteError", () => {
  it("passes an unrecognized failure through rather than swallowing it", () => {
    expect(describeWriteError(new Error("permission denied for table cards"))).toBe(
      "permission denied for table cards",
    );
    expect(describeWriteError("plain string failure")).toBe("plain string failure");
  });

  it("translates the schema gap", () => {
    expect(
      describeWriteError(
        new Error("Could not find the 'role' column of 'cards' in the schema cache"),
      ),
    ).toContain("migration-001");
  });
});
