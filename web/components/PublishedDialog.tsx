"use client";

import Link from "next/link";
import Modal from "./Modal";
import CopyButton from "./CopyButton";
import { kindUrlPrefix, slugOf, type IdentityKind } from "@/lib/identity";
import { ROLES, roleForKind } from "@/lib/roles";

/**
 * What happens the moment a card is published.
 *
 * This used to be three buttons appearing under the save button, at the bottom
 * of a long form, below the fold on a laptop. The one thing a person wants in
 * that moment — the link, to send to somebody — was the quietest element on the
 * screen, and half the time the screen had not even scrolled to it.
 *
 * So it interrupts. A publish is the end of the task, and the end of a task is
 * the one place a modal is the honest control: there is nothing else to do on
 * this page, and the reader has to be told the page exists somewhere else now.
 *
 * The dialog mechanics live in `Modal` — one shell for every dialog in the
 * product, so a second one cannot get the focus trap or the backdrop subtly
 * different from this one.
 */
export default function PublishedDialog({
  open,
  published,
  kind,
  handle,
  onClose,
}: {
  open: boolean;
  /** False for a draft — saved, but not in the directory. */
  published: boolean;
  kind: IdentityKind;
  handle: string;
  onClose: () => void;
}) {
  const path = `/p/${slugOf(kind)}/${handle}`;

  // The body is a separate component because `Modal` renders its children only
  // while open: that is what makes the absolute link safe to read straight from
  // `window`, with no server render to disagree with.
  return (
    <Modal open={open} onClose={onClose} labelledBy="published-title">
      <Body
        published={published}
        kind={kind}
        handle={handle}
        path={path}
        onDone={onClose}
      />
    </Modal>
  );
}

function Body({
  published,
  kind,
  handle,
  path,
  onDone,
}: {
  published: boolean;
  kind: IdentityKind;
  handle: string;
  path: string;
  onDone: () => void;
}) {
  const url = `${window.location.origin}${path}`;
  const role = ROLES[roleForKind(kind)];

  return (
    <>
      <div className="p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-black text-accent-fg"
          >
            ✓
          </span>
          <div className="min-w-0">
            <h2 id="published-title" className="font-bold">
              {published ? "Your card is live." : "Draft saved."}
            </h2>
            <p className="mt-1 text-sm text-mute">
              {published
                ? "It is in the directory. Send people the link."
                : "Only you can see it. Your handle is payable either way."}
            </p>
          </div>
        </div>
      </div>

      {/* The link, as the thing it is: text you take somewhere else. Copy is
          the primary action and the first focusable element, so a keyboard
          lands on it with the dialog. */}
      <div className="border-t border-line p-5">
        <label className="menu-label" htmlFor="published-link">
          Your link
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            id="published-link"
            readOnly
            value={url}
            className="field mono min-w-0 flex-1 text-sm"
            // Selected on focus, so the dialog opens with the link ready for
            // one keystroke. "backward" is the part that matters: a plain
            // select() leaves the caret at the end and the field scrolled past
            // the `https://`, which reads as a truncated link.
            onFocus={(e) => {
              const el = e.currentTarget;
              el.setSelectionRange(0, el.value.length, "backward");
              // And pinned to the left. A focused input scrolls to its caret,
              // and a link read from the middle of the host name looks like a
              // different link.
              el.scrollLeft = 0;
              requestAnimationFrame(() => {
                el.scrollLeft = 0;
              });
            }}
          />
          <CopyButton
            value={url}
            label="Copy"
            className="btn btn-primary shrink-0"
          />
        </div>
        <p className="mt-2 text-xs text-mute">
          <span className="mono">
            {kindUrlPrefix(kind)}
            {handle}
          </span>{" "}
          · {published ? `listed as ${role.label}` : `${role.label}, not listed yet`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line p-5">
        <Link className="btn btn-ghost btn-sm" href={path}>
          View my page
        </Link>
        {published && (
          <Link className="btn btn-ghost btn-sm" href="/app">
            See the directory
          </Link>
        )}
        <button
          type="button"
          className="btn btn-quiet btn-sm ml-auto"
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </>
  );
}
