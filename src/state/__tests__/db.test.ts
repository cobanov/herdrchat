import type { SQLiteDatabase } from 'expo-sqlite';
import { clearCachedMessages, clearPrompts, inTransaction } from '../db';

it('clears all transcript content, including list previews, but leaves credentials and host rows alone', async () => {
  const runAsync = jest.fn(async () => undefined);
  const db = {
    runAsync,
    withTransactionAsync: async (action: () => Promise<void>) => action(),
  } as unknown as SQLiteDatabase;
  await clearCachedMessages(db);
  expect(runAsync.mock.calls).toEqual([
    ['DELETE FROM messages'], ['DELETE FROM tail_cursors'], ['DELETE FROM previews'],
  ]);
  await clearPrompts(db, 'host');
  expect(runAsync).toHaveBeenLastCalledWith('DELETE FROM prompts WHERE connection_id = ?', 'host');
});

// #92: expo-sqlite's transactions share one connection and are not exclusive.
// Two at once nested BEGINs, and one's ROLLBACK undid the other's writes.
it('runs cache transactions one at a time, and a failure does not stall the rest', async () => {
  let active = 0;
  let most = 0;
  const order: string[] = [];
  const db = {
    withTransactionAsync: async (task: () => Promise<void>) => {
      active += 1;
      most = Math.max(most, active);
      try {
        await task();
      } finally {
        active -= 1;
      }
    },
  } as unknown as SQLiteDatabase;
  const step = (name: string) => async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push(name);
  };
  const failing = inTransaction(db, async () => {
    order.push('fails');
    throw new Error('constraint');
  });
  await Promise.all([
    inTransaction(db, step('a')),
    failing.catch(() => undefined),
    inTransaction(db, step('b')),
  ]);
  await expect(failing).rejects.toThrow('constraint');
  expect(most).toBe(1);
  // In the order they were asked for: the failing one was queued first.
  expect(order).toEqual(['fails', 'a', 'b']);
});
