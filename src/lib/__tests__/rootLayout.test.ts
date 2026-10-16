import { readFileSync } from 'fs';
import { join } from 'path';

// Expo Router throws "Screen names must be unique" on a development build only,
// so a duplicate from a merge passed CI's Release build and every dev build
// opened on a red screen. Read as text: the layout itself needs a native host.
it('declares each root screen once', () => {
  const source = readFileSync(join(__dirname, '../../features/root/RootStack.tsx'), 'utf8');
  const names = [...source.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((match) => match[1]);
  expect(names.length).toBeGreaterThan(0);
  expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
});
