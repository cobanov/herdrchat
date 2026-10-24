import type { AgentInfo } from '../herdr/models';
import {
  answerDraft,
  askedAt,
  barLine,
  barText,
  chatFor,
  chatItems,
  clearReplied,
  groups,
  headsUpChats,
  markReplied,
  parseHeadsUpFile,
  raisedBy,
  replyPrompt,
  resolveItem,
  summary,
  type HeadsUpItem,
} from '../headsup/items';

const SESSION = '11111111-1111-4111-8111-111111111111';

function item(overrides: Partial<HeadsUpItem> = {}): HeadsUpItem {
  return {
    id: 'a1',
    kind: 'question',
    text: 'Ship it?',
    detail: null,
    session: SESSION.slice(0, 8),
    sessionId: SESSION,
    folder: 'notes',
    createdAt: 1_000,
    status: 'open',
    doneAt: null,
    repliedAt: null,
    blocking: false,
    ...overrides,
  };
}

/** One raw item as the mod writes it. */
const raw = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1', kind: 'question', text: 'Ship it?', session: '11111111', sessionId: SESSION,
  folder: 'notes', createdAt: 1_000, status: 'open', ...overrides,
});

describe('parseHeadsUpFile', () => {
  it('reads the mod’s items, every field it uses', () => {
    const file = parseHeadsUpFile(JSON.stringify({
      items: [raw({ blocking: true, detail: 'Two lines.', repliedAt: 5, link: 'claude://x' }), raw({ id: 'b2', kind: 'note', status: 'done', doneAt: 9 })],
    }));
    expect(file?.items).toEqual([
      item({ blocking: true, detail: 'Two lines.', repliedAt: 5 }),
      item({ id: 'b2', kind: 'note', status: 'done', doneAt: 9 }),
    ]);
  });

  it('leaves out items of a kind it does not know, and ones missing what it needs, and keeps them in raw', () => {
    const items = [raw({ kind: 'reminder' }), raw({ id: undefined }), raw({ text: 3 }), raw({ status: 'snoozed' }), raw({ createdAt: 'yesterday' }), 'junk', null, raw({ id: 'ok' })];
    const file = parseHeadsUpFile(JSON.stringify({ items, other: { kept: true } }));
    expect(file?.items.map((one) => one.id)).toEqual(['ok']);
    expect(file?.raw.items).toHaveLength(items.length);
    expect(file?.raw.other).toEqual({ kept: true });
  });

  it('reads an old item with no full session id by its short one', () => {
    const file = parseHeadsUpFile(JSON.stringify({ items: [raw({ sessionId: undefined })] }));
    expect(file?.items[0]?.sessionId).toBeNull();
    expect(file?.items[0]?.session).toBe('11111111');
  });

  it('reads a non-array items, or none, as no items', () => {
    expect(parseHeadsUpFile('{"items": {"a": 1}}')?.items).toEqual([]);
    expect(parseHeadsUpFile('{}')?.items).toEqual([]);
  });

  it.each(['', '{"items": [', '[]', 'null', '"text"'])('reads %j as no file at all', (text) => {
    expect(parseHeadsUpFile(text)).toBeNull();
  });
});

describe('the summary', () => {
  const open = [
    item({ id: '1', blocking: true }),
    item({ id: '2', blocking: true }),
    item({ id: '3', kind: 'followup' }),
    item({ id: '4', kind: 'failure' }),
    item({ id: '5', kind: 'note' }),
    item({ id: '6', kind: 'note', status: 'done' }),
  ];

  it('counts open items by kind in the mod’s order, kinds with none left out', () => {
    expect(summary(open)).toBe('2 questions · 1 follow-up · 1 failure · 1 note');
    expect(summary([item({ kind: 'followup' }), item({ kind: 'followup' })])).toBe('2 follow-ups');
    expect(summary([])).toBe('');
  });

  it('leads the bar with what blocks, then how many need you', () => {
    const bar = barText(open);
    expect(bar).toEqual({ blocking: '2 blocking', needYou: '5 need you', counts: '2 questions · 1 follow-up · 1 failure · 1 note' });
    expect(barLine(bar!)).toBe('⚑ 2 blocking · 5 need you · 2 questions · 1 follow-up · 1 failure · 1 note');
    expect(barLine(barText([item({ kind: 'note' })])!)).toBe('⚑ 1 needs you · 1 note');
  });

  it('has no bar when nothing is open', () => {
    expect(barText([item({ status: 'done' })])).toBeNull();
    expect(barText([])).toBeNull();
  });
});

describe('groups', () => {
  it('orders kinds as the mod does, and within one blocking first, then newest', () => {
    const entries = [
      item({ id: 'note', kind: 'note', createdAt: 9 }),
      item({ id: 'old', createdAt: 1 }),
      item({ id: 'new', createdAt: 5 }),
      item({ id: 'stuck', createdAt: 2, blocking: true }),
      item({ id: 'fail', kind: 'failure' }),
      item({ id: 'todo', kind: 'followup' }),
    ].map((one) => ({ item: one }));
    expect(groups(entries).map((group) => [group.kind, group.entries.map((entry) => entry.item.id)])).toEqual([
      ['question', ['stuck', 'new', 'old']],
      ['followup', ['todo']],
      ['failure', ['fail']],
      ['note', ['note']],
    ]);
  });
});

describe('askedAt', () => {
  const now = new Date(2026, 9, 24, 18, 0).getTime();

  it('says today and yesterday by name, with a 12-hour time', () => {
    expect(askedAt(new Date(2026, 9, 24, 17, 42).getTime(), now)).toBe('Today, 5:42 PM');
    expect(askedAt(new Date(2026, 9, 24, 0, 5).getTime(), now)).toBe('Today, 12:05 AM');
    expect(askedAt(new Date(2026, 9, 23, 9, 5).getTime(), now)).toBe('Yesterday, 9:05 AM');
  });

  it('gives an older day its date, and the year only when it is another', () => {
    expect(askedAt(new Date(2026, 9, 4, 12, 30).getTime(), now)).toBe('Oct 4, 12:30 PM');
    expect(askedAt(new Date(2025, 11, 31, 23, 59).getTime(), now)).toBe('Dec 31, 2025, 11:59 PM');
  });
});

describe('replies', () => {
  it('tags a reply as the mod does, so Claude can resolve the item after acting on it', () => {
    expect(replyPrompt(item({ id: 'mzx91', text: 'Ship it?' }), '  Yes, ship it. ')).toBe('Re: "Ship it?" [mzx91]\nYes, ship it.');
    expect(answerDraft(item({ id: 'mzx91', text: 'Ship it?' }))).toBe('Re: "Ship it?" [mzx91]\n');
  });
});

describe('which chat raised an item', () => {
  const chats = [
    { sessionId: '22222222-2222-4222-8222-222222222222', workspaceId: 'w2', paneId: 'w2:p1', soleAgent: true },
    { sessionId: SESSION, workspaceId: 'w1', paneId: 'w1:p1', soleAgent: true },
  ];

  it('is found by the full session id', () => {
    expect(chatFor(item(), chats)?.workspaceId).toBe('w1');
    expect(raisedBy(item(), SESSION)).toBe(true);
    // The full id decides when it is there, even if the short one would match.
    expect(raisedBy(item({ sessionId: '11111111-0000-4000-8000-000000000000' }), SESSION)).toBe(false);
  });

  it('is found by the short id for an item logged before the full one was kept', () => {
    expect(chatFor(item({ sessionId: null, session: '22222222' }), chats)?.workspaceId).toBe('w2');
  });

  it('is none when no listed chat runs that session', () => {
    expect(chatFor(item({ sessionId: '9c1e44aa-0b7d-4e6f-9a21-3c5d7e8f9a0b', session: '9c1e44aa' }), chats)).toBeNull();
    expect(chatFor(item({ sessionId: null, session: '' }), chats)).toBeNull();
    expect(raisedBy(item(), '')).toBe(false);
  });

  it('lists a chat’s own open questions and follow-ups, the blocking one first', () => {
    const items = [
      item({ id: 'q', createdAt: 5 }),
      item({ id: 'stuck', createdAt: 1, blocking: true }),
      item({ id: 'f', kind: 'followup', createdAt: 3 }),
      item({ id: 'fail', kind: 'failure' }),
      item({ id: 'note', kind: 'note' }),
      item({ id: 'done', status: 'done' }),
      item({ id: 'other', sessionId: '22222222-2222-4222-8222-222222222222' }),
    ];
    expect(chatItems(items, [SESSION]).map((one) => one.id)).toEqual(['stuck', 'q', 'f']);
    expect(chatItems(items, [])).toEqual([]);
  });

  it('leaves out a question already replied to: it waits for Claude, and Answer would send it twice', () => {
    const items = [item({ id: 'q' }), item({ id: 'replied', repliedAt: 9 })];
    expect(chatItems(items, [SESSION]).map((one) => one.id)).toEqual(['q']);
  });

  it('takes Claude agents that reported a session, and says whether each is alone in its workspace', () => {
    const agent = (paneId: string, overrides: Partial<AgentInfo>): AgentInfo => ({
      agent: 'claude', agentStatus: 'idle', cwd: '/x', foregroundCwd: null, focused: false, paneId, tabId: 't',
      terminalId: null, workspaceId: paneId.split(':')[0]!, agentSession: { agent: 'claude', kind: 'id', source: 'herdr:claude', value: `s-${paneId}` },
      stateChangeSeq: null, completionSeq: null, ...overrides,
    } as AgentInfo);
    expect(headsUpChats([
      agent('w1:p1', {}),
      agent('w2:p1', {}),
      agent('w2:p2', { agent: 'codex' }),
      agent('w3:p1', { agentSession: null }),
      agent('w4:p1', { agent: 'omp' }),
    ])).toEqual([
      { sessionId: 's-w1:p1', workspaceId: 'w1', paneId: 'w1:p1', soleAgent: true },
      { sessionId: 's-w2:p1', workspaceId: 'w2', paneId: 'w2:p1', soleAgent: false },
    ]);
  });
});

describe('changes', () => {
  const file = () => ({
    schema: 2,
    items: [
      { ...raw(), extra: { nested: [1, 2] } },
      raw({ id: 'z9', kind: 'reminder' }),
      raw({ id: 'n1', kind: 'note' }),
    ],
  });

  it('resolves one item, and keeps every other key, item and field as it was', () => {
    const next = resolveItem('a1', 77)(file());
    expect(next).toEqual({
      schema: 2,
      items: [{ ...raw(), extra: { nested: [1, 2] }, status: 'done', doneAt: 77 }, raw({ id: 'z9', kind: 'reminder' }), raw({ id: 'n1', kind: 'note' })],
    });
  });

  it('marks a reply sent, and takes it back, keeping the rest', () => {
    const replied = markReplied('a1', 50)(file());
    expect((replied?.items as Record<string, unknown>[])[0]).toEqual({ ...raw(), extra: { nested: [1, 2] }, repliedAt: 50 });
    const reopened = clearReplied('a1')(replied!);
    expect(reopened).toEqual(file());
    expect(Object.keys((reopened?.items as Record<string, unknown>[])[0]!)).not.toContain('repliedAt');
  });

  it('changes nothing for an item gone, already done, or already replied', () => {
    expect(resolveItem('gone', 1)(file())).toBeNull();
    expect(resolveItem('a1', 1)({ items: [raw({ status: 'done', doneAt: 3 })] })).toBeNull();
    expect(markReplied('a1', 1)({ items: [raw({ repliedAt: 3 })] })).toBeNull();
    expect(clearReplied('a1')(file())).toBeNull();
    expect(resolveItem('a1', 1)({ items: 'not a list' })).toBeNull();
  });

  it('marks an item whose repliedAt the mod left as null', () => {
    expect((markReplied('a1', 4)({ items: [raw({ repliedAt: null })] })?.items as Record<string, unknown>[])[0]).toMatchObject({ repliedAt: 4 });
  });

  it('takes back only its own mark when asked to, never one made elsewhere', () => {
    const replied = markReplied('a1', 50)(file())!;
    expect(clearReplied('a1', 49)(replied)).toBeNull();
    expect(clearReplied('a1', 50)(replied)).toEqual(file());
  });
});
