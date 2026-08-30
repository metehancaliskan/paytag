import Link from "next/link";
import Avatar from "./Avatar";
import { avatarUrl, cardPath, type PersonCard } from "@/lib/cards";
import { KIND, kindUrlPrefix } from "@/lib/identity";
import { ROLES, roleForKind } from "@/lib/roles";
import { GithubMark, XMark } from "./icons";

/**
 * Quick-tip amounts, in dollars.
 *
 * Three presets and nothing else: the point of a directory row is to turn
 * "I like this person's work" into a signed transaction without a detour, and a
 * grid of ten choices is a decision, not a shortcut. Each one lands on the pay
 * page with the field already filled, so what is left is connect and sign.
 */
const TIPS = [5, 10, 25] as const;

/**
 * One person in the directory.
 *
 * The same component renders the live preview in the card editor, which is the
 * point: what the author sees while typing is the row other people will see,
 * not an approximation of it.
 *
 * EVERY FIELD A PERSON WROTE BREAKS. The headline and the summary are the only
 * text on this page whose shape nobody here controls, and the shape that breaks
 * a card is not a long sentence — a browser wraps those at the spaces — it is
 * one long unbroken run of characters with no space in it. Without
 * `break-words` such a run refuses to wrap and simply draws past the card's
 * border, over whatever is beside it. `truncate` is the answer where a single
 * line is all there is room for (the name, the handle); where the whole text is
 * meant to be read, breaking is the answer, because clipping a card's own
 * headline would hide what the card is for.
 */
export default function PersonCardView({
  card,
  preview = false,
}: {
  card: PersonCard;
  /** Preview mode drops the link, so clicking inside the editor goes nowhere. */
  preview?: boolean;
}) {
  // From the platform, not from the stored column. The role IS the platform
  // now (lib/roles.ts), and a row written before that rule existed can still
  // hold the other value — a card badged "Community" over a github.com handle
  // would be the only thing on the page contradicting itself.
  const role = ROLES[roleForKind(card.kind)];
  const avatar = avatarUrl(card);
  const name = card.displayName ?? card.handle;

  const body = (
    <>
      <div className="flex items-start gap-3">
        <Avatar src={avatar} handle={card.handle} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {card.kind === KIND.XUser ? (
              <XMark size={13} className="shrink-0 text-mute" />
            ) : (
              <GithubMark size={14} className="shrink-0 text-mute" />
            )}
            <h3 className="truncate font-semibold">{name}</h3>
            <span className="badge shrink-0">{role.label}</span>
          </div>
          <p className="mono truncate text-mute">
            {kindUrlPrefix(card.kind)}
            {card.handle}
          </p>
        </div>
      </div>

      {card.headline && (
        <p className="mt-3 break-words font-medium leading-snug">
          {card.headline}
        </p>
      )}

      {card.summary && (
        <p className="mt-1.5 line-clamp-3 break-words text-sm leading-relaxed text-mute">
          {card.summary}
        </p>
      )}

      {card.ecosystems.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {card.ecosystems.map((e) => (
            <li key={e} className="badge">
              {e}
            </li>
          ))}
        </ul>
      )}

      {card.linked.length > 0 && (
        <p className="mt-3 text-xs text-mute">
          also{" "}
          {card.linked
            .map((l) => `${kindUrlPrefix(l.kind)}${l.handle}`)
            .join(", ")}
        </p>
      )}
    </>
  );

  if (preview) {
    return (
      <div className="card p-4">
        {body}
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          {TIPS.map((t) => (
            <span key={t} className="btn btn-ghost btn-sm">
              ${t}
            </span>
          ))}
          <span className="btn btn-quiet btn-sm ml-auto">Open →</span>
        </div>
      </div>
    );
  }

  // The card is not one big link any more: the tip buttons are links of their
  // own, and a link inside a link is invalid markup that browsers resolve by
  // guessing. The name and the "Open" row carry the navigation instead.
  return (
    <div className="card p-4 transition-colors hover:border-line-strong">
      <Link href={cardPath(card)} className="block">
        {body}
      </Link>

      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        {TIPS.map((t) => (
          <Link
            key={t}
            href={`${cardPath(card)}?amount=${t}`}
            className="btn btn-ghost btn-sm"
            title={`Send $${t} to ${kindUrlPrefix(card.kind)}${card.handle}`}
          >
            ${t}
          </Link>
        ))}
        <Link
          href={cardPath(card)}
          className="btn btn-quiet btn-sm ml-auto"
        >
          Open →
        </Link>
      </div>
    </div>
  );
}

/**
 * The card as it appears on its owner's profile page — the full text, the
 * links, no clamping. The directory row is a teaser; this is the thing itself.
 */
export function PersonCardDetail({ card }: { card: PersonCard }) {
  // From the platform, not from the stored column. The role IS the platform
  // now (lib/roles.ts), and a row written before that rule existed can still
  // hold the other value — a card badged "Community" over a github.com handle
  // would be the only thing on the page contradicting itself.
  const role = ROLES[roleForKind(card.kind)];

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge badge-claimed">verified</span>
        <span className="badge">{role.label}</span>
      </div>

      {card.headline && (
        <h2 className="mt-3 break-words text-lg font-bold leading-snug">
          {card.headline}
        </h2>
      )}

      {card.summary && (
        <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-dim">
          {card.summary}
        </p>
      )}

      {card.ecosystems.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {card.ecosystems.map((e) => (
            <li key={e} className="badge">
              {e}
            </li>
          ))}
        </ul>
      )}

      {card.links.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {card.links.map((l) => (
            <li key={l.url}>
              <a
                className="link break-all"
                href={l.url}
                target="_blank"
                rel="noreferrer nofollow"
              >
                {l.host}
              </a>
            </li>
          ))}
        </ul>
      )}

      {card.linked.length > 0 && (
        <p className="mt-4 border-t border-line pt-3 text-xs text-mute">
          Same person also verified{" "}
          {card.linked
            .map((l) => `${kindUrlPrefix(l.kind)}${l.handle}`)
            .join(", ")}
          . Each identity holds its own escrow.
        </p>
      )}
    </div>
  );
}

/** Shown on a profile whose owner has verified but written no card yet. */
export function NoCardYet({
  handle,
  kind,
}: {
  handle: string;
  kind: PersonCard["kind"];
}) {
  return (
    <div className="card p-5 text-sm text-mute">
      <p>
        No card yet. {kindUrlPrefix(kind)}
        {handle} is payable anyway.
      </p>
    </div>
  );
}
