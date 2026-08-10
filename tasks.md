# Mobile UX checklist

Thirty-one items across four areas, audited 2026-08-09 against the app as it
stood at build 40, and closed the same day. Design: [`docs/superpowers/specs/2026-08-09-mobile-ux-checklist-design.md`](docs/superpowers/specs/2026-08-09-mobile-ux-checklist-design.md).

Status is one of:

- **done** — already satisfied before the audit, or satisfied by this work
- **gap** — genuinely missing, has an issue
- **n/a** — considered and does not apply to this app, with the reason
- **declined** — applies, judged not worth building, with the reason

An item that was considered and rejected is a different thing from one that was
missed. Both are written down here so the difference survives.

---

## Settings

| # | Item | Status | Issue |
|---|---|---|---|
| S1 | Grouped table layout | done | #26 |
| S2 | Native toggle controls | done | — |
| S3 | Destructive actions grouped | done | #26 |
| S4 | Account details at top | done | #26 |
| S5 | Deep link to specific settings | done | #27 |
| S6 | Support and feedback access | done | #26 |
| S7 | App version | done | — |
| S8 | Legal links | done | #26 |

**S1 — Grouped table layout.** `Section` / `Row` / `Divider` already implement
the pattern properly, down to the divider stopping at the label's left edge.
What is missing is that the first two controls — Appearance and Check for
updates — float outside any section, so the screen opens with two unlabelled
controls above the first heading.

**S2 — Native toggle controls.** `Toggle` wraps React Native's `Switch`, which
is `UISwitch` on iOS and Material Switch on Android. Already correct.

**S3 — Destructive actions grouped.** There is no destructive section. Clear
cache is a tinted button inside Storage, and nothing wipes the app. Becomes a
bottom section in red: Clear cache, and Reset app data — which deletes keychain
keys, hosts and cached threads, and is this app's honest equivalent of log out
and delete account.

**S4 — Account details at top.** There is no account. Identity here is which of
your own machines the app is talking to, so the anchor is an active-host card:
name, `user@host:port`, live presence, tapping through to Hosts.

**S5 — Deep link to specific settings.** Nothing links into settings. A failed
push registration says notifications are off in iOS Settings and leaves you to
find them.

**S6 — Support and feedback access.** No path to support at all. Points at
`github.com/cobanov/herdrchat/issues`, with a Copy diagnostics row alongside it —
version, build, host count and last SSH error — so a report arrives with the
details you would otherwise have to ask for.

**S7 — App version.** About already carries version and build.

**S8 — Legal links.** The privacy policy exists at `site/privacy` and is not
linked from the app. No terms of service exists; a short one gets written, since
there is genuinely little to say when there are no accounts, no payments and no
servers of ours.

---

## Tab bar

| # | Item | Status | Issue |
|---|---|---|---|
| T1 | Tab count (3–5) | done | — |
| T2 | Icon and label | done | — |
| T3 | Active and default states | done | — |
| T4 | Badge counts | done | #28 |
| T5 | Fixed presence | done | — |
| T6 | Tap target size | done | — |
| T7 | Haptic feedback | done | #28 |

**T1–T3, T5, T6.** `NativeTabs` renders the system's own UIKit bar. Three tabs,
each with an SF Symbol and a label, selected variants and a tint for the active
state, 44pt+ targets, and the bar stays put on tab roots while a pushed thread
covers it. All six are the system's behaviour, not an imitation of it.

**T4 — Badge counts.** No badge. Chats should carry the number of threads
wanting attention — blocked, plus unread. `NativeTabs.Trigger.Badge` exists, so
this is native rather than a JS overlay. The count must come from the poll that
already runs; a second poll in the layout would double every host's SSH
round-trips and defeat the `pollScale` preference.

**T7 — Haptic feedback.** No haptic on tab selection. `onTabChange` is not on the
public `NativeTabs` props, but the navigator emits React Navigation's `tabPress`
on native selection, which is the supported hook.

---

## Action sheet

Every menu and confirmation in the app is currently an `Alert`. The long-press
chat menu is the clearest case: it wants to be a sheet and is a stacked
centre-screen dialog, so it gets none of the backdrop dismiss, drag dismiss or
thumb-reachable placement below.

| # | Item | Status | Issue |
|---|---|---|---|
| A1 | Heading and actions | done | #29 |
| A2 | Swipe or backdrop dismiss | done | #29 |
| A3 | Destructive action styling | done | #29 |
| A4 | Cancel action | done | #29 |
| A5 | Snap points | n/a | — |
| A6 | Content scrollability | n/a | — |
| A7 | Keyboard relation | done | #29 |
| A8 | Backdrop dimming | done | #29 |

**A1–A4, A8.** All five follow from replacing `Alert` with a real action sheet.
The system supplies backdrop dimming, tap-outside dismiss and red destructive
styling; the app supplies the title and the ordering. Destructive-last stops
being something each call site remembers and becomes a rule enforced once, with
a test on the index arithmetic.

**Corrected 2026-08-10, on a simulator.** This originally also claimed bottom
anchoring and drag-down dismiss. Neither is true on iOS 26: Apple unified the
alert and action-sheet presentations, and `ActionSheetIOS` now renders as a
CENTRED glass card on iPhone at any number of actions — a three-action sheet
centres exactly like a one-action confirmation. Verified by probe, and the
ordering it renders is right: safe actions in order, destructive red and last,
Cancel below it. Bottom-edge placement would now mean building a custom sheet,
which is a separate decision and not currently worth it.

**A5 — Snap points.** n/a. A system action sheet sizes itself to its content.
Snap points are a resizable-custom-sheet concept, and building a custom sheet to
have somewhere to put them would be the wrong trade.

**A6 — Content scrollability.** n/a, same reason. No sheet in this app has more
than four actions.

**A7 — Keyboard relation.** Rename uses `Alert.prompt`, which is iOS-only and
cannot be styled or positioned. Renaming goes to a proper input surface that
behaves with the keyboard, and gets an Android path at the same time — today
Android silently has no rename at all.

---

## Gesture navigation

| # | Item | Status | Issue |
|---|---|---|---|
| G1 | Swipe to go back | done | #33 |
| G2 | List item swipe actions | done | #30 |
| G3 | Pull to refresh | done | #32 |
| G4 | Long press menus | done | #31 |
| G5 | Pinch to zoom | n/a | — |
| G6 | Drag to reorder | declined | — |
| G7 | Gesture hints | done | #30 |
| G8 | Haptic feedback | done | #30, #32 |

**G1 — Swipe to go back.** Native stack enables it by default, but the thread
screen draws its own header with `headerShown: false` and nothing has confirmed
the gesture still works there. Verify on device, and pin it in a Maestro flow so
a future screen option cannot silently take it away.

**G2 — List item swipe actions.** None. Chat rows get trailing Rename and Close.

The code currently argues against this: *"a swipe here would fight the back
gesture on the way out of a thread."* That reasoning does not hold — the chats
list is a tab root and has no back gesture. The real constraint is narrower:
trailing-edge only, so a row swipe never starts in the left-edge region the
interactive pop owns on screens that do have one.

**G3 — Pull to refresh.** Present on the chats list, with no haptic when it
fires — so on a slow host there is a beat where nothing has acknowledged the
pull.

**G4 — Long press menus.** Chat rows and the stop button have one. Message
bubbles do not, which means there is no way to copy what an agent said — on a
phone, from a tool whose whole output is text.

**G5 — Pinch to zoom.** n/a. There is no image, map or diagram content in the
app; the only rendered media is text and tool chips.

**G6 — Drag to reorder.** declined. Ordering is not a concept the app has —
hosts are a set you pick one from, not a ranked list — and for the one to three
hosts a person actually configures, a reorder affordance is ceremony. Revisit if
host lists ever get long enough to scroll.

**G7 — Gesture hints.** Nothing hints at any gesture. Needed once G2 lands,
since a swipe action nobody discovers is the same as no swipe action.

**G8 — Haptic feedback.** Partial. Long-press-to-manage buzzes; pull-to-refresh
and swipe-action commit do not. The calibration already documented in
`src/lib/haptics.ts` decides which weight each gets.

---

## Score

| Area | Done | Gap | n/a | Declined |
|---|---|---|---|---|
| Settings | 8 | 0 | 0 | 0 |
| Tab bar | 7 | 0 | 0 | 0 |
| Action sheet | 6 | 0 | 2 | 0 |
| Gestures | 7 | 0 | 1 | 1 |
| **Total** | **28** | **0** | **3** | **1** |

All twenty gaps closed. Three items do not apply to this app and one was
declined; the reasons are above, next to the items themselves.

---

# Spacing / grid checklist

Seven items, audited 2026-08-10. Design decisions recorded inline.

| # | Item | Status |
|---|---|---|
| P1 | Spacing scale | done |
| P2 | Semantic spacing tokens | done |
| P3 | Column grid | n/a |
| P4 | Breakpoints | n/a |
| P5 | Component vs layout spacing | done |
| P6 | Density variants | n/a |
| P7 | Baseline grid alignment | n/a |

**P1 — Spacing scale.** There was a scale, and the app did not use it.
`tokens.ts` declared eight values and claimed an 8pt grid; the app actually used
sixteen, including every integer from 2 to 10.

The mechanism was token arithmetic — 29 sites like `spacing.xs + 2`,
`spacing.sm - 1`, `radius.sm - 3`. Every one of them passed the "no magic
numbers outside `src/theme/`" rule, because the rule was written to catch a bare
literal and these all mention a token. `spacing.xs + 2` is the number 6 wearing
a costume.

Fixed by snapping the drift to the scale, promoting the genuinely load-bearing
off-scale values to named tokens in `size`, and expressing the one real
geometric rule (`nestedRadius`) as a function instead of a subtraction. The doc
comment now describes the scale that exists.

**P2 — Semantic spacing tokens.** Hybrid, and now explicit. The size-named scale
stays the primitive vocabulary — that is what stops a token drifting from its
meaning — and `layout` sits on top of it naming the recurring decisions. The
half-built semantic layer that already existed (`screenPadding`, `ROW_INSET`,
`minTouchTarget`, `headerTitleLine`) was the evidence the app wanted this and
had not decided.

**P3 — Column grid.** n/a. `orientation: portrait`, `supportsTablet: false`, so
there is one viewport class and a 4/8/12 column grid has nothing to respond to.

**P4 — Breakpoints.** n/a for the same reason — but the axis that DOES vary here
is Dynamic Type, and nothing is defined against it. Worth its own work; a phone
app's real "breakpoint" is the text size, not the screen.

**P5 — Component vs layout spacing.** Was one scale for both: `spacing.md`
served as 25 paddings and 9 gaps. `layout.componentPadding` and `layout.gap` are
now separate namespaces even where values coincide, so a button's inside and a
page's rhythm can move independently.

**P6 — Density variants.** n/a. One density. The chat list is the only
data-dense surface and its row height is driven by the avatar, not by padding,
so a compact mode would not buy much.

**P7 — Baseline grid alignment.** n/a as specified. Line heights are Apple's
system values (41/34/28/25/22/21/20/18/16/13) and are deliberately not
grid-aligned — matching the platform matters more here than matching a grid, and
`allowFontScaling` means they move with Dynamic Type anyway.

## Enforcement

`src/lib/__tests__/spacing.test.ts` greps the source and fails on token
arithmetic or a bare numeric padding/margin/gap. A convention that can be
defeated by adding `+ 2` is not a convention.
