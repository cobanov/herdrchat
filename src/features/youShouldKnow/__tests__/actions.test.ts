import { DemoHost } from '@/lib/demo/host';
import { DEMO_SESSION_IDS } from '@/lib/demo/fixtures';
import { DEMO_YSK_ELSEWHERE, DEMO_YSK_LINE } from '@/lib/demo/scenarios';
import { HerdrClient } from '@/lib/herdr/client';
import { noteDraft } from '@/lib/youShouldKnow/draft';
import type { Note } from '@/lib/youShouldKnow/notes';
import { draftKey, useDrafts } from '@/state/drafts';
import { checkYouShouldKnow, notesOf, resetYouShouldKnowSession } from '@/state/youShouldKnow';
import { discussHere, discussInChat, dismissAbout, goToNoteChat, knowAbout, learnMoreAbout } from '../actions';

const T0 = Date.parse('2026-10-24T12:00:00Z');
let mockClient: HerdrClient;
jest.mock('@/state/connections', () => ({
  clientFor: () => mockClient,
  useConnections: { getState: () => ({ connections: [{ id: 'demo', name: 'Demo' }] }) },
}));
const mockOpenChat = jest.fn();
jest.mock('@/features/chats/navigation', () => ({ openChat: (...args: unknown[]) => mockOpenChat(...args) }));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

const NOTES = DEMO_SESSION_IDS['w2:p1']!;
const NOTES_CHAT = { sessionId: NOTES, workspaceId: 'w2', paneId: 'w2:p1', soleAgent: true, title: 'Release notes summary' };

async function setUp() {
  resetYouShouldKnowSession();
  useDrafts.setState({ drafts: {} });
  const host = new DemoHost(() => T0);
  host.setUpNotes('w2:p1');
  mockClient = new HerdrClient(host);
  await checkYouShouldKnow('demo', host, { now: T0 });
  const note = (sessionId: string): Note | undefined => notesOf('demo').file!.notes.find((one) => one.sessionId === sessionId);
  const onHost = () => JSON.parse(host.yskText()!) as { sessions: Record<string, unknown>[]; known: string[] };
  return { host, note, onHost };
}

it('Learn more shows the explanation, on the host too', async () => {
  const { note, onHost } = await setUp();
  await expect(learnMoreAbout('demo', note(NOTES)!)).resolves.toBeNull();
  expect(note(NOTES)?.view.kind).toBe('explained');
  expect(onHost().sessions[0]?.view).toMatchObject({ kind: 'explained', iteration: 1 });
});

it('Knew this already and Dismiss take the note away, only the first learning from it', async () => {
  const { note, onHost } = await setUp();
  await expect(knowAbout('demo', note(NOTES)!)).resolves.toBeNull();
  await expect(dismissAbout('demo', note(DEMO_YSK_ELSEWHERE)!)).resolves.toBeNull();
  expect(notesOf('demo').file?.notes).toEqual([]);
  expect(onHost().known).toEqual([DEMO_YSK_LINE]);
});

it('says so when the host cannot be reached', async () => {
  const { host, note } = await setUp();
  jest.spyOn(host, 'exec').mockResolvedValue({ ok: false, code: 'timeout', message: 'no' });
  await expect(dismissAbout('demo', note(NOTES)!)).resolves.toMatch(/Couldn't update the note on Demo/);
});

it('Discuss in chat, in the chat, fills the composer with the draft, then lets the note go', async () => {
  const { note, onHost } = await setUp();
  const fill = jest.fn();
  const asked = note(NOTES)!;
  await expect(discussHere('demo', asked, fill)).resolves.toBeNull();
  expect(fill).toHaveBeenCalledWith(noteDraft(asked));
  expect(note(NOTES)).toBeUndefined();
  expect(onHost().known).toEqual([DEMO_YSK_LINE]);
});

it('Discuss in chat, from the screen, leaves the draft in that chat and opens it', async () => {
  const { note } = await setUp();
  const asked = note(NOTES)!;
  await expect(discussInChat('demo', asked, NOTES_CHAT)).resolves.toBeNull();
  expect(useDrafts.getState().drafts[draftKey('demo', 'w2')]).toEqual({ text: noteDraft(asked), sessionSig: null });
  expect(mockOpenChat).toHaveBeenLastCalledWith('demo', 'w2', 'Release notes summary', undefined);
  expect(note(NOTES)).toBeUndefined();
});

it('opens a lone agent’s chat as the workspace’s, and one of several by its pane', () => {
  goToNoteChat('demo', NOTES_CHAT);
  expect(mockOpenChat).toHaveBeenLastCalledWith('demo', 'w2', 'Release notes summary', undefined);
  goToNoteChat('demo', { ...NOTES_CHAT, workspaceId: 'w6', paneId: 'w6:p2', soleAgent: false });
  expect(mockOpenChat).toHaveBeenLastCalledWith('demo', 'w6', 'Release notes summary', 'w6:p2');
});
