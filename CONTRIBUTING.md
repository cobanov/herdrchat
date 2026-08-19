# Contributing

Issues and pull requests are welcome. This file is the short version of what
the project expects; `CLAUDE.md` is the long version, and it is worth reading
before a first change — most of it is rules that were learned by getting them
wrong.

## Before you open a pull request

```bash
npm ci
npm run typecheck    # zero errors
npm run lint         # zero errors
npm test             # src/lib and hooks
```

CI runs exactly these three. If they pass locally they pass there.

For anything that changes what a screen looks like, also open the app in both
light and dark mode. A screenshot you did not look at is not a check.

## What makes a change easy to accept

**Say why, not what.** The diff already says what changed. Commit messages and
pull request descriptions here carry the reasoning — what was wrong, how it
failed, and why this is the fix rather than another one. Look at `git log` for
the register; it is unusual and it is deliberate.

**Put logic in `src/lib/`.** That directory imports nothing from React and
nothing from the SSH module, which is what lets the whole core be tested
against a canned host. A rule that lives there can have a test pinning it. The
same rule spread across a component cannot.

**Keep route files thin.** Files under `app/` compose from `src/features/` and
stay under about a hundred lines. Presentational components belong in a
feature directory, not in the route.

**No magic numbers outside `src/theme/`.** If a screen needs a colour, radius,
duration or spacing value that is not a token, add the token.

**An expected failure is not an exception.** The native module returns
`{ ok: false, code, message }` and TypeScript decides what it means. Host down,
key rotated, herdr not installed are three different things to a person, and
the interpretation lives in `client.ts` where a test pins it.

## Things worth knowing before you are surprised by them

- `ios/` and `android/` are generated and gitignored. Native configuration goes
  in `app.json` or a config plugin, never in the generated project.
- Use `npx expo install` for anything in the SDK, so versions stay aligned.
- npm, not pnpm — its symlink layout breaks native module resolution.
- Changes under `modules/herdr-ssh/` need a native rebuild. Fast Refresh does
  not reload native code.
- Android compiles but has never been run, and there is no release path in this
  branch. A Kotlin change cannot be verified here yet; say so in the pull
  request rather than implying it was.

## Scope

A pull request that does one thing is easier to review, and much easier to
revert if it turns out to be wrong. If a change needs a refactor to be
possible, the refactor is its own pull request.

If you are planning something large, open an issue first. It is cheaper to
disagree about an approach in an issue than in a finished branch.
