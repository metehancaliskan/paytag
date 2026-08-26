"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The dialog shell, once.
 *
 * A native `<dialog>` rather than a div with a z-index: the browser already
 * does the focus trap, the Esc key, the top layer and the backdrop, and those
 * are the four things hand-rolled modals get wrong. What it does not do on its
 * own is close on a backdrop click, which is the one line added here.
 *
 * `children` render only while open. Two reasons, and the second is the one
 * that bites: a closed dialog's contents are still in the accessibility tree
 * for some readers, and anything inside that reads `window` would otherwise run
 * during the server render and disagree with the first client one.
 *
 * When a modal is the right control at all: at the END of a task, when the next
 * thing is somewhere else. Never to ask for something the page could ask in
 * place — see docs/DESIGN.md.
 */
export default function Modal({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** id of the heading inside, so the dialog announces itself. */
  labelledBy: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal"
      // Fires for Esc, for the Done button's close() and for the backdrop click
      // below alike, so the parent's state cannot drift out of step with the
      // element's.
      onClose={onClose}
      // The backdrop is the dialog's own box: a click that lands on the element
      // itself rather than on anything inside it landed outside the panel.
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      aria-labelledby={labelledBy}
    >
      {open && children}
    </dialog>
  );
}
