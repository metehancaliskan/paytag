/**
 * Who fills in a card.
 *
 * The product has three kinds of user, and only two of them are listed:
 *
 *   community — sends money. Browses the directory, picks someone, pays. No
 *               card, because nobody needs to be convinced to accept a gift.
 *   shiller   — writes and posts. Gets paid for attention brought in.
 *   dev       — ships code. Gets paid for work done.
 *
 * The two card roles are the same two values the `cards.role` check constraint
 * allows (db/migration-001-roles.sql). Adding one here without adding it there
 * produces a write that the database refuses, which is the intended direction
 * of that failure.
 */

export const ROLE_KEYS = ["shiller", "dev"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export type Role = {
  key: RoleKey;
  /** On badges and filters. */
  label: string;
  /** First person, for the picker — the reader is choosing who they are. */
  pick: string;
  /** One line under the pick, saying what this role is paid for. */
  blurb: string;
};

/**
 * The KEY is what the database stores; the LABEL is what a reader sees, and the
 * two are allowed to differ. `shiller` stays the stored value — renaming it
 * would mean a migration, a rewritten check constraint and dead `?role=` links,
 * all to change a word nobody outside this file ever sees.
 */
export const ROLES: Record<RoleKey, Role> = {
  shiller: {
    key: "shiller",
    label: "Community",
    pick: "I bring people in",
    blurb: "Threads, posts, explainers, spaces — attention you created.",
  },
  dev: {
    key: "dev",
    label: "Developer",
    pick: "I build",
    blurb: "Contracts, tools, SDKs, docs, fixes — code you shipped.",
  },
};

export const ROLE_LIST: Role[] = ROLE_KEYS.map((k) => ROLES[k]);

export function isRoleKey(v: unknown): v is RoleKey {
  return typeof v === "string" && (ROLE_KEYS as readonly string[]).includes(v);
}

export function roleLabel(v: unknown): string {
  return isRoleKey(v) ? ROLES[v].label : "Contributor";
}

/**
 * The tags a card can carry. A fixed list rather than free text: free tags
 * fragment instantly ("soroban", "Soroban", "soroban-sdk") and a directory
 * filter built on them stops working after the second card.
 */
export const ECOSYSTEMS = [
  "Soroban",
  "Wallets",
  "Payments",
  "DeFi",
  "Tooling",
  "SDKs",
  "Docs",
  "Content",
  "Community",
  "Events",
] as const;

export type Ecosystem = (typeof ECOSYSTEMS)[number];

/** Keeps a card readable, and keeps "I do everything" out of the list. */
export const MAX_ECOSYSTEMS = 4;
export const MAX_LINKS = 3;

export const HEADLINE_MIN = 3;
export const HEADLINE_MAX = 80;
export const SUMMARY_MIN = 20;
export const SUMMARY_MAX = 1000;
