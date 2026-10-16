import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every .tsx file under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

// `tertiaryLabel` is 3.78:1 in light mode, under the 4.5:1 text needs, so it
// is held to glyphs: an icon's fallback character and the shell's prompt
// (HC-32). Words in it went unread by anyone with low vision.
const GLYPHS = new Set(['{shellPrompt}', "{open ? '⌄' : '›'}"]);

it('keeps words out of the tertiary label colour', () => {
  const words: string[] = [];
  for (const path of sources(join(__dirname, '..', '..'))) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/<Text\b[^>]*color="tertiary"[^>]*>([\s\S]*?)<\/Text>/g)) {
      const child = (match[1] ?? '').trim();
      if ([...child].length > 1 && !GLYPHS.has(child)) words.push(`${path}: ${child}`);
    }
  }
  expect(words).toEqual([]);
});
