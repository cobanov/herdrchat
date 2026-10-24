/**
 * Heads Up's list, read the way the mod reads it.
 *
 * Heads Up is a Claude Code mod (https://github.com/corydorning/heads-up-claude-mod)
 * that keeps one list per computer of what is waiting on the person: questions
 * Claude asked, follow-ups only they can do, tool calls that failed, and their
 * own notes. Every session running the mod shares it through Claude Code's
 * plugin store, a JSON object whose `items` key is the list.
 *
 * The file is someone else's, written by another program on its own schedule,
 * so everything here is defensive: an item this app does not understand is
 * left out of what it shows and left exactly as it was in what it writes.
 * The wording (the summary, when an item was raised, the reply's tag) is the
 * mod's own, so the phone and the terminal say the same thing.
 */
import { isConversationalAgent, type AgentInfo } from '../herdr/models';

export type HeadsUpKind = 'question' | 'followup' | 'failure' | 'note';

/** One item, as far as this app reads it. Fields it does not use stay in the raw object. */
export interface HeadsUpItem {
  id: string;
  kind: HeadsUpKind;
  text: string;
  detail: string | null;
  /** The first 8 characters of the Claude session id that raised it. */
  session: string;
  /** That session's full id; absent on items logged before the mod recorded it. */
  sessionId: string | null;
  /** The basename of that session's folder. */
  folder: string;
  createdAt: number;
  status: 'open' | 'done';
  doneAt: number | null;
  /** The person replied; the item waits for Claude to act on it and resolve it. */
  repliedAt: number | null;
  /** Questions only: Claude cannot continue until it is answered. */
  blocking: boolean;
}

/** The store file as read: every key kept, and the items this app understands. */
export interface HeadsUpFile {
  /** The whole object, unknown keys and unknown items included, for writing back. */
  raw: Record<string, unknown>;
  items: HeadsUpItem[];
}

/** The store's key for the list. */
export const ITEMS_KEY = 'items';

export const KIND_ORDER: readonly HeadsUpKind[] = ['question', 'followup', 'failure', 'note'];

export const KIND_LABEL: Readonly<Record<HeadsUpKind, readonly [string, string]>> = {
  question: ['question', 'questions'],
  followup: ['follow-up', 'follow-ups'],
  failure: ['failure', 'failures'],
  note: ['note', 'notes'],
};

const isKind = (value: unknown): value is HeadsUpKind => (KIND_ORDER as readonly unknown[]).includes(value);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const time = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** One raw item, or null when it is not one this app can show. */
export function parseItem(value: unknown): HeadsUpItem | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  const body = text(record.text);
  const createdAt = time(record.createdAt);
  if (id === null || id === '' || body === null || !isKind(record.kind) || createdAt === null) return null;
  const status = record.status === 'done' ? 'done' : record.status === 'open' ? 'open' : null;
  if (status === null) return null;
  const detail = text(record.detail);
  return {
    id,
    kind: record.kind,
    text: body,
    detail: detail === null || detail.trim() === '' ? null : detail,
    session: text(record.session) ?? '',
    sessionId: text(record.sessionId) || null,
    folder: text(record.folder) ?? '',
    createdAt,
    status,
    doneAt: time(record.doneAt),
    repliedAt: time(record.repliedAt),
    blocking: record.blocking === true,
  };
}

/**
 * The store file's text, or null when it is not a JSON object (a write caught
 * halfway, or not the mod's file at all), which the caller treats as a failed
 * read. A non-array `items`, or items that are not ones this app knows, read
 * as fewer items, never as an error.
 */
export function parseHeadsUpFile(json: string): HeadsUpFile | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const list = raw[ITEMS_KEY];
  const items = Array.isArray(list) ? list.map(parseItem).filter((item): item is HeadsUpItem => item !== null) : [];
  return { raw, items };
}

export function openItems(items: readonly HeadsUpItem[]): HeadsUpItem[] {
  return items.filter((item) => item.status === 'open');
}

export function counts(items: readonly HeadsUpItem[]): Record<HeadsUpKind, number> {
  const tally: Record<HeadsUpKind, number> = { question: 0, followup: 0, failure: 0, note: 0 };
  for (const item of openItems(items)) tally[item.kind] += 1;
  return tally;
}

/** Open questions Claude cannot go on without. */
export function blockingCount(items: readonly HeadsUpItem[]): number {
  return openItems(items).filter((item) => item.blocking).length;
}

/** "1 question · 2 follow-ups", kinds with none left out (the mod's `summary`). */
export function summary(items: readonly HeadsUpItem[]): string {
  const tally = counts(items);
  return KIND_ORDER.filter((kind) => tally[kind] > 0)
    .map((kind) => `${tally[kind]} ${KIND_LABEL[kind][tally[kind] === 1 ? 0 : 1]}`)
    .join(' · ');
}

/**
 * The bar's line in parts: the blocking segment (null when none blocks),
 * "N need(s) you", and the counts. Null when nothing is open, which hides it.
 */
export interface HeadsUpBarText {
  blocking: string | null;
  needYou: string;
  counts: string;
}

export function barText(items: readonly HeadsUpItem[]): HeadsUpBarText | null {
  const open = openItems(items);
  if (open.length === 0) return null;
  const blocking = blockingCount(open);
  return {
    blocking: blocking > 0 ? `${blocking} blocking` : null,
    needYou: `${open.length} need${open.length === 1 ? 's' : ''} you`,
    counts: summary(open),
  };
}

/** The bar's line as one string: `⚑ 2 blocking · 5 need you · 2 questions · …`. */
export function barLine(bar: HeadsUpBarText): string {
  return ['⚑', [bar.blocking, bar.needYou, bar.counts].filter((part): part is string => part !== null).join(' · ')].join(' ');
}

/** Blocking first, then newest first. */
export function byUrgency(a: HeadsUpItem, b: HeadsUpItem): number {
  return Number(b.blocking) - Number(a.blocking) || b.createdAt - a.createdAt;
}

/** The items of each kind, in the mod's order, empty kinds left out. */
export function groups<T extends { item: HeadsUpItem }>(entries: readonly T[]): { kind: HeadsUpKind; entries: T[] }[] {
  return KIND_ORDER.flatMap((kind) => {
    const group = entries.filter((entry) => entry.item.kind === kind).sort((a, b) => byUrgency(a.item, b.item));
    return group.length === 0 ? [] : [{ kind, entries: group }];
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * When an item was raised, in local time and the mod's words: "Today, 9:05 AM",
 * "Yesterday, 9:05 AM", else "Oct 4, 9:05 AM", with the year when it is not this year.
 */
export function askedAt(createdAt: number, now: number): string {
  const at = new Date(createdAt);
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const hours = at.getHours() % 12 === 0 ? 12 : at.getHours() % 12;
  const clock = `${hours}:${String(at.getMinutes()).padStart(2, '0')} ${at.getHours() < 12 ? 'AM' : 'PM'}`;
  const year = at.getFullYear() === today.getFullYear() ? '' : `, ${at.getFullYear()}`;
  const day = sameDay(at, today) ? 'Today' : sameDay(at, yesterday) ? 'Yesterday' : `${MONTHS[at.getMonth()] ?? ''} ${at.getDate()}${year}`;
  return `${day}, ${clock}`;
}

/**
 * The tag a reply starts with. The mod tells Claude that a message beginning
 * with it is the person's answer to that item: act on it, then resolve the id.
 */
export function replyTag(item: Pick<HeadsUpItem, 'id' | 'text'>): string {
  return `Re: "${item.text}" [${item.id}]`;
}

/** The whole reply sent to the session that asked. */
export function replyPrompt(item: Pick<HeadsUpItem, 'id' | 'text'>, reply: string): string {
  return `${replyTag(item)}\n${reply.trim()}`;
}

/** What Answer puts in a chat's composer: the tag and a new line, for the reply to follow. */
export function answerDraft(item: Pick<HeadsUpItem, 'id' | 'text'>): string {
  return `${replyTag(item)}\n`;
}

/** True for the kinds that are answered rather than closed. */
export function isAnswerable(item: Pick<HeadsUpItem, 'kind'>): boolean {
  return item.kind === 'question' || item.kind === 'followup';
}

/**
 * Whether an item was raised by the Claude session `sessionId`: by its full
 * id, or for an item logged before the mod kept one, by the short id as the
 * session id's start. An empty short id matches nothing.
 */
export function raisedBy(item: Pick<HeadsUpItem, 'session' | 'sessionId'>, sessionId: string): boolean {
  if (sessionId === '') return false;
  if (item.sessionId !== null) return item.sessionId === sessionId;
  return item.session !== '' && sessionId.startsWith(item.session);
}

/** Where a chat lives, for finding the one that raised an item. */
export interface HeadsUpChat {
  sessionId: string;
  workspaceId: string;
  paneId: string;
  /**
   * The only agent in its workspace, whose chat is the workspace's own (opened
   * without a pane, as the list opens it); with several, each has its own.
   */
  soleAgent: boolean;
}

/** The listed chat whose Claude session raised the item, or null when none is running here. */
export function chatFor<T extends HeadsUpChat>(item: Pick<HeadsUpItem, 'session' | 'sessionId'>, chats: readonly T[]): T | null {
  return chats.find((chat) => raisedBy(item, chat.sessionId)) ?? null;
}

/**
 * The open questions and follow-ups a chat's own sessions raised and nobody
 * has replied to yet, the most urgent first. One already replied to waits
 * for Claude, and the mod offers it no Answer either.
 */
export function chatItems(items: readonly HeadsUpItem[], sessionIds: readonly string[]): HeadsUpItem[] {
  return openItems(items)
    .filter((item) => isAnswerable(item) && item.repliedAt === null && sessionIds.some((sessionId) => raisedBy(item, sessionId)))
    .sort(byUrgency);
}

/** What the in-chat bar leads an item with. */
export function chatItemLabel(item: Pick<HeadsUpItem, 'kind'>): string {
  return item.kind === 'question' ? 'Question for you' : 'Follow-up';
}

// MARK: - Changes, on the raw object

/**
 * A change to the store: given the object as it is on the host, the object to
 * write, or null when there is nothing to do (the item is gone, or already in
 * the state asked for). Works on the raw object so every key and every field
 * this app does not know survives the write.
 */
export type HeadsUpChange = (raw: Record<string, unknown>) => Record<string, unknown> | null;

function changeItem(id: string, update: (item: Record<string, unknown>) => Record<string, unknown> | null): HeadsUpChange {
  return (raw) => {
    const list = raw[ITEMS_KEY];
    if (!Array.isArray(list)) return null;
    let changed = false;
    const next = list.map((entry: unknown) => {
      if (changed || typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry;
      const record = entry as Record<string, unknown>;
      if (record.id !== id) return entry;
      const updated = update(record);
      if (updated === null) return entry;
      changed = true;
      return updated;
    });
    return changed ? { ...raw, [ITEMS_KEY]: next } : null;
  };
}

/** Resolve: done, as the mod's `resolve` marks it. Nothing for an item already done. */
export function resolveItem(id: string, now: number): HeadsUpChange {
  return changeItem(id, (item) => (item.status === 'open' ? { ...item, status: 'done', doneAt: now } : null));
}

/** A reply went to the session: the item stays open, waiting for Claude. */
export function markReplied(id: string, now: number): HeadsUpChange {
  return changeItem(id, (item) =>
    item.status === 'open' && (item.repliedAt === undefined || item.repliedAt === null) ? { ...item, repliedAt: now } : null
  );
}

/**
 * "Reply again", or a reply that did not go: the item takes a reply once
 * more. With `onlyAt`, only a mark made at that time comes off, so undoing a
 * reply that did not go never clears one the terminal or another phone made.
 */
export function clearReplied(id: string, onlyAt?: number): HeadsUpChange {
  return changeItem(id, (item) => {
    if (!('repliedAt' in item)) return null;
    if (onlyAt !== undefined && item.repliedAt !== onlyAt) return null;
    const { repliedAt: _cleared, ...rest } = item;
    return rest;
  });
}

/** The object as the file's text. */
export function serializeHeadsUp(raw: Record<string, unknown>): string {
  return JSON.stringify(raw);
}

/**
 * The chats an item can lead to: every Claude agent on the host that has
 * reported its session id. Other agents never raise Heads Up items.
 */
export function headsUpChats(agents: readonly AgentInfo[]): HeadsUpChat[] {
  return agents.flatMap((agent) => {
    const sessionId = agent.agentSession?.value ?? null;
    const soleAgent = agents.filter((other) => other.workspaceId === agent.workspaceId && isConversationalAgent(other)).length <= 1;
    return agent.agent === 'claude' && sessionId !== null && sessionId !== ''
      ? [{ sessionId, workspaceId: agent.workspaceId, paneId: agent.paneId, soleAgent }]
      : [];
  });
}
