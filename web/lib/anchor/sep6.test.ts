import { describe, expect, it } from "vitest";
import { trimAmount } from "./sep38";
import {
  describeStatus,
  humanise,
  isFinal,
  needsUser,
  readInstructions,
} from "./sep6";

/**
 * The parts of the anchor conversation that are ours to get right.
 *
 * Everything that talks to the network is the anchor's behaviour and belongs in
 * a manual run against the sandbox. What is testable here is the translation
 * layer: SEP-6 speaks in machine statuses and machine field names, and every
 * one of them reaches a person's eyes through these functions. A status we fail
 * to recognise must still say something true, and a bank field we have never
 * seen must still be shown rather than dropped — those two properties are what
 * these tests hold down.
 */

describe("isFinal", () => {
  it("knows when nothing more will happen on its own", () => {
    expect(isFinal("completed")).toBe(true);
    expect(isFinal("error")).toBe(true);
    expect(isFinal("refunded")).toBe(true);
  });

  it("keeps waiting through every pending state", () => {
    for (const s of [
      "incomplete",
      "pending_user_transfer_start",
      "pending_anchor",
      "pending_stellar",
      "pending_trust",
    ]) {
      expect(isFinal(s)).toBe(false);
    }
  });

  it("does not treat an unknown status as finished", () => {
    // Polling one status too long is harmless. Stopping early leaves somebody
    // staring at a transfer the anchor has already completed.
    expect(isFinal("pending_something_we_have_never_seen")).toBe(false);
  });
});

describe("needsUser", () => {
  it("separates waiting on the person from waiting on the anchor", () => {
    expect(needsUser("pending_user_transfer_start")).toBe(true);
    expect(needsUser("pending_trust")).toBe(true);
    expect(needsUser("pending_anchor")).toBe(false);
    expect(needsUser("completed")).toBe(false);
  });
});

describe("describeStatus", () => {
  it("turns the protocol's names into sentences", () => {
    expect(describeStatus("pending_user_transfer_start")).toMatch(
      /waiting for your bank transfer/i,
    );
    expect(describeStatus("pending_trust")).toMatch(/trustline/i);
    expect(describeStatus("completed")).toBe("Done.");
  });

  it("says something true about a status it does not know", () => {
    // The fallback quotes the anchor rather than inventing a meaning.
    const text = describeStatus("pending_moon_phase");
    expect(text).toContain("pending_moon_phase");
    expect(text).toMatch(/anchor reports/i);
  });
});

describe("readInstructions", () => {
  const raw = {
    bank_name: { value: "TR Mock Bank A.Ş.", description: "Bank holding it" },
    bank_account_number: { value: "TR05000990000000000000001" },
    external_transfer_memo: {
      value: "TRMA-MD8V-U3VM",
      description: "Write this in the description",
    },
  };

  it("keeps every field, in the anchor's order", () => {
    const out = readInstructions(raw);
    expect(out.map((f) => f.value)).toEqual([
      "TR Mock Bank A.Ş.",
      "TR05000990000000000000001",
      "TRMA-MD8V-U3VM",
    ]);
  });

  it("reads the machine names as words", () => {
    expect(readInstructions(raw)[1].label).toBe("Bank account number");
    expect(humanise("external_transfer_memo")).toBe("External transfer memo");
  });

  it("survives a field with no description", () => {
    expect(readInstructions(raw)[1].description).toBeNull();
  });

  it("drops only what it cannot show, and never throws", () => {
    // An IBAN the reader cannot see is an IBAN they cannot pay to, so the bar
    // for dropping a field is that there is no value to print.
    const out = readInstructions({
      good: { value: "keep me" },
      empty: { value: "" },
      wrong_shape: "not an object",
      null_entry: null,
      no_value: { description: "nothing to copy" },
    });
    expect(out.map((f) => f.value)).toEqual(["keep me"]);
  });

  it("answers nothing for nothing", () => {
    expect(readInstructions(undefined)).toEqual([]);
    expect(readInstructions(null)).toEqual([]);
    expect(readInstructions("a string")).toEqual([]);
  });
});

describe("trimAmount", () => {
  it("cuts an asset amount down to something readable", () => {
    expect(trimAmount("20.3960908")).toBe("20.39");
    expect(trimAmount("4.98")).toBe("4.98");
  });

  it("truncates rather than rounds", () => {
    // Shown higher than it is, a figure invites a decision that does not hold.
    expect(trimAmount("20.999")).toBe("20.99");
  });

  it("leaves whole numbers and short amounts alone", () => {
    expect(trimAmount("1000")).toBe("1000");
    expect(trimAmount("0.5")).toBe("0.5");
  });

  it("never leaves a trailing dot", () => {
    expect(trimAmount("20.3960908", 0)).toBe("20");
    expect(trimAmount("20.", 2)).toBe("20");
  });
});
