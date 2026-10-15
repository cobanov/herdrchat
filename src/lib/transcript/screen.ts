import { stripAnsi } from './ansi';

/**
 * An agent's visible screen as a chat shows it, for an agent whose history the
 * app cannot read: colour codes gone, trailing space and the empty rows under
 * the last line dropped, runs of blank rows cut to one. Indentation and box
 * drawing stay: it is set in monospace, and code on it keeps its shape. Null
 * when nothing is left, so the thread waits rather than shows an empty box.
 */
export function screenText(raw: string): string | null {
  const lines = raw.split('\n').map((line) => stripAnsi(line).trimEnd());
  const kept: string[] = [];
  for (const line of lines) {
    if (line.length === 0 && (kept.length === 0 || kept[kept.length - 1] === '')) continue;
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
  return kept.length === 0 ? null : kept.join('\n');
}
