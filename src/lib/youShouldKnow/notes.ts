/**
 * "You should know", read the way Claude Code's terminal reads it.
 *
 * "You should know" is a plugin built into Claude Code (off by default;
 * `/plugin enable cc-plugin-you-should-know@builtin`). While Claude works, a
 * side agent looks at the conversation now and then and may offer the person
 * one note, which the terminal shows above the prompt box as
 * `✦ Heads up · <one sentence>`, with Learn more, Knew this already and
 * Dismiss. Every Claude Code session on the computer keeps its notes in one
 * file, the plugin's store: a JSON object whose `sessions` key holds a row per
 * Claude session, each with the note it is showing, if any (its `view`).
 *
 * The file is Claude Code's, written on its own schedule, so everything here
 * is defensive: a row this app does not understand is left out of what it
 * shows and left exactly as it was in what it writes. The terminal reads the
 * file at every render and checks a view's kind and `shownAt` before acting
 * on a key, so the changes below are the ones its own keys make, and the two
 * never fight.
 */
import { chatTitle } from '../chatTitle';
import { isConversationalAgent, sendTarget, type AgentInfo, type Workspace } from '../herdr/models';

/** The two tags a note can carry, in the plugin's words. */
export const YOU_SHOULD_KNOW = 'You should know';
export const HEADS_UP = 'Heads up';
export type NoteTag = typeof YOU_SHOULD_KNOW | typeof HEADS_UP;

/** The plugin's own test: anything else reads as "You should know". */
const HEADS_UP_TAG = /^\W*heads[\s-]*up\W*$/i;

export function noteTag(tag: unknown): NoteTag {
  return typeof tag === 'string' && HEADS_UP_TAG.test(tag) ? HEADS_UP : YOU_SHOULD_KNOW;
}

/** The store's keys this app reads or writes. Every other key is left alone. */
export const SESSIONS_KEY = 'sessions';
export const KNOWN_KEY = 'known';
/** The terminal's back-off counters, reset when the person answers a note. */
export const COUNTER_KEYS = ['typedPastInARow', 'looksToSkip'] as const;
/** How many lines `known` keeps, as the plugin keeps it. */
export const KNOWN_MAX = 50;

/**
 * What a session's row is showing, of the views that show anything on a
 * phone. The others (`explaining` while the terminal writes an explanation,
 * `making` a learning page, `asked` its feedback row, `failed`, `off`) and a
 * row with no view show nothing.
 */
export type NoteView =
  /** Offered. `explanation` is null when the side agent left it out: only the terminal can write one then. */
  | { kind: 'offer'; line: string; explanation: string | null; shownAt: number }
  /** Learn more was pressed: the explanation is showing. */
  | { kind: 'explained'; line: string; text: string; shownAt: number }
  /** A learning page the terminal made, published at `url`. */
  | { kind: 'ready'; line: string; url: string; shownAt: number };

/** One note: a session's row with a view that shows. */
export interface Note {
  /** The full Claude session id the row is for: the chat's identity here. */
  sessionId: string;
  tag: NoteTag;
  view: NoteView;
}

/** The store file as read: every key kept, and the notes this app can show. */
export interface YskFile {
  /** The whole object, unknown keys and unknown rows included, for writing back. */
  raw: Record<string, unknown>;
  notes: Note[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
const time = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** A learning page's address, only when it is a web address a browser should open. */
const WEB_URL = /^https?:\/\/\S+$/i;

/** A row's view, or null when it is none that shows (or not one this app knows). */
export function parseView(value: unknown): NoteView | null {
  if (!isRecord(value)) return null;
  const line = text(value.line);
  const shownAt = time(value.shownAt);
  if (line === null || shownAt === null) return null;
  switch (value.kind) {
    case 'offer':
      return { kind: 'offer', line, explanation: text(value.explanation), shownAt };
    case 'explained': {
      const body = text(value.text);
      return body === null ? null : { kind: 'explained', line, text: body, shownAt };
    }
    case 'ready': {
      const url = text(value.url)?.trim() ?? null;
      return url === null || !WEB_URL.test(url) ? null : { kind: 'ready', line, url, shownAt };
    }
    default:
      return null;
  }
}

/** One raw row, or null when it shows nothing. */
export function parseNote(value: unknown): Note | null {
  if (!isRecord(value)) return null;
  const sessionId = text(value.id);
  if (sessionId === null) return null;
  const view = parseView(value.view);
  return view === null ? null : { sessionId, tag: noteTag(value.tag), view };
}

/**
 * The store file's text, or null when it is not a JSON object (a write caught
 * halfway, or not the plugin's file at all), which the caller treats as a
 * failed read. A `sessions` that is not a list, or rows this app does not
 * know, read as fewer notes, never as an error.
 */
export function parseYskFile(json: string): YskFile | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const rows = value[SESSIONS_KEY];
  const notes = Array.isArray(rows) ? rows.map(parseNote).filter((note): note is Note => note !== null) : [];
  return { raw: value, notes };
}

/** The object as the file's text. */
export function serializeYsk(raw: Record<string, unknown>): string {
  return JSON.stringify(raw);
}

/** Newest first, by when the terminal showed it. */
export function byNewest(a: Pick<Note, 'view'>, b: Pick<Note, 'view'>): number {
  return b.view.shownAt - a.view.shownAt;
}

/** A note's head as the terminal draws it: `✦ Heads up · <line>`. */
export function noteHead(note: Pick<Note, 'tag' | 'view'>): string {
  return `✦ ${note.tag} · ${note.view.line}`;
}

/** The explanation a note carries, if any: an offer's, or the one showing. */
export function noteExplanation(note: Pick<Note, 'view'>): string | null {
  const { view } = note;
  return view.kind === 'offer' ? view.explanation : view.kind === 'explained' ? view.text : null;
}

/** "3 notes for you". */
export function notesForYou(count: number): string {
  return `${count} ${count === 1 ? 'note' : 'notes'} for you`;
}

/**
 * What the chats' bar says: the one note as the terminal shows it, or how
 * many there are. Null with none, which hides it.
 */
export type NotesBarText = { kind: 'one'; note: Note } | { kind: 'many'; count: number };

export function notesBarText(notes: readonly Note[]): NotesBarText | null {
  const [first] = notes;
  if (first === undefined) return null;
  return notes.length === 1 ? { kind: 'one', note: first } : { kind: 'many', count: notes.length };
}

/** The bar's line as one string, for its accessibility label. */
export function notesBarLine(bar: NotesBarText): string {
  return bar.kind === 'one' ? noteHead(bar.note) : `✦ ${notesForYou(bar.count)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * When a note was raised, in local time: "Today, 9:05 AM", "Yesterday,
 * 9:05 AM", else "Oct 4, 9:05 AM", with the year when it is not this year.
 */
export function askedAt(at: number, now: number): string {
  const when = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const hours = when.getHours() % 12 === 0 ? 12 : when.getHours() % 12;
  const clock = `${hours}:${String(when.getMinutes()).padStart(2, '0')} ${when.getHours() < 12 ? 'AM' : 'PM'}`;
  const year = when.getFullYear() === today.getFullYear() ? '' : `, ${when.getFullYear()}`;
  const day = sameDay(when, today) ? 'Today' : sameDay(when, yesterday) ? 'Yesterday' : `${MONTHS[when.getMonth()] ?? ''} ${when.getDate()}${year}`;
  return `${day}, ${clock}`;
}

// MARK: - Chats

/** A listed chat a note can belong to. */
export interface NoteChat {
  /** The Claude session the chat runs: a note is this chat's when its row's id is this, exactly. */
  sessionId: string;
  workspaceId: string;
  paneId: string;
  /**
   * The only agent in its workspace, whose chat is the workspace's own (opened
   * without a pane, as the list opens it); with several, each has its own.
   */
  soleAgent: boolean;
  /** What the chat is called, as its row calls it. */
  title: string;
}

/**
 * The chats a note can lead to: every Claude agent on the host that has
 * reported its session id. Other agents never have "You should know".
 */
export function noteChats(agents: readonly AgentInfo[], workspaces: readonly Workspace[] | null): NoteChat[] {
  return agents.flatMap((agent) => {
    const sessionId = agent.agentSession?.value ?? null;
    if (agent.agent !== 'claude' || sessionId === null || sessionId === '') return [];
    const soleAgent = agents.filter((other) => other.workspaceId === agent.workspaceId && isConversationalAgent(other)).length <= 1;
    const workspace = workspaces?.find((candidate) => candidate.workspaceId === agent.workspaceId);
    const title = chatTitle({
      sessionTitle: agent.title,
      agentName: agent.name,
      workspaceLabel: workspace?.label ?? null,
      workspaceId: agent.workspaceId,
    });
    return [{ sessionId, workspaceId: agent.workspaceId, paneId: agent.paneId, soleAgent, title }];
  });
}

/** The listed chat whose Claude session the note is for, or null: another session on that computer. */
export function chatFor<T extends Pick<NoteChat, 'sessionId'>>(note: Pick<Note, 'sessionId'>, chats: readonly T[]): T | null {
  return chats.find((chat) => chat.sessionId === note.sessionId) ?? null;
}

/**
 * The Claude session a chat's composer sends to, the only one whose note
 * shows in it: in a workspace's chat holding several agents, discussing
 * another agent's note would send it to the wrong session. `agents` is the
 * chat's own (one pane's, for a pane's chat). Empty for none.
 */
export function chatNoteSession(agents: readonly AgentInfo[]): string {
  const target = sendTarget(agents);
  return target?.agent === 'claude' ? target.agentSession?.value ?? '' : '';
}

/** The note a session is showing, or null. */
export function noteOf(notes: readonly Note[], sessionId: string): Note | null {
  if (sessionId === '') return null;
  return notes.find((note) => note.sessionId === sessionId) ?? null;
}

// MARK: - Changes, on the raw object

/**
 * A change to the store: given the object as it is on the host, the object to
 * write, or null when there is nothing to do (the note is gone, or the
 * terminal has moved it on). Works on the raw object, so what this app does
 * not know survives the write: every top-level key, every row and every field
 * of a row, and every entry of `known`, strings or not. A row's `view` is the
 * exception, the way it is in the terminal: Learn more puts a new view in its
 * place, as the terminal's own Learn more builds a new `explained` view
 * rather than editing the offer, so a field of the offer goes with it.
 */
export type YskChange = (raw: Record<string, unknown>) => Record<string, unknown> | null;

/**
 * Change the row of `note`'s session, only while it still shows that note
 * (the same kind, line and `shownAt`, the terminal's own check), and nothing
 * else in the list: the rows stay in their order.
 */
function changeRow(
  note: Note,
  update: (row: Record<string, unknown>) => Record<string, unknown>,
  alsoFile: (raw: Record<string, unknown>) => Record<string, unknown> = (raw) => raw
): YskChange {
  return (raw) => {
    const rows = raw[SESSIONS_KEY];
    if (!Array.isArray(rows)) return null;
    const index = rows.findIndex((row: unknown) => {
      if (!isRecord(row) || row.id !== note.sessionId || !isRecord(row.view)) return false;
      const view = row.view;
      return view.kind === note.view.kind && view.line === note.view.line && view.shownAt === note.view.shownAt;
    });
    const row: unknown = rows[index];
    if (index === -1 || !isRecord(row)) return null;
    const next = rows.slice();
    next[index] = update(row);
    return alsoFile({ ...raw, [SESSIONS_KEY]: next });
  };
}

/** The row without its view: nothing showing for that session. */
function withoutView(row: Record<string, unknown>): Record<string, unknown> {
  const { view: _cleared, ...rest } = row;
  return rest;
}

/** The terminal's back-off counters back to 0, as answering a note sets them. Absent ones stay absent. */
function resetCounters(raw: Record<string, unknown>): Record<string, unknown> {
  const next = { ...raw };
  for (const key of COUNTER_KEYS) {
    const value = next[key];
    if (typeof value === 'number' && value > 0) next[key] = 0;
  }
  return next;
}

/**
 * `known` with `line` at its end, once whatever its case, and at most
 * `KNOWN_MAX` lines, the oldest going first. Only lines (strings) are
 * deduplicated and counted; an entry that is not one stays where it was.
 */
export function appendKnown(known: unknown, line: string): unknown[] {
  const lower = line.toLowerCase();
  const entries: unknown[] = Array.isArray(known) ? known.filter((entry) => typeof entry !== 'string' || entry.toLowerCase() !== lower) : [];
  entries.push(line);
  let over = entries.filter((entry) => typeof entry === 'string').length - KNOWN_MAX;
  return entries.filter((entry) => typeof entry !== 'string' || over-- <= 0);
}

/**
 * Learn more on an offer that carries its explanation: the row shows it, as
 * the terminal's Learn more does, in a new `explained` view that replaces
 * the offer whole (the terminal writes `{ kind, line, text, iteration,
 * shownAt }` the same way). Null for anything else (an offer without one
 * needs the terminal to write it).
 */
export function learnMore(note: Note, now: number): YskChange | null {
  const { view } = note;
  if (view.kind !== 'offer' || view.explanation === null) return null;
  const explanation = view.explanation;
  return changeRow(note, (row) => ({
    ...row,
    view: { kind: 'explained', line: view.line, text: explanation, iteration: 1, shownAt: now },
  }));
}

/**
 * Knew this already, Understood, and Discuss in chat: the line joins `known`,
 * which the side agent is told to steer clear of, and the note goes.
 */
export function knowNote(note: Note): YskChange {
  return changeRow(note, withoutView, (raw) => resetCounters({ ...raw, [KNOWN_KEY]: appendKnown(raw[KNOWN_KEY], note.view.line) }));
}

/** Dismiss: the note goes, and nothing is learned from it. */
export function dismissNote(note: Note): YskChange {
  return changeRow(note, withoutView, resetCounters);
}
