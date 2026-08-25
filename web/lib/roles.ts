/**
 * Who fills in a card — and the answer is decided by the handle, not by a
 * question.
 *
 * The product has three kinds of user, and only two of them are listed:
 *
 *   community — sends money. Browses the directory, picks someone, pays. No
 *               card, because nobody needs to be convinced to accept a gift.
 *   shiller   — writes and posts. Gets paid for attention brought in.
 *   dev       — ships code. Gets paid for work done.
 *
 * THE ROLE IS THE PLATFORM. A GitHub account is where code lives, an X account
 * is where the audience lives, and the form used to ask "what do you do?" of
 * somebody who had just told it by signing in with one or the other. So the
 * question is gone and `roleForKind` answers it: kind 0x00 → dev, 0x02 →
 * shiller. One question fewer on the form, and no way to be listed as a
 * developer on the strength of an X account.
 *
 * The two card roles are still the two values the `cards.role` check constraint
 * allows (db/migration-001-roles.sql), and the column is still written — the
 * derivation is a product decision, and a column that already holds the answer
 * is what makes reversing it a one-line change instead of a migration.
 */

import { KIND, type IdentityKind } from "./identity";

export const ROLE_KEYS = ["shiller", "dev"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export type Role = {
  key: RoleKey;
  /** On badges and filters. */
  label: string;
  /** First person, as a heading — the landing page's three cards. */
  pick: string;
  /** One line saying what this role is paid for. */
  blurb: string;
  /** The platform this role comes from. */
  kind: IdentityKind;
};

/**
 * The KEY is what the database stores; the LABEL is what a reader sees, and the
 * two are allowed to differ. `shiller` stays the stored value — renaming it
 * would mean a migration, a rewritten check constraint and dead `?role=` links,
 * all to change a word nobody outside this file ever sees.
 *
 * "Community" and not "Community Growth" for the same reason a badge is one
 * word: it sits inside a card at 11px next to a handle. The growth is in the
 * sentence under it, where there is room to mean something.
 */
export const ROLES: Record<RoleKey, Role> = {
  shiller: {
    key: "shiller",
    label: "Community",
    pick: "I bring people in",
    blurb: "Threads, posts, spaces — the audience you grew.",
    kind: KIND.XUser,
  },
  dev: {
    key: "dev",
    label: "Developer",
    pick: "I build",
    blurb: "Contracts, tools, SDKs, docs — the code you shipped.",
    kind: KIND.GithubUser,
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
 * The role a handle on this platform has. This is the whole rule.
 *
 * Used at write time (what goes in `cards.role`) AND at render time (the badge
 * on a card), deliberately: a row written before the derivation existed can
 * hold the other value, and a card that says "Community" over a github.com
 * handle would be the only inconsistency on the page. Deriving on read makes
 * every old row correct without touching the database.
 */
export function roleForKind(kind: IdentityKind): RoleKey {
  return kind === KIND.XUser ? "shiller" : "dev";
}

/** The platform a role implies — the inverse, for the directory filter. */
export function kindForRole(role: RoleKey): IdentityKind {
  return ROLES[role].kind;
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
