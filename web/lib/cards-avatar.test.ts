import { describe, expect, it } from "vitest";
import { avatarUrl } from "./cards";
import { KIND } from "./identity";

/**
 * The two avatar URLs. Small surface, but one query parameter on it decides
 * whether a name nobody holds shows up wearing a stranger's silhouette.
 */
describe("avatarUrl", () => {
  it("derives the GitHub avatar from the handle, no API call", () => {
    expect(avatarUrl({ kind: KIND.GithubUser, handle: "torvalds" })).toBe(
      "https://github.com/torvalds.png?size=128",
    );
  });

  it("resolves an X handle through unavatar", () => {
    const url = avatarUrl({ kind: KIND.XUser, handle: "kmetehanclskn" });
    expect(url).toContain("unavatar.io/x/kmetehanclskn");
  });

  it("asks X avatars to 404 rather than invent a picture", () => {
    // Without fallback=false an unresolvable handle answers 200 with a generic
    // silhouette, which on a page about to move money reads as a real account.
    expect(avatarUrl({ kind: KIND.XUser, handle: "nobody" })).toContain(
      "fallback=false",
    );
  });

  it("escapes the handle rather than pasting it into the URL", () => {
    const url = avatarUrl({ kind: KIND.XUser, handle: "a b/c?d" });
    expect(url).toBe("https://unavatar.io/x/a%20b%2Fc%3Fd?fallback=false");
  });

  it("has no picture for a kind that is not a platform", () => {
    expect(avatarUrl({ kind: 0x03 as never, handle: "nick" })).toBeNull();
  });
});
