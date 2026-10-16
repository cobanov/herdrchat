import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/** Longest a component in `src/features` may be. Past this, one has stopped doing one thing. */
const MAX_COMPONENT_LINES = 400;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

// ThreadScreen grew to 790 lines and ChatsForServer to 590 before they were
// split; a component that size had every change touch all of it. Read as
// text: a top-level `function Name` runs to the first `}` at column 0.
it(`keeps every feature component under ${MAX_COMPONENT_LINES} lines`, () => {
  const tooLong = sources(join(__dirname, '../../features')).flatMap((file) => {
    const lines = readFileSync(file, 'utf8').split('\n');
    return lines.flatMap((line, start) => {
      const name = /^(?:export )?(?:default )?function ([A-Z]\w*)/.exec(line)?.[1];
      if (name === undefined) return [];
      const end = lines.findIndex((candidate, index) => index > start && candidate === '}');
      const length = (end === -1 ? lines.length : end) - start + 1;
      return length > MAX_COMPONENT_LINES ? [`${file.split('/src/')[1]}: ${name}, ${length} lines`] : [];
    });
  });
  expect(tooLong).toEqual([]);
});
