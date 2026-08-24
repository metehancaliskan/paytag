# Design language

The whole system fits on one page, which is the point: a language nobody can
hold in their head is one that drifts by the third screen.

---

## The mark

A price tag with an **@** punched through it.

```
tag  = money waiting in escrow
@    = the person it is waiting for
```

Those are the only two nouns in the product, so the logo needs no tagline.
`components/Logo.tsx` draws it, and both motifs recur inside the interface: an
**@** wherever an identity appears, the tag wherever escrow does.

**The punched hole is not decoration.** One dot near the narrow end is what
makes the silhouette read as a *price tag* rather than a shield, and it is the
one detail that survives down to 16px. Both cuts keep it.

**Every part is a path.** A logo may not depend on a font — the `@` glyph is
drawn differently on macOS, Windows and Android, and a brand that changes shape
per platform is not a brand.

**Two cuts.** `full` keeps the @'s tail and needs about 24px. `tight` reduces
the @ to its ring, for 16–20px, where the tail turns to mush. `Logo` switches
automatically at 24px; `app/icon.svg` is the tight cut, because that file is
only ever seen as a favicon.

---

## Color

One accent, three text tones, one line. That is the whole palette, and it is
defined once as semantic tokens in `app/globals.css` — never a raw hex in a
component.

| Token | Job |
|---|---|
| `--accent` | The one green. Buttons, the mark, anything the reader should press. |
| `--accent-text` | The same green, darkened for body text where the fill fails contrast. |
| `--text` / `--dim` / `--mute` | Three tones, in that order of importance. There is no fourth. |
| `--line` / `--line-strong` | Borders. Strong is for anything interactive. |
| `--warn` / `--danger` | A caution (refund, wrong network) and a failure. Never decoration. |

Light and dark are a value swap of those tokens, which is why no component
carries a `dark:` variant. A new color is a decision about meaning, not about
taste — if it does not answer "what does this tell the reader", it does not get
a token.

---

## Shape and space

| | |
|---|---|
| Card radius | `0.875rem` (`.card`) |
| Button radius | `0.625rem`, small `0.5rem`, large `0.75rem` |
| Badge / chip radius | `0.5rem` |
| The mark's badge | 28% of its own size, so it scales with it |
| Page width | `max-w-6xl` for lists, `max-w-3xl` for anything read top to bottom |
| Gap between cards | `1rem`. Between sections, `1.5–2rem`. |

Money and ledger numbers use `.num` (tabular figures), so a changing balance
does not shuffle the layout sideways. Hashes and addresses use `.mono`, always
shortened, always with a copy button — truncating without one is hiding
evidence.

---

## Words

The rule that governs every screen: **a title, and at most one line under it.**

- If a card needs two sentences, the second one belongs in a disclosure.
- If a button needs an explanation, the label is wrong.
- An empty state gets one sentence and one action, never a paragraph.
- State is a badge, not a sentence: `listed`, `draft`, `verified`, `pending`,
  `claimed`, `refunded`.
- A number with a unit beats an adjective. "0.0000010 XLM" over "a small fee".

Where honesty needs more room than a line — accepted risks, what is not proven
yet — it goes into a `<details>` or onto `/evidence`, in full. Brevity is for
the surface, not for the truth.

---

## The four screens

| Screen | One job | The one action |
|---|---|---|
| `/` landing | Explain it in ten seconds | **App →** |
| `/app` dashboard | Who can be paid | A card's `$5 · $10 · $25`, or the **+** tile |
| `/app/submit` | Say what you do | **Publish my card** |
| `/profile` | Your handles, where they pay, your cards, the way out | Connect, or **Claim** |

The dashboard's first grid cell is always the dashed **+** tile. It reads as an
empty seat at the table: whatever the filters say, there is a place for you.
That tile replaced three sentences of invitation copy, which is the pattern to
follow — put the offer where the eye already is, not in a banner above it.

---

## Destructive things

`/profile` reads top to bottom in the order of dependency — identities, payout
address, cards, and leaving — so the irreversible thing is last, where nobody
reaches it by accident.

Red is rationed. `--danger` is a text colour everywhere except one filled
button, `.btn-danger`, which belongs to deleting your own account and to nothing
else. A second filled red anywhere teaches the reader to stop noticing the
first.

The pattern for anything irreversible, and it is three rules:

1. **Collapsed until asked for.** One quiet line and a link, not a red panel
   sitting open on a page people visit for other reasons.
2. **Type the thing, don't click twice.** A second button gets clicked; a handle
   has to be read first. `@handle` is the confirmation, and the server checks it
   too — a client that skips it is not the last word.
3. **Say what survives, not just what goes.** People read "delete my account" as
   "lose my money". Here the escrow is untouched, and that sentence goes first —
   an honest list is what makes the button safe to press.

The same applies to the quieter irreversible one: a payout address is shown as
`locked`, with the wallet it pays visible and copyable, because a destination
you cannot read is a destination you cannot check.

---

## Two identities, one person

A GitHub handle and an X handle are separate identities: separate escrows,
separate cards, separate rows in `identities`. The interface says so plainly and
then gets out of the way:

- The profile lists them as two rows under one account, not two accounts.
- Anything that acts on one — the claim, the card editor, the payout address —
  shows a small segmented control rather than guessing which you meant.
- Wherever one identity is shown, the *other* one can be verified in place. A
  page that says "verified as @you" while money sits waiting for your other
  handle, and offers no way to reach it from there, is hiding the thing it
  just implied.
- Nothing anywhere sums the two into one number. A total spanning two identities
  would not be any real amount of anything.
