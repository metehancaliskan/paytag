import { GithubMark, XMark } from "./icons";
import { PROVIDER_KIND, type ProviderKey } from "./useIdentity";
import type { IdentityKind } from "@/lib/identity";

/**
 * The two providers, once, in the order they appear on every screen.
 *
 * Three places list them — the account menu, the claim flow and the connect
 * panel — and each one needs the same three things: a label, an icon, and the
 * identity kind the provider maps to. Kept here rather than in `useIdentity`
 * because the icon is JSX; the provider → kind mapping still lives there, with
 * the rest of the identity rules.
 *
 * X's icon is drawn a size smaller than GitHub's on purpose: the mark is a
 * glyph with no counters, so at equal height it reads heavier than the others.
 */
export type ProviderRow = {
  key: ProviderKey;
  label: string;
  /**
   * The provider named the way a handle is written, so a row reads the same
   * before and after verification: `x.com` becomes `x.com/you`. It also avoids
   * the stutter of "𝕏 X" — the mark already *is* the letter.
   */
  domain: string;
  kind: IdentityKind;
  icon: React.ReactNode;
};

export const PROVIDERS: ProviderRow[] = [
  {
    key: "github",
    label: "GitHub",
    domain: "github.com",
    kind: PROVIDER_KIND.github,
    icon: <GithubMark size={16} className="shrink-0 text-dim" />,
  },
  {
    key: "x",
    label: "X",
    domain: "x.com",
    kind: PROVIDER_KIND.x,
    icon: <XMark size={14} className="shrink-0 text-dim" />,
  },
];
