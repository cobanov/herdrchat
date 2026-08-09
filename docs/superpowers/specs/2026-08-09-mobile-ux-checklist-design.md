# Mobile UX checklist — design

**Date:** 2026-08-09
**Scope:** Settings, tab bar, action sheets and gestures, audited against a
four-part mobile UX checklist and brought up to it.

## Why

HerdrChat reads as native in the places that were built deliberately — the
UIKit tab bar, the bubble anatomy, the glass composer — and as unfinished in the
places nobody had a reason to visit yet. Settings has no way to reach support,
no legal links and nothing destructive grouped where destructive things go. Every
menu in the app is an `Alert`, including the ones that want to be action sheets.
The chat list has one gesture.

None of that is a bug. It is the residue of building the interesting parts
first.

## What is already satisfied

Worth stating, because the temptation is to rebuild things that work:

- **Native toggles.** `Toggle` wraps React Native's `Switch`, which *is*
  `UISwitch` on iOS. Nothing to do.
- **Tab count, icons, labels, active states, tap targets, fixed presence.**
  `NativeTabs` renders the system's own bar; all six are the system's problem.
- **App version.** The About section already carries version and build.
- **Grouped layout.** `Section` / `Row` / `Divider` already implement the
  grouped-list pattern, down to the divider inset. It only needs extending.
- **Pull to refresh.** Present on the chats list; missing only its haptic.

## Decisions

### No-account items are adapted, not invented

Six checklist items assume a consumer app with accounts and media. HerdrChat has
neither: identity is *which of your own machines am I SSH'd into*, and there is
no image or map content anywhere.

| Checklist item | Resolution |
|---|---|
| Account details at top | **Adapt** — active host card: name, `user@host:port`, live presence, tap → Hosts |
| Destructive actions grouped | **Adapt** — bottom red section: Clear cache, Reset app data |
| Log out / delete account | **Adapt** — Reset app data is the honest equivalent: keychain keys, hosts, cached threads |
| Pinch to zoom | **N/A** — no image or map content |
| Sheet snap points | **N/A** — a system action sheet sizes itself; snap points are a custom-sheet concept |
| Sheet content scrollability | **N/A** — same reason |

The N/A rows stay in `tasks.md` with their reasoning. A checklist item that was
considered and rejected is a different artefact from one that was missed, and
only writing down the first kind preserves the difference.

### Destructive-last is a rule, not a convention

`ActionSheetIOS` takes a flat `options` array plus two indices. Every call site
that builds those by hand is a place the order can drift and the indices can go
off by one. So the ordering lives in `src/lib/actionSheet.ts` as a pure
function, the indices are derived rather than written, and a test pins it.

This is the same shape as the `exit 127 → "herdr isn't installed here"` rule:
an interpretation that belongs in one place with a test on it, not re-decided
per caller.

### The badge does not add a poll

`NativeTabs.Trigger.Badge` needs an attention count at the layout level, and the
layout has no data of its own. The wrong fix is a poll in `_layout.tsx`; that
would double every host's SSH round-trips and quietly defeat the entire
`pollScale` preference.

Instead `useWorkspaces` — which already has the number — writes it to a
three-line zustand store, and the layout reads it. One writer, one reader, no
new traffic.

### Swipe actions are safe on a tab root

`app/(tabs)/index.tsx` currently argues against swipe actions: *"a swipe here
would fight the back gesture on the way out of a thread."*

That reasoning does not hold. The chats list is a **tab root** — it has no back
gesture. The comment is defending the thread screen, which is not where the rows
are. The real constraint is narrower and worth writing down in its place:
trailing-edge actions only, so a row swipe never begins in the left-edge region
that the interactive pop owns on screens that do have one.

### Settings grows, and that is not a regression

`settings.tsx` opens with *"Deliberately short."* This adds four sections to it.
The tension is real but resolvable: that comment was defending against
*noise* — Liquid Glass availability, New Architecture flags, mirrors of iOS
switches, all since removed. Support, legal and a version you can quote are the
opposite. They are the things a person opens Settings *for* when something is
wrong.

The file does have to stop being a 375-line route, though. Route files are meant
to stay under ~100 lines and compose from `src/features/`.

## Architecture

### New modules

```
src/lib/actionSheet.ts              pure: actions -> {options, indices}
src/components/ActionSheet.tsx      the only importer of ActionSheetIOS
src/components/SettingsList.tsx     Section / Row / Divider, promoted
src/features/settings/HostCard.tsx
src/features/settings/SupportSection.tsx
src/features/settings/DangerZone.tsx
src/features/chats/SwipeableChatRow.tsx
src/state/badge.ts                  attention count, one writer one reader
```

`src/lib/actionSheet.ts` imports nothing from React or from the SSH module,
which is what lets a test cover the index arithmetic without a simulator.

`src/components/ActionSheet.tsx` is the sole importer of `ActionSheetIOS`, the
same containment `Glass.tsx` applies to `expo-glass-effect`. On Android it falls
back to `Alert.alert`, which is that platform's own equivalent surface rather
than a JS imitation of an iOS one.

### The action sheet contract

```ts
export interface SheetAction {
  label: string;
  destructive?: boolean;
}

export function buildSheet(actions: SheetAction[], cancelLabel?: string): {
  options: string[];
  destructiveButtonIndex?: number;
  cancelButtonIndex: number;
};
```

Rules the pure function enforces, each with a test:

1. Safe actions keep their given order.
2. Destructive actions move after every safe one.
3. Cancel is always last.
4. `destructiveButtonIndex` is omitted when nothing is destructive.
5. More than one destructive action is an error — `ActionSheetIOS` takes a
   single index, and silently red-styling only the first would be a lie.

### Data flow

**Badge.** `useWorkspaces` computes `blocked + unread` → `useBadge.setCount()` →
`_layout.tsx` renders `<NativeTabs.Trigger.Badge>` on the Chats trigger. Cleared
to zero when no host is selected.

**Tab haptics.** `NativeBottomTabsNavigator` emits React Navigation's `tabPress`
on its `isNativeAction` branch. A `useTabPressHaptic()` hook subscribes in each
of the three tab screens. It cannot live in `Screen`, which modal screens also
use.

**Deep links.** `/(tabs)/settings?section=<id>`. The screen reads the param,
measures that section's offset and scrolls to it, then pulses its background
once so the eye lands on the right row. Sources: a failed push registration
links to `notifications`; an iOS-level denial calls `Linking.openSettings()`,
which is the only correct answer when the OS owns the switch.

### Error handling

Unchanged in philosophy: nothing new throws for an expected failure.

`Reset app data` is the one genuinely destructive addition, and it must survive
partial failure. A keychain entry that refuses to delete cannot be allowed to
leave an orphaned database row pointing at a host whose key is gone. Order is
therefore: keychain secrets first, client cache second, database rows last —
so any failure leaves a state the app can still describe, rather than one it
cannot.

## Testing

- `src/lib/__tests__/actionSheet.test.ts` — ordering and indices, including the
  no-destructive, all-destructive and multiple-destructive cases.
- The existing 144 tests stay green.
- `.maestro/settings.yaml` — reaching support, legal and the danger zone.
- Simulator, light and dark. A screenshot nobody opened is not a check.

## Out of scope

- **Drag to reorder hosts.** Ordering is not a concept the app has, and for the
  one-to-three hosts a person actually configures it is ceremony. Recorded in
  `tasks.md` as declined with a reason rather than left blank.
- **An in-app legal viewer.** The pages live on the site and would then need to
  stay in sync with a bundled copy. Links open in Safari.
