# Adding an agent

herdr detects many coding agents. HerdrChat names each of them, and reads the
history of the ones it has a reader for. An agent without a reader is a
terminal row. This guide is the path from one to the other, in the order that
keeps every step testable. Grok and Antigravity were added this way.

## Before you write code

1. **Find how herdr names it.** The kind is herdr's id: `herdr api snapshot`
   shows it as a pane's `agent`, and `server.agent_manifests` lists every id
   herdr detects. Its integration (the hook that reports the session) is in
   `herdr integration status`; the name there is what
   `herdr integration install` takes, and it can differ from the kind (agy's
   is `antigravity-cli`).
2. **Find where it keeps a session, by the id herdr reports.** Install the
   integration, start a session in a herdr pane, and read the snapshot's
   `agent_session`. Its `value` (an id or a path) must lead to one file with
   no guessing: never the newest file in a folder (see CLAUDE.md).
3. **Capture real data for fixtures.** Copy a real session log, with paths and
   names renamed. For screens, `herdr pane read <pane> --source visible
   --lines 30` returns exactly what the live preview and the blocked-prompt
   parsers read; capture the agent working, asking for permission and asking a
   question. Read only: never send keys to a pane you did not start.

## The places, in order

| # | Where | What |
|---|-------|------|
| 1 | `src/lib/herdr/agents.ts` | The entry: `name`, `reader`, `integration`, `defaultTitles` (the terminal titles that name no chat), `missing` (said when the reported session's file is not there) and `digitAnswers` (whether a menu takes the digit alone). An agent herdr detects gets an entry even with no reader: `agentTable.test.ts` checks the table against `fixtures/herdr-agents.json`. Update that fixture when herdr adds an agent. |
| 2 | `src/lib/transcript/<agent>.ts` | The reader: one log line in, a `ChatMessage` and its session metadata (model, context) out. Hook it into `parseTranscriptLine` and the metadata read in `parser.ts`, and add the reader's name to `HistoryReader`. |
| 3 | `src/lib/transcript/store.ts` | The lookup in `transcriptPath` (and `forgetTranscript` if it caches): from the reported id or path to the file, as one host command. Offsets into the file are UTF-8 bytes, never `String.length`. |
| 4 | `src/lib/threadItems.ts` | Its tool names, if they differ from the ones already known (`read`, `COMMAND_TOOLS`, `EDIT_TOOLS`, `SEARCH_TOOLS`), so its calls fold into a run. |
| 5 | `src/lib/transcript/blockedPrompt.ts` | Its permission and question dialogs, from the captured screens in `src/lib/__tests__/fixtures/screens/`. |
| 6 | `src/lib/slashCommands/` | Its built-in commands (`builtins.ts`), its kind in `CatalogueAgent`, and the catalogue in `catalogue.ts`. |
| 7 | `scripts/herdr-apns-notifier.py` | Where the watcher finds the transcript (`transcript_path`), how it previews the last reply, and `DEFAULT_TERMINAL_TITLES`. Raise `WATCHER_VERSION`, run `node scripts/embed-watcher.mjs`, and add a case to `scripts/test_herdr_apns_notifier.py`. Any change to what the relay receives changes `site/privacy/` in the same commit. |
| 8 | `src/features/newChat/` | The New chat choice: `NewChatAgent` and its check in `useNewChat.ts`, the option in `NewChatScreen.tsx`. |
| 9 | `src/lib/demo/` | A Demo pane with a session of the agent's own format (`fixtures.ts`), the snapshot's `agent_session` for it and the lookup command in `host.ts`, and the line it writes for a sent message. |
| 10 | `.maestro/regression/<agent>.yaml` | A flow on that Demo pane: the row has the agent's name, the header has the model, a tool run folds, and a sent message is confirmed rather than "Failed to send". Add it to `FLOWS` in `scripts/e2e.sh` and describe it in `.maestro/README.md`. |
| 11 | Docs | `docs/getting-started.md` (the integration to install and where the sessions live), the agent lists in `README.md`, `CLAUDE.md` and the Welcome screen (`src/features/welcome/WelcomeScreen.tsx`). |

Each step adds the test that pins it: the reader against the captured log,
the lookup against the Demo host (`demoHost.test.ts`), the prompts against
the captured screens, the watcher in Python.

## Checks

```bash
npx tsc --noEmit && npx expo lint && npx jest
python3 -m unittest discover -s scripts -p 'test_*.py'
npm run e2e        # dark and light; open the new flow's screenshots
```

Then try it once against a real host: a new chat from New chat, a message and
its reply, a permission answered from the phone. Remove the integration
afterwards if it was not there before, and check the agent's own config
against a copy taken first.
