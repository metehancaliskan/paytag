import { describe, expect, it } from "vitest";
import { isFresh, parseXUser } from "./x-parse";

/**
 * The two decisions in lib/x-parse.ts that spend money if they are wrong: whether a
 * cached answer still counts (a wrong "no" pays for the same question twice)
 * and what X actually said (a wrong reading turns a correct handle into a
 * warning, or worse, a nonexistent one into a send).
 */

const DAY = 86_400_000;
const now = new Date("2026-08-30T12:00:00.000Z");

describe("isFresh", () => {
  it("keeps an answer from an hour ago", () => {
    expect(isFresh(new Date(now.getTime() - 3_600_000).toISOString(), now, 30)).toBe(true);
  });

  it("keeps an answer from twenty-nine days ago", () => {
    expect(isFresh(new Date(now.getTime() - 29 * DAY).toISOString(), now, 30)).toBe(true);
  });

  it("drops an answer from thirty-one days ago", () => {
    expect(isFresh(new Date(now.getTime() - 31 * DAY).toISOString(), now, 30)).toBe(false);
  });

  it("treats the boundary as stale rather than fresh", () => {
    // Erring towards asking again costs a cent. Erring the other way serves an
    // answer we have already decided is too old.
    expect(isFresh(new Date(now.getTime() - 30 * DAY).toISOString(), now, 30)).toBe(false);
  });

  it("refuses a timestamp from the future", () => {
    // A clock skew or a bad write must not produce an entry that never expires.
    expect(isFresh(new Date(now.getTime() + DAY).toISOString(), now, 30)).toBe(false);
  });

  it("refuses a missing or unparseable timestamp", () => {
    expect(isFresh(null, now, 30)).toBe(false);
    expect(isFresh("not a date", now, 30)).toBe(false);
  });

  it("honours a shorter window when one is given", () => {
    const twoDaysAgo = new Date(now.getTime() - 2 * DAY).toISOString();
    expect(isFresh(twoDaysAgo, now, 30)).toBe(true);
    expect(isFresh(twoDaysAgo, now, 1)).toBe(false);
  });
});

describe("parseXUser", () => {
  it("reads a user out of the data object", () => {
    expect(
      parseXUser({ data: { id: "44196397", username: "elonmusk", name: "Elon Musk" } }),
    ).toEqual({ id: "44196397", username: "elonmusk", name: "Elon Musk" });
  });

  it("accepts a user with no display name", () => {
    expect(parseXUser({ data: { id: "1", username: "someone" } })).toEqual({
      id: "1",
      username: "someone",
      name: null,
    });
  });

  it("reads a 200 carrying a Not Found error as missing", () => {
    // THE TRAP THIS FUNCTION EXISTS FOR. X answers 200 for a username nobody
    // holds, with `errors` in place of `data`. Trusting the status code would
    // read "no such account" as "the API failed", and the send page would show
    // the unconfirmed warning for every correct handle instead of refusing the
    // wrong ones.
    expect(
      parseXUser({
        errors: [
          {
            value: "nobodyholdsthis",
            detail: "Could not find user with username: [nobodyholdsthis].",
            title: "Not Found Error",
            resource_type: "user",
            parameter: "username",
            type: "https://api.twitter.com/2/problems/resource-not-found",
          },
        ],
      }),
    ).toBe("missing");
  });

  it("does not read some other error as missing", () => {
    // An authorization problem is ours, not evidence about the account. Reading
    // it as "no such account" would refuse a perfectly good send.
    expect(
      parseXUser({ errors: [{ title: "Unauthorized", detail: "bad token" }] }),
    ).toBeNull();
  });

  it("answers null for a body it does not recognise", () => {
    expect(parseXUser(null)).toBeNull();
    expect(parseXUser("nope")).toBeNull();
    expect(parseXUser({})).toBeNull();
    expect(parseXUser({ data: {} })).toBeNull();
    expect(parseXUser({ data: { id: 44196397, username: "elonmusk" } })).toBeNull();
  });
});
