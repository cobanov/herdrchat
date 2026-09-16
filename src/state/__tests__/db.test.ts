import type { SQLiteDatabase } from 'expo-sqlite';
import { clearCachedMessages, clearPrompts } from '../db';

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
