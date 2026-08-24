// identity_key — turns an internet identity into a 32-byte tag.
//
// This file MUST produce the same bytes as `claim_preimage` in the contract
// and as `scripts/paytag.mjs`. If a single byte diverges, the money lands on
// one tag while the claim looks for another, and nothing works.
//
// Source of truth: docs/SPEC.md §2

export const KIND = {
  GithubUser: 0x00,
  GithubRepo: 0x01,
  XUser: 0x02,
  PaytagNick: 0x03,
} as const;

export type IdentityKind = (typeof KIND)[keyof typeof KIND];

/** The short name that appears in URLs: /p/gh/torvalds, /p/x/elonmusk */
export const KIND_SLUG = {
  gh: KIND.GithubUser,
  x: KIND.XUser,
} as const;

export type KindSlug = keyof typeof KIND_SLUG;

export function isKindSlug(s: string): s is KindSlug {
  return s === "gh" || s === "x";
}

export function slugOf(kind: IdentityKind): KindSlug {
  return kind === KIND.XUser ? "x" : "gh";
}

type Rule = {
  /** Name shown in the interface */
  label: string;
  /** Prefixes stripped from the front of the input — in order, once each */
  prefixes: string[];
  /** Applied AFTER ASCII lowercasing, hence the lowercase-only character class */
  pattern: RegExp;
  maxLen: number;
  /** The rule as told to the user in an error message */
  hint: string;
  /** Front of the identity's public profile link */
  urlPrefix: string;
};

/**
 * SPEC §2.1 (GitHub) and §2.4 (X).
 *
 * The rules are deliberately separate: GitHub accepts hyphens and runs to 39
 * characters, X accepts underscores and stops at 15. Collapsing them into one
 * function would silently bind an input that is only valid on one side — like
 * `elon-musk` — to the wrong identity.
 */
const RULES: Record<number, Rule> = {
  [KIND.GithubUser]: {
    label: "GitHub",
    prefixes: ["https://", "http://", "www.", "github.com/", "@"],
    pattern: /^[a-z0-9](?:-?[a-z0-9])*$/,
    maxLen: 39,
    hint: "letters, digits and single hyphens only; cannot start or end with a hyphen",
    urlPrefix: "github.com/",
  },
  [KIND.XUser]: {
    label: "X",
    prefixes: ["https://", "http://", "www.", "x.com/", "twitter.com/", "@"],
    pattern: /^[a-z0-9_]+$/,
    maxLen: 15,
    hint: "letters, digits and underscores only; 15 characters at most",
    urlPrefix: "x.com/",
  },
};

export function kindLabel(kind: IdentityKind): string {
  return RULES[kind]?.label ?? "unknown";
}

export function kindUrlPrefix(kind: IdentityKind): string {
  return RULES[kind]?.urlPrefix ?? "";
}

export function kindHint(kind: IdentityKind): string {
  return RULES[kind]?.hint ?? "";
}

/** Longest handle this kind allows — used to cap the input field. */
export function kindMaxLength(kind: IdentityKind): number {
  return RULES[kind]?.maxLen ?? 39;
}

export function profileUrl(kind: IdentityKind, handle: string): string {
  return `https://${kindUrlPrefix(kind)}${handle}`;
}

/**
 * Produces a normalized handle from raw user input.
 *
 * It rejects invalid input rather than repairing it: guessing at an ambiguous
 * handle means sending money to somebody else's tag (SPEC §2.2).
 */
export function normalizeHandle(
  raw: string,
  kind: IdentityKind = KIND.GithubUser,
): string {
  const rule = RULES[kind];
  if (!rule) throw new Error(`Unsupported identity kind: ${kind}`);
  if (typeof raw !== "string") throw new Error("A handle must be a string.");

  let s = raw.trim();

  for (const p of rule.prefixes) {
    if (s.toLowerCase().startsWith(p)) s = s.slice(p.length);
  }
  if (s.endsWith("/")) s = s.slice(0, -1);

  if (s.includes("/")) {
    throw new Error(
      `That ${rule.label} link has extra path on it — enter just the username.`,
    );
  }

  // ASCII lowercase. NEVER `toLocaleLowerCase`: in a Turkish locale it maps
  // "I" to "ı" and diverges from Rust's to_ascii_lowercase.
  s = asciiLower(s);

  if (s.length === 0) {
    throw new Error(`Enter a ${rule.label} username.`);
  }
  if (s.length > rule.maxLen || !rule.pattern.test(s)) {
    throw new Error(
      `${JSON.stringify(raw)} is not a valid ${rule.label} username — ${rule.hint}.`,
    );
  }
  return s;
}

/** Legacy name — prefer `normalizeHandle` in new code. */
export function normalizeGithubUser(raw: string): string {
  return normalizeHandle(raw, KIND.GithubUser);
}

export function normalizeXUser(raw: string): string {
  return normalizeHandle(raw, KIND.XUser);
}

function asciiLower(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 32) : s[i];
  }
  return out;
}

/** identity_key = sha256(kind_byte ‖ utf8(normalized_handle)) */
export async function identityKey(
  handle: string,
  kind: IdentityKind = KIND.GithubUser,
): Promise<Uint8Array> {
  const norm = normalizeHandle(handle, kind);
  const body = new TextEncoder().encode(norm);
  const buf = new Uint8Array(1 + body.length);
  buf[0] = kind;
  buf.set(body, 1);
  const digest = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return new Uint8Array(digest);
}

/**
 * The layer BELOW normalization.
 *
 * Only for input already known to be normalized. The reserved kinds
 * (`GithubRepo`, `PaytagNick`) have no normalization rule yet, but the parity
 * test still has to prove the kind byte changes the digest — SPEC §2.3's kind
 * separation table. NEVER call this with user input.
 */
export function identityKeyFromNormalized(
  normalizedHandle: string,
  kind: number,
): Promise<Uint8Array> {
  const body = new TextEncoder().encode(normalizedHandle);
  const buf = new Uint8Array(1 + body.length);
  buf[0] = kind;
  buf.set(body, 1);
  return crypto.subtle
    .digest("SHA-256", buf as BufferSource)
    .then((d) => new Uint8Array(d));
}

/** The kind byte as it is written in the spec: 0x00, 0x02. */
export function kindByteHex(kind: IdentityKind): string {
  return `0x${kind.toString(16).padStart(2, "0")}`;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error("Invalid hex string.");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
