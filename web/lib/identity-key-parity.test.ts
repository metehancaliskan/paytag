import { describe, expect, it } from "vitest";
import {
  KIND,
  identityKey,
  identityKeyFromNormalized,
  normalizeHandle,
  toHex,
  type IdentityKind,
} from "./identity";

/**
 * Phase 3.4 — THE GATE.
 *
 * Every vector below is copied from docs/SPEC.md §2.3 and §2.4, which are the
 * same numbers the Rust side is held to. The two implementations never call
 * each other; they only have to agree, and this file is where that agreement
 * is checked.
 *
 * Why it matters more than it looks: if Rust and TypeScript disagree by a
 * single byte, money is deposited under one tag while claims look under
 * another. Nothing throws, nothing logs, and the escrow is simply unreachable
 * forever. That failure surfaces at the worst possible moment — in front of
 * whoever is being demoed to — which is why the plan makes this a gate rather
 * than a task.
 */

const hex = async (handle: string, kind: IdentityKind = KIND.GithubUser) =>
  toHex(await identityKey(handle, kind));

describe("SPEC §2.3 — GitHub identity_key vectors", () => {
  const VECTORS: [string, string][] = [
    [
      "metehancaliskan",
      "91e23a08973aba69e14664cb9e12cc20483a4f702afdd304c8ad7424a354ffff",
    ],
    [
      "torvalds",
      "9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b",
    ],
    ["a", "022a6979e6dab7aa5ae4c3e5e45f7e977112a7e63593820dbec1ec738a24f93c"],
    [
      "a".repeat(39), // the maximum a GitHub handle can be
      "2e7774be4389a7316830256eebfdebbc76f3a47ea6b62cea92b0efb7982de372",
    ],
  ];

  for (const [handle, expected] of VECTORS) {
    it(`${handle.length > 12 ? `${handle.slice(0, 12)}… (${handle.length} chars)` : handle} → ${expected.slice(0, 8)}…`, async () => {
      expect(await hex(handle)).toBe(expected);
    });
  }
});

describe("SPEC §2.3 — normalization equivalence", () => {
  const TORVALDS =
    "9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b";

  // Every spelling somebody might paste. All of them are the same person, so
  // all of them have to be the same 32 bytes — otherwise the sender and the
  // recipient end up on different tags without either of them being wrong.
  const SPELLINGS = [
    "torvalds",
    "Torvalds",
    "TORVALDS",
    "@torvalds",
    "github.com/torvalds",
    "https://github.com/torvalds",
    "https://github.com/Torvalds/",
    "  torvalds  ",
  ];

  for (const input of SPELLINGS) {
    it(`${JSON.stringify(input)} resolves to the same key`, async () => {
      expect(await hex(input)).toBe(TORVALDS);
    });
  }
});

describe("SPEC §2.3 — rejected GitHub input", () => {
  // Rejection is a feature. Repairing ambiguous input would mean guessing
  // which account the money is for.
  const REJECTED: [string, string][] = [
    ["", "empty"],
    ["-torvalds", "leading hyphen"],
    ["torvalds-", "trailing hyphen"],
    ["tor--valds", "double hyphen"],
    ["torvalds/linux", "a repo, outside the MVP"],
    ["a".repeat(40), "one character over the limit"],
    ["torvaldş", "non-ASCII"],
    ["tor valds", "whitespace inside"],
  ];

  for (const [input, why] of REJECTED) {
    it(`rejects ${JSON.stringify(input)} — ${why}`, () => {
      expect(() => normalizeHandle(input, KIND.GithubUser)).toThrow();
    });
  }
});

describe("SPEC §2.3 — the kind byte separates identities", () => {
  // Same handle, four kinds, four different keys. This is what stops money
  // sent to a GitHub identity from being withdrawn with an X account.
  const BY_KIND: [number, string][] = [
    [
      KIND.GithubUser,
      "9d8638cdf5594ee5a5178e3d413fb8206513356b947de1de600f178532c7060b",
    ],
    [
      KIND.GithubRepo,
      "919ae1bad528b5f77e43e55a03d75409d6ceca8b23a4219fb35c1e3da936660c",
    ],
    [
      KIND.XUser,
      "cb254de12f5a5a76717d0db39922eb02cbe081c4977bd82e7d492bba5a7e3d96",
    ],
    [
      KIND.PaytagNick,
      "445e3e773d82aa85a04b41a66c387590d962f94bea1a9fefad12447d4b5a1359",
    ],
  ];

  for (const [kind, expected] of BY_KIND) {
    it(`kind 0x0${kind} → ${expected.slice(0, 8)}…`, async () => {
      // The low-level path: kinds 0x01 and 0x03 have no normalization rule
      // yet, but the digest still has to include their kind byte.
      expect(toHex(await identityKeyFromNormalized("torvalds", kind))).toBe(
        expected,
      );
    });
  }

  it("produces four distinct keys", async () => {
    const keys = await Promise.all(
      BY_KIND.map(([kind]) => identityKeyFromNormalized("torvalds", kind)),
    );
    expect(new Set(keys.map(toHex)).size).toBe(4);
  });
});

describe("SPEC §2.4 — X identity_key vectors", () => {
  it("metehancaliskan on X differs from the same handle on GitHub", async () => {
    expect(await hex("metehancaliskan", KIND.XUser)).toBe(
      "7462d3ca2f7a62066003309a018b93907472145b9e2341e6b88fbf40fc8b86ff",
    );
  });

  it("strips x.com, twitter.com and @ alike", async () => {
    const expected = await hex("elonmusk", KIND.XUser);
    for (const input of [
      "@elonmusk",
      "x.com/elonmusk",
      "twitter.com/elonmusk",
      "https://x.com/ElonMusk",
      "https://twitter.com/elonmusk/",
    ]) {
      expect(await hex(input, KIND.XUser)).toBe(expected);
    }
  });

  it("applies the X grammar, not GitHub's", () => {
    // The whole reason the rules are separate: a hyphen is legal on GitHub and
    // illegal on X, and 16 characters is over the X limit but fine on GitHub.
    expect(() => normalizeHandle("elon-musk", KIND.XUser)).toThrow();
    expect(normalizeHandle("elon-musk", KIND.GithubUser)).toBe("elon-musk");

    expect(() => normalizeHandle("a".repeat(16), KIND.XUser)).toThrow();
    expect(normalizeHandle("a".repeat(16), KIND.GithubUser)).toBe("a".repeat(16));

    // Underscores are the mirror image: fine on X, invalid on GitHub.
    expect(normalizeHandle("elon_musk", KIND.XUser)).toBe("elon_musk");
    expect(() => normalizeHandle("elon_musk", KIND.GithubUser)).toThrow();
  });
});

describe("the Turkish locale trap", () => {
  // `"I".toLocaleLowerCase("tr")` is "ı", not "i". If lowercasing ever went
  // through the locale, a handle containing a capital I would hash to
  // something Rust's `to_ascii_lowercase` never produces — and the divergence
  // would only appear for users whose machine is set to Turkish.
  it("lowercases as ASCII, so a capital I becomes i", async () => {
    expect(normalizeHandle("Ilya", KIND.GithubUser)).toBe("ilya");
    expect(await hex("ILYA")).toBe(await hex("ilya"));
  });
});
