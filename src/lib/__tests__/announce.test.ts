import { lastReplyId, threadAnnouncement, type ThreadMoment } from '../announce';
import type { ChatMessage } from '../transcript/message';

const calm: ThreadMoment = { blocked: null, lastReply: 'a1' };

const message = (id: string, role: ChatMessage['role'], segments: ChatMessage['segments'], isSidechain = false): ChatMessage =>
  ({ id, role, segments, timestamp: null, agentLabel: null, isSidechain });

describe('what a screen reader hears in an open chat', () => {
  it('says nothing on opening, since the screen is read then', () => {
    expect(threadAnnouncement(null, { blocked: 'Proceed?', lastReply: 'a1' }, 'Codex')).toBeNull();
  });

  it('says the agent needs you, with its question, once it stops to ask', () => {
    expect(threadAnnouncement(calm, { ...calm, blocked: 'Do you want to proceed?' }, 'Claude Code'))
      .toBe('Claude Code needs you: Do you want to proceed?');
    expect(threadAnnouncement(calm, { ...calm, blocked: '' }, 'Grok')).toBe('Grok needs you.');
    // Still waiting on the next poll: said once.
    expect(threadAnnouncement({ ...calm, blocked: 'Proceed?' }, { ...calm, blocked: 'Proceed?' }, 'Grok')).toBeNull();
  });

  it('says the agent replied when a new reply lands, and not when nothing changed', () => {
    expect(threadAnnouncement(calm, { ...calm, lastReply: 'a2' }, 'Codex')).toBe('Codex replied.');
    expect(threadAnnouncement(calm, calm, 'Codex')).toBeNull();
  });

  it('counts a reply only when it says something, in the main conversation', () => {
    const messages = [
      message('a1', 'assistant', [{ kind: 'text', text: 'Done.' }]),
      message('u1', 'user', [{ kind: 'text', text: 'and now?' }]),
      message('a2', 'assistant', [{ kind: 'toolUse', name: 'Bash', input: null, id: 't1' }]),
      message('s1', 'assistant', [{ kind: 'text', text: 'subagent' }], true),
    ];
    expect(lastReplyId(messages)).toBe('a1');
    expect(lastReplyId([])).toBeNull();
  });
});
