import { chatKey } from '@/lib/chatKey';
import { draftKey, useDrafts, visibleDraft } from '../drafts';

// herdr reuses workspace slots. A draft typed to one conversation must not
// appear in the composer of the next one in the same slot (#113).
it('shows a draft only to the conversation it was typed for', () => {
  const draft = { text: 'run the tests', sessionSig: 'claude:a' };
  expect(visibleDraft(draft, 'claude:a')).toBe('run the tests');
  expect(visibleDraft(draft, null)).toBe('run the tests');
  expect(visibleDraft(draft, 'claude:b')).toBe('');
  expect(visibleDraft({ text: 'typed early', sessionSig: null }, 'claude:b')).toBe('typed early');
  expect(visibleDraft(undefined, 'claude:a')).toBe('');
});

it('keeps drafts per host and chat, and drops an emptied one', () => {
  const { save } = useDrafts.getState();
  save(draftKey('host-a', 'w1'), 'first', null);
  save(draftKey('host-b', 'w1'), 'second', null);
  expect(useDrafts.getState().drafts[draftKey('host-a', 'w1')]?.text).toBe('first');
  expect(useDrafts.getState().drafts[draftKey('host-b', 'w1')]?.text).toBe('second');
  save(draftKey('host-a', 'w1'), '', null);
  expect(useDrafts.getState().drafts[draftKey('host-a', 'w1')]).toBeUndefined();
});

// Text typed to one agent of a workspace must not appear in its sibling's
// composer, nor in the workspace chat's.
it('keeps a draft per agent chat, apart from the workspace chat', () => {
  const { save } = useDrafts.getState();
  const workspace = draftKey('host-a', chatKey({ workspaceId: 'w6' }));
  const p1 = draftKey('host-a', chatKey({ workspaceId: 'w6', paneId: 'w6:p1' }));
  const p2 = draftKey('host-a', chatKey({ workspaceId: 'w6', paneId: 'w6:p2' }));
  expect(workspace).toBe(draftKey('host-a', 'w6'));
  save(p2, 'fix the button', null);
  expect(useDrafts.getState().drafts[p2]?.text).toBe('fix the button');
  expect(useDrafts.getState().drafts[p1]).toBeUndefined();
  expect(useDrafts.getState().drafts[workspace]).toBeUndefined();
});
