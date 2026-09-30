#!/usr/bin/env python3
"""Enrich the Demo host for the App Store screens, in place. Never commit the result.

    python3 store/enrich-demo.py          # apply
    git checkout -- src/lib/demo/fixtures.ts src/state/connections.ts   # undo

Five chats on a host named mac-studio: one waiting on a question after a run
of tool calls, two working (one with a picture sent from the phone), one idle,
one done. The picture only shows once the phone holds its copy: put
store/raw/pantry-login.png in the app's Documents/attachments/ (see README).
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = ROOT / 'src/lib/demo/fixtures.ts'
CONNECTIONS = ROOT / 'src/state/connections.ts'

WORKSPACES = """export const DEMO_WORKSPACES: readonly DemoWorkspace[] = [
  { workspaceId: 'w1', label: 'herdrchat', number: 1, paneId: 'w1:p1', cwd: '/home/demo/code/herdrchat', agentStatus: 'blocked' },
  { workspaceId: 'w2', label: 'pantry-web', number: 2, paneId: 'w2:p1', cwd: '/home/demo/code/pantry-web', agentStatus: 'working' },
  { workspaceId: 'w3', label: 'billing-api', number: 3, paneId: 'w3:p1', cwd: '/home/demo/code/billing-api', agentStatus: 'working' },
  { workspaceId: 'w4', label: 'release-notes', number: 4, paneId: 'w4:p1', cwd: '/home/demo/code/notes', agentStatus: 'idle' },
  { workspaceId: 'w5', label: 'scratch', number: 5, paneId: 'w5:p1', cwd: '/home/demo/code/scratch', agentStatus: 'done' },
];
"""

SESSIONS = """export const DEMO_SESSION_IDS: Readonly<Record<string, string>> = {
  'w1:p1': '11111111-1111-4111-8111-111111111111',
  'w2:p1': '22222222-2222-4222-8222-222222222222',
  'w3:p1': '33333333-3333-4333-8333-333333333333',
  'w4:p1': '44444444-4444-4444-8444-444444444444',
  'w5:p1': '55555555-5555-4555-8555-555555555555',
};
"""

SEEDS = r"""const at = (minute: number) => `2026-09-28T06:${String(minute).padStart(2, '0')}:00.000Z`;
const say = (uuid: string, minute: number, text: string) =>
  line({ type: 'assistant', uuid, timestamp: at(minute), model: MODEL, content: [{ type: 'text', text }] });
const ask = (uuid: string, minute: number, content: unknown) => line({ type: 'user', uuid, timestamp: at(minute), content });
const tool = (uuid: string, minute: number, name: string, input: Record<string, unknown>, result: string, failed = false) => [
  line({ type: 'assistant', uuid: `${uuid}-use`, timestamp: at(minute), model: MODEL, content: [{ type: 'tool_use', id: `toolu_${uuid}`, name, input }] }),
  line({ type: 'user', uuid: `${uuid}-result`, timestamp: at(minute), content: [{ type: 'tool_result', tool_use_id: `toolu_${uuid}`, content: result, ...(failed ? { is_error: true } : {}) }] }),
];

const SEEDS: Readonly<Record<string, readonly string[]>> = {
  'w1:p1': [
    ask('d1-1', 10, 'the folder picker says "No subfolders here" even when the read failed. can you look?'),
    ...tool('d1-t1', 10, 'Bash', { command: 'rg -n "; true" src/lib' }, 'src/lib/herdr/client.ts:329:    ls -1p ... ; true'),
    ...tool('d1-t2', 10, 'Read', { file_path: 'src/lib/herdr/client.ts' }, '…'),
    ...tool('d1-t3', 11, 'Bash', { command: 'npm test -- directories' }, 'FAIL  src/lib/__tests__/directories.test.ts\n  1 failed, 12 passed', true),
    say('d1-2', 12, "Found it. `listDirectories` appends `; true`, so an unreadable path exits 0. An empty folder, a wrong path and a dropped connection all look the same.\n\nI'll split the error from the empty state and give the error a Retry."),
    ask('d1-3', 12, 'nice 🎯 ship it'),
    say('d1-4', 13, 'Before I write to `client.ts`: this changes what every caller of `listDirectories` sees on failure. Want me to go ahead?'),
  ],
  'w2:p1': [
    ask('d2-1', 19, 'the sign in button slides under the footer on small phones. can you fix it?\n/home/demo/.cache/herdrchat/uploads/pantry-login.png'),
    ...tool('d2-t1', 19, 'Read', { file_path: 'src/components/SignInForm.tsx' }, '…'),
    ...tool('d2-t2', 19, 'Grep', { pattern: 'position: fixed' }, 'src/components/Footer.css:4'),
    ...tool('d2-t3', 20, 'Read', { file_path: 'src/components/Footer.css' }, '…'),
    say('d2-2', 20, "I see it. The footer is `position: fixed` and the form never leaves room for it, so on a short screen **Sign in** ends up underneath.\n\nI'll reserve the footer's height at the bottom of the form and let the footer sit in the normal flow below 700px."),
  ],
  'w3:p1': [
    ask('d3-1', 25, 'add idempotency keys to the charge endpoint'),
    ...tool('d3-t1', 25, 'Read', { file_path: 'src/routes/charges.ts' }, '…'),
    ...tool('d3-t2', 26, 'Edit', { file_path: 'src/routes/charges.ts', old_string: 'a', new_string: 'b' }, 'The file has been updated.'),
  ],
  'w4:p1': [
    ask('d4-1', 5, 'summarise the release notes into three bullets'),
    say('d4-2', 5, '- Host keys are pinned on first contact and shown as `SHA256:…`\n- The transcript cursor no longer skips a message on a lossy decode\n- Blocked prompts disable their options while a reply is in flight'),
  ],
  'w5:p1': [
    ask('d5-1', 1, 'scratch pad, nothing running here'),
    say('d5-2', 1, 'Ready when you are.'),
  ],
};
"""


def replace_block(text: str, start: str, end_pattern: str, new: str) -> str:
    begin = text.index(start)
    end = re.compile(end_pattern, re.M).search(text, begin).end()
    return text[:begin] + new + text[end + 1:]


text = FIXTURES.read_text()
text = replace_block(text, 'export const DEMO_WORKSPACES', r'^\];$', WORKSPACES)
text = replace_block(text, 'export const DEMO_SESSION_IDS', r'^\};$', SESSIONS)
text = replace_block(text, 'const SEEDS', r'^\};$', SEEDS)
FIXTURES.write_text(text)

connections = CONNECTIONS.read_text()
CONNECTIONS.write_text(connections.replace("name: 'Demo',\n    host: 'demo.local',", "name: 'mac-studio',\n    host: 'demo.local',", 1))
print('Demo enriched. Undo: git checkout -- src/lib/demo/fixtures.ts src/state/connections.ts')
