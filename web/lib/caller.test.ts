import { describe, expect, it } from "vitest";
import { callerHash, callerIp } from "./caller";

/**
 * The per-caller limit counts requests per address. Everything here is about
 * the two ways that count can silently become meaningless: an address that is
 * spelled differently on every request, and a digest that is not really a
 * disguise.
 */

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("callerIp", () => {
  it("takes the leftmost entry of x-forwarded-for", () => {
    // Each proxy appends, so the first entry is the client and the rest are
    // infrastructure. Taking the last one would count every request behind one
    // proxy as the same caller.
    expect(
      callerIp(headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" })),
    ).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(callerIp(headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("prefers x-forwarded-for when both are present", () => {
    expect(
      callerIp(headers({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "10.0.0.1" })),
    ).toBe("203.0.113.7");
  });

  it("answers null when neither header is there", () => {
    // The route refuses on this: a request nobody can count is the request
    // somebody would want to make.
    expect(callerIp(headers({}))).toBeNull();
  });

  it("drops the port, so one client is one caller", () => {
    // THE BUG THIS EXISTS FOR: a source port changes on every connection. Left
    // in, every request would look like a new caller and the limit would count
    // nothing at all.
    expect(callerIp(headers({ "x-forwarded-for": "203.0.113.7:51234" }))).toBe(
      "203.0.113.7",
    );
    expect(callerIp(headers({ "x-forwarded-for": "203.0.113.7:9" }))).toBe(
      "203.0.113.7",
    );
  });

  it("keeps a bare IPv6 address whole", () => {
    // An IPv6 address is full of colons; the port stripping must not eat it.
    expect(callerIp(headers({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("unwraps a bracketed IPv6 address, with or without a port", () => {
    expect(callerIp(headers({ "x-forwarded-for": "[2001:db8::1]:443" }))).toBe(
      "2001:db8::1",
    );
    expect(callerIp(headers({ "x-forwarded-for": "[2001:db8::1]" }))).toBe("2001:db8::1");
  });

  it("reads one caller's spellings as one caller", () => {
    const spellings = ["203.0.113.7", " 203.0.113.7 ", "203.0.113.7:1", "203.0.113.7:65000"];
    const seen = new Set(
      spellings.map((v) => callerIp(headers({ "x-forwarded-for": v }))),
    );
    expect(seen.size).toBe(1);
  });

  it("normalizes IPv6 case", () => {
    expect(callerIp(headers({ "x-forwarded-for": "2001:DB8::AB" }))).toBe("2001:db8::ab");
  });
});

describe("callerHash", () => {
  it("is stable for the same value and salt", () => {
    expect(callerHash("203.0.113.7", "pepper")).toBe(callerHash("203.0.113.7", "pepper"));
  });

  it("changes completely with the salt", () => {
    // The salt is what stops the digest being reversible: the whole IPv4 space
    // is four billion hashes, which is an afternoon. Without this property the
    // table would be a list of visitors in a disguise that fools nobody.
    expect(callerHash("203.0.113.7", "pepper")).not.toBe(
      callerHash("203.0.113.7", "other"),
    );
  });

  it("separates two callers", () => {
    expect(callerHash("203.0.113.7", "pepper")).not.toBe(
      callerHash("203.0.113.8", "pepper"),
    );
  });

  it("produces the 64 hex digits the column's CHECK requires", () => {
    expect(callerHash("203.0.113.7", "pepper")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not let a value run into the salt", () => {
    // Concatenating salt and value without a separator makes ("ab","c") and
    // ("a","bc") the same caller. A separator is a one-line fix for a
    // collision that would be very hard to notice.
    expect(callerHash("bc", "a")).not.toBe(callerHash("c", "ab"));
  });
});
