import { keepUnchanged } from '../sameShape';

const row = (id: string, status: string) => ({ id, status, panes: [{ paneId: `${id}:p1` }] });

it('hands back the same list when a poll rebuilt the same rows', () => {
  const first = [row('w1', 'idle'), row('w2', 'idle')];
  expect(keepUnchanged(first, [row('w1', 'idle'), row('w2', 'idle')], (r) => r.id)).toBe(first);
});

it('keeps the rows that did not change and takes the ones that did', () => {
  const first = [row('w1', 'idle'), row('w2', 'idle')];
  const next = keepUnchanged(first, [row('w1', 'idle'), row('w2', 'working')], (r) => r.id);
  expect(next).not.toBe(first);
  expect(next[0]).toBe(first[0]);
  expect(next[1]).toEqual(row('w2', 'working'));
  const moved = keepUnchanged(first, [row('w2', 'idle'), row('w1', 'idle')], (r) => r.id);
  expect(moved).not.toBe(first);
  expect(moved[0]).toBe(first[1]);
});
