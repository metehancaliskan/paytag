import { describe, expect, it } from "vitest";
import { decideAdoption } from "./identity-adoption";

const ME = "profile-a";
const OTHER = "profile-b";

describe("who holds a verified handle", () => {
  it("writes a new row when the provider account is unknown", () => {
    expect(
      decideAdoption({
        sessionProfileId: ME,
        onRecord: null,
        sessionAlreadyHasKind: false,
        mergeFromProfileId: null,
      }),
    ).toEqual({ action: "insert" });
  });

  it("updates in place when the row is already ours", () => {
    expect(
      decideAdoption({
        sessionProfileId: ME,
        onRecord: { id: "id-1", profileId: ME },
        sessionAlreadyHasKind: true,
        mergeFromProfileId: null,
      }),
    ).toEqual({ action: "update", identityId: "id-1" });
  });

  // The state the old link bug left people in — and it moves only because the
  // other profile armed the merge.
  it("adopts a row stranded on another profile when that profile asked", () => {
    expect(
      decideAdoption({
        sessionProfileId: ME,
        onRecord: { id: "id-1", profileId: OTHER },
        sessionAlreadyHasKind: false,
        mergeFromProfileId: OTHER,
      }),
    ).toEqual({ action: "adopt", identityId: "id-1" });
  });

  // The important negative: an ordinary sign-in must never move anything. Two
  // accounts belonging to one person would otherwise pass a card and a payout
  // address back and forth depending on which door they came through.
  it("refuses to take a row when no merge was armed", () => {
    expect(
      decideAdoption({
        sessionProfileId: ME,
        onRecord: { id: "id-1", profileId: OTHER },
        sessionAlreadyHasKind: false,
        mergeFromProfileId: null,
      }),
    ).toEqual({ action: "refuse", reason: "identity_on_another_account" });
  });

  // And an intent for a DIFFERENT profile is not an intent for this row.
  it("refuses when the armed merge names some other profile", () => {
    expect(
      decideAdoption({
        sessionProfileId: ME,
        onRecord: { id: "id-1", profileId: OTHER },
        sessionAlreadyHasKind: false,
        mergeFromProfileId: "profile-c",
      }),
    ).toEqual({ action: "refuse", reason: "identity_on_another_account" });
  });

  // Two cards, one slot. Nothing moves rather than one of them being chosen.
  it("refuses when this account already has a handle of that kind", () => {
    expect(
      decideAdoption({
        sessionProfileId: ME,
        onRecord: { id: "id-1", profileId: OTHER },
        sessionAlreadyHasKind: true,
        mergeFromProfileId: OTHER,
      }),
    ).toEqual({ action: "refuse", reason: "kind_already_verified_here" });
  });

  // The guard that keeps this from being a takeover: the caller looks the row up
  // by (kind, external_id), so a DIFFERENT provider account with the same name
  // is simply not `onRecord` — it never reaches an adopt decision.
  it("cannot adopt anything when nothing matches the provider id", () => {
    const d = decideAdoption({
      sessionProfileId: ME,
      onRecord: null,
      sessionAlreadyHasKind: true,
      mergeFromProfileId: OTHER,
    });
    expect(d.action).toBe("insert");
  });
});
