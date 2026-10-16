import { ThreadWindow } from '../threadWindow';
import type { ChatMessage } from '../transcript/message';

const line = (id: string, text: string, timestamp: number | null, role: ChatMessage['role'] = 'user'): ChatMessage => ({
  id, role, segments: [{ kind: 'text', text }], timestamp, agentLabel: null, isSidechain: false,
});
const ids = (window: ThreadWindow) => window.view().messages.map((message) => message.id);

it('keeps an echo at its send position until a new line answers it', () => {
  const window = new ThreadWindow();
  window.seed([line('a', 'hi', 1), line('b', 'hello', 2, 'assistant')]);
  window.addEcho(line('local-1', 'again', 3));
  window.append([line('c', 'working on it', 4, 'assistant')]);
  expect(ids(window)).toEqual(['a', 'b', 'local-1', 'c']);

  window.append([line('d', 'again', 5)]);
  const view = window.view();
  expect(view.messages.map((message) => message.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(view.confirmed).toBe(1);
  expect(window.isConfirmed('local-1')).toBe(true);
  expect(window.view().confirmed).toBe(0);
});

it('never takes a line from before the send as its receipt', () => {
  const window = new ThreadWindow();
  window.seed([line('a', 'again', 1)]);
  window.addEcho(line('local-1', 'again', 2));
  expect(window.view().confirmed).toBe(0);
  expect(window.echo('local-1')).toBeDefined();
});

it('lets one line confirm one echo, not two', () => {
  const window = new ThreadWindow();
  window.addEcho(line('local-1', 'yes', 1));
  window.addEcho(line('local-2', 'yes', 2));
  window.append([line('a', 'yes', 3)]);
  expect(window.view().confirmed).toBe(1);
  expect(ids(window)).toEqual(['local-2', 'a']);
});

it('adds only lines not on screen, at either end', () => {
  const window = new ThreadWindow();
  window.seed([line('b', 'two', 2)]);
  expect(window.append([line('b', 'two', 2), line('c', 'three', 3)]).map((message) => message.id)).toEqual(['c']);
  expect(window.prepend([line('a', 'one', 1), line('b', 'two', 2)]).map((message) => message.id)).toEqual(['a']);
  expect(ids(window)).toEqual(['a', 'b', 'c']);
});

it('continues the list on a re-read of its end, and starts a new one after a gap', () => {
  const window = new ThreadWindow();
  window.seed([line('a', 'one', 1), line('b', 'two', 2)]);
  expect(window.replaceEnd([line('b', 'two', 2), line('c', 'three', 3)])).toEqual({ continued: true, keptOlder: true });
  expect(ids(window)).toEqual(['a', 'b', 'c']);
  expect(window.replaceEnd([line('x', 'later', 9)])).toEqual({ continued: false, keptOlder: false });
  expect(ids(window)).toEqual(['x']);
  window.reset();
  expect(window.isEmpty).toBe(true);
});
