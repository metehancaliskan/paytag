import Image from "next/image";
import Link from "next/link";
import { avatarUrl, cardPath, type PersonCard } from "@/lib/cards";
import { KIND, kindUrlPrefix } from "@/lib/identity";
import { ROLES } from "@/lib/roles";

/**
 * One person in the directory.
 *
 * The same component renders the live preview in the card editor, which is the
 * point: what the author sees while typing is the row other people will see,
 * not an approximation of it.
 */
export default function PersonCardView({
  card,
  preview = false,
}: {
  card: PersonCard;
  /** Preview mode drops the link, so clicking inside the editor goes nowhere. */
  preview?: boolean;
}) {
  const role = card.role ? ROLES[card.role] : null;
  const avatar = avatarUrl(card);
  const name = card.displayName ?? card.handle;

  const body = (
    <>
      <div className="flex items-start gap-3">
        {avatar ? (
          <Image
            src={avatar}
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-full border border-line"
            unoptimized
          />
        ) : (
          <span
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-raised text-sm font-bold text-mute"
          >
            {card.handle.slice(0, 2).toUpperCase()}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold">{name}</h3>
            {role && <span className="badge shrink-0">{role.label}</span>}
          </div>
          <p className="mono truncate text-mute">
            {kindUrlPrefix(card.kind)}
            {card.handle}
          </p>
        </div>
      </div>

      {card.headline && (
        <p className="mt-3 font-medium leading-snug">{card.headline}</p>
      )}

      {card.summary && (
        <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-mute">
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

      <div className="mt-3 flex items-center gap-3 border-t border-line pt-3 text-xs text-mute">
        {card.linked.length > 0 && (
          <span>
            also{" "}
            {card.linked
              .map((l) => `${kindUrlPrefix(l.kind)}${l.handle}`)
              .join(", ")}
          </span>
        )}
        <span className="ml-auto font-semibold text-accent-text">
          {preview ? "Send" : "Send →"}
        </span>
      </div>
    </>
  );

  if (preview) {
    return <div className="card p-4">{body}</div>;
  }

  return (
    <Link
      href={cardPath(card)}
      className="card block p-4 transition-colors hover:border-line-strong"
    >
      {body}
    </Link>
  );
}

/**
 * The card as it appears on its owner's profile page — the full text, the
 * links, no clamping. The directory row is a teaser; this is the thing itself.
 */
export function PersonCardDetail({ card }: { card: PersonCard }) {
  const role = card.role ? ROLES[card.role] : null;

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge badge-claimed">verified</span>
        {role && <span className="badge">{role.label}</span>}
      </div>

      {card.headline && (
        <h2 className="mt-3 text-lg font-bold leading-snug">{card.headline}</h2>
      )}

      {card.summary && (
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-dim">
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
                className="link"
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
        {kindUrlPrefix(kind)}
        {handle} has not written a card yet. You can still pay the handle —{" "}
        {kind === KIND.GithubUser
          ? "the money waits in escrow until they verify."
          : "X verification is not live yet, so it waits until it is."}
      </p>
    </div>
  );
}
