# Design language

The whole system fits on one page, which is the point: a language nobody can
hold in their head is one that drifts by the third screen.

---

## The mark

A price tag with an **@** punched through it, on a green tile.

```
tag  = money waiting in escrow
@    = the person it is waiting for
```

Those are the only two nouns in the product, so the logo needs no tagline. Both
motifs recur inside the interface: an **@** wherever an identity appears, the tag
wherever escrow does.

**The mark is artwork, not code.** `brand/paytag-white-theme-logo.png` is the
4096px master; everything shipped is cut from it, and nothing redraws it:

| File | Size | Framing |
|---|---|---|
| `public/paytag-mark.png` | 96 | tight — the header, via `components/Logo.tsx` |
| `app/icon.png` | 32 | tight — the browser tab |
| `app/apple-icon.png` | 180 | as drawn — iOS masks it and expects the padding |
| `public/icon-512.png` | 512 | as drawn — home screen / PWA |

**Two framings, one reason.** The master carries about 21% padding on each side,
which is right for an app icon inside a platform's rounded mask and far too much
at 16px — the tag closes up and the @ becomes a dot. So the tab and the header
are cut from the same art with a 12% margin, and the two then read as the same
logo. Anything below 24px gets the tight cut; anything a platform masks gets the
master's own framing.

**What the raster costs, said plainly.** The mark no longer follows `--accent`:
the tile carries its own green, so changing the token changes the buttons and not
the logo — a new accent means re-exporting the master. And there is no per-size
cut any more: the old SVG dropped the @'s tail below 24px, a raster cannot, and
the tighter framing is what stands in for it.

**One tile for both themes.** The artwork has a filled background, so it needs no
light/dark variant. The rounded corner is applied in `Logo.tsx` (28% of the
side), not baked into the file, so the same square serves as an app icon and as
an inline mark.

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

**Every amount on screen is whole tokens.** `displayUnits()` in `lib/format.ts`
is the one function that renders money for reading: it floors to whole tokens
and groups thousands — `9,973 XLM`, not `9973.9455807 XLM` — because seven
decimal places are what the chain stores, not what a person reads. Three
conditions come with that:

- It **floors**. A balance shown higher than it is invites a transaction that
  fails, and "at least this much" is the only safe direction to be wrong in.
- Below one token it falls back to the exact value. Flooring `0.42` to `0` is
  not brevity, it is a different number.
- The exact figure stays reachable — a `title` on the element, the account menu
  for a balance, the explorer link beside a payment. A rounded number with no
  way to reach the real one is the same mistake as a truncated hash with no copy
  button.

The one exception is an input: "Max" fills the field with the exact spendable
balance, because that number is about to be sent, not read.

A dollar figure is always parenthesised or prefixed with `≈`, and it never names
where the rate came from. When the rate cannot be fetched it disappears
entirely — never a `$0`, which reads as a balance.

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
| `/app/submit` | Say what you shipped, under one handle | **Publish my card** |
| `/profile` Settings | Your handles, where they pay, your cards, the way out | Connect, or **Delete** |

Settings is reachable from every screen — a sliders icon beside the account
chip, not only a row inside a dropdown. Anything a person might want to change
about themselves is on that one page, in four labelled sections, ordered by
dependency: an identity, then where it pays, then what it says, then leaving.

A form is ONE card. `/app/submit` was five stacked panels, which made a
two-minute form look like a registration process and hid the two required
fields among three optional ones. Now: three numbered questions, everything
optional behind one disclosure that says what is inside it (`— optional · 3
tags, 2 links`), then the button. If a field cannot block the submit, it does
not get to occupy the first screen.

**Question one is the identity, and the sign-in happens inside it.** Which
handle the card is for decides everything below it — which escrow it advertises,
which page it becomes — so it is asked first, with both platforms shown whether
verified or not. Pick the one you have not proven and the form is replaced by a
single Connect row; you come back to the same question already answered. A form
that sends people to Settings for a credential it needs, and hopes they return,
is a form people do not finish.

**A question with one answer is not a question.** "What do you do?" used to be
question two, asked of somebody who had just answered it by signing in with
GitHub. It is gone: the role comes from the platform (`roleForKind`), and the
tile that picks the handle prints it — `Developer · verified`, and the line that
says what that means. The rule for the next one of these: if the reader's
previous answer determines this field, derive it and *show* it. Deriving
silently is worse than asking, because then nobody knows how they got listed.

The same collapse applied to the directory: two filter rows, *role* and
*platform*, were selecting identical rows. One row now, labelled by role with
the platform's mark beside it.

**One modal, and it is the end of a task.** Publishing a card opens a dialog
(`components/PublishedDialog.tsx`): the confirmation, the link selected and
ready to copy, and the way out. It used to be three buttons appearing under the
save button at the bottom of a long form — the one thing the reader wanted in
that moment was the quietest element on the page, and often below the fold.

That is the whole rule for modals here: a modal is honest when the task is
finished and the next thing is somewhere else. It is dishonest as a way to ask
for something the page could have asked for in place. Every one is a native
`<dialog>` with the `.modal` skin — the browser already does the focus trap, the
Esc key, the top layer and the backdrop, and those are the four things
hand-rolled modals get wrong.

The dashboard's first grid cell is always the dashed **+** tile. It reads as an
empty seat at the table: whatever the filters say, there is a place for you.
That tile replaced three sentences of invitation copy, which is the pattern to
follow — put the offer where the eye already is, not in a banner above it.

---

## Money paths have no defaults

A control that decides **where money goes** does not get a default value, and it
does not get a value guessed from the one thing the reader typed.

The rule came from three of them, all in the same shape:

- The "pay someone else" field opened on GitHub. A bare `elonmusk` is a valid
  username on both platforms, so nothing rejected it — a donor who meant X and
  did not notice the tab paid a stranger with the same name. It now starts on
  neither, and a pasted `github.com/…` or `x.com/…` link picks for them.
- `/p/<name>`, a link with no platform, was redirected to `/p/gh/<name>`. It now
  goes to `/pay/<name>`, which shows both spelled out and picks neither.
- The payout section opened on whichever identity sorted first and named it only
  in a screen-reader label. It names the handle in words now, every time, because
  a saved payout address is a hard lock at claim time.

The general form: if the reader has not said which of two things they mean, and
the two things are different people's money, the interface asks. Choosing for
them is not convenience, it is a wrong answer delivered confidently.

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
