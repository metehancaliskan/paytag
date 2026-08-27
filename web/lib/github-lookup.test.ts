import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The lookup that stands between a typo and somebody else's money — and the
 * cache in front of it, which exists to protect a budget (docs/API-COSTS.md).
 *
 * Each case re-imports the module so the module-scoped cache starts empty;
 * without that the tests would be reading each other's answers, which is
 * precisely the bug being tested for.
 */
async function fresh() {
  vi.resetModules();
  return (await import("./github")).lookupGithub;
}

function reply(status: number, body: unknown = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

const USER = {
  login: "torvalds",
  id: 1024025,
  name: "Linus Torvalds",
  bio: null,
  avatar_url: "https://example.test/a.png",
  html_url: "https://github.com/torvalds",
  company: null,
  blog: "",
  location: null,
  followers: 231000,
  public_repos: 8,
  created_at: "2011-09-03T15:26:22Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lookupGithub", () => {
  it("separates a missing account from an unreachable GitHub", async () => {
    const lookupGithub = await fresh();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(reply(404))
        .mockResolvedValueOnce(reply(403)),
    );

    // The one that must refuse a send…
    expect((await lookupGithub("nobody-at-all")).status).toBe("missing");
    // …and the one that must not, because our outage is not evidence.
    expect((await lookupGithub("rate-limited")).status).toBe("unreachable");
  });

  it("asks once for a handle and reuses the answer", async () => {
    const lookupGithub = await fresh();
    const fetchMock = vi.fn().mockResolvedValue(reply(200, USER));
    vi.stubGlobal("fetch", fetchMock);

    const first = await lookupGithub("torvalds");
    const second = await lookupGithub("Torvalds"); // same account, other case
    const third = await lookupGithub("torvalds");

    expect(first.status).toBe("found");
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("remembers a missing handle too — that answer refuses a send", async () => {
    const lookupGithub = await fresh();
    const fetchMock = vi.fn().mockResolvedValue(reply(404));
    vi.stubGlobal("fetch", fetchMock);

    expect((await lookupGithub("ghost")).status).toBe("missing");
    expect((await lookupGithub("ghost")).status).toBe("missing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not remember an unreachable GitHub", async () => {
    const lookupGithub = await fresh();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(503))
      .mockResolvedValueOnce(reply(200, USER));
    vi.stubGlobal("fetch", fetchMock);

    // One bad second must not read as a broken GitHub for the rest of the visit.
    expect((await lookupGithub("torvalds")).status).toBe("unreachable");
    expect((await lookupGithub("torvalds")).status).toBe("found");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a thrown fetch as unreachable rather than as an answer", async () => {
    const lookupGithub = await fresh();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    expect((await lookupGithub("torvalds")).status).toBe("unreachable");
  });
});
