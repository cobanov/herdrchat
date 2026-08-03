/**
 * Lightweight block-level Markdown parsing for chat bubbles.
 *
 * Handles what Claude actually emits — fenced code, headings, lists, quotes,
 * rules, GFM tables, and inline bold/italic/code/links — and nothing else.
 * Unknown syntax falls through to a paragraph rather than being dropped, which
 * is the right failure for a chat surface: showing the raw characters is always
 * better than showing nothing.
 *
 * This is parsing only, with no React in it, so the fiddly line-based rules are
 * unit-testable. Rendering lives in `src/components/Markdown.tsx`.
 *
 * Ported from `legacy/ios/Sources/HerdrChatUI/Views/MarkdownText.swift`.
 */

export type MarkdownBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'bullet'; items: string[] }
  | { kind: 'numbered'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; language: string | null; content: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'rule' };

export function parseMarkdown(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.split('\n');
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
      paragraph = [];
    }
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flush();
      const language = trimmed.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1; // skip the closing fence
      blocks.push({
        kind: 'code',
        language: language.length === 0 ? null : language,
        content: code.join('\n'),
      });
      continue;
    }

    const table = parseTable(lines, index);
    if (table !== null) {
      flush();
      blocks.push(table.block);
      index = table.next;
      continue;
    }

    if (isRule(trimmed)) {
      flush();
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    const heading = parseHeading(trimmed);
    if (heading !== null) {
      flush();
      blocks.push(heading);
      index += 1;
      continue;
    }

    const bullet = parseBulletItem(line);
    if (bullet !== null) {
      flush();
      const items = [bullet];
      index += 1;
      for (;;) {
        const next = index < lines.length ? parseBulletItem(lines[index] ?? '') : null;
        if (next === null) break;
        items.push(next);
        index += 1;
      }
      blocks.push({ kind: 'bullet', items });
      continue;
    }

    const numbered = parseNumberedItem(line);
    if (numbered !== null) {
      flush();
      const items = [numbered];
      index += 1;
      for (;;) {
        const next = index < lines.length ? parseNumberedItem(lines[index] ?? '') : null;
        if (next === null) break;
        items.push(next);
        index += 1;
      }
      blocks.push({ kind: 'numbered', items });
      continue;
    }

    if (trimmed.startsWith('>')) {
      flush();
      const quote: string[] = [];
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('>')) {
        quote.push((lines[index] ?? '').trim().slice(1).trim());
        index += 1;
      }
      blocks.push({ kind: 'quote', text: quote.join('\n') });
      continue;
    }

    if (trimmed.length === 0) {
      flush();
      index += 1;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flush();
  return blocks;
}

// MARK: - Inline

export type InlineSpan =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

/**
 * Split a line into styled spans. Deliberately single-pass and non-nesting:
 * bold-inside-a-link is vanishingly rare in agent output, and supporting it
 * would cost a real parser. What matters is that the delimiters disappear even
 * when they don't pair up, so a stray asterisk never leaks into a bubble.
 */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const pattern = /(\[([^\]]+)\]\(([^)\s]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)/g;

  let cursor = 0;
  for (;;) {
    const match = pattern.exec(text);
    if (match === null) break;

    if (match.index > cursor) {
      spans.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }

    if (match[2] !== undefined && match[3] !== undefined) {
      spans.push({ kind: 'link', text: match[2], href: match[3] });
    } else if (match[5] !== undefined) {
      spans.push({ kind: 'code', text: match[5] });
    } else if (match[7] !== undefined) {
      spans.push({ kind: 'bold', text: match[7] });
    } else if (match[9] !== undefined) {
      spans.push({ kind: 'italic', text: match[9] });
    } else if (match[11] !== undefined) {
      spans.push({ kind: 'italic', text: match[11] });
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    spans.push({ kind: 'text', text: text.slice(cursor) });
  }
  return spans.length === 0 ? [{ kind: 'text', text }] : spans;
}

// MARK: - Internals

function isRule(line: string): boolean {
  return line.length >= 3 && /^(-+|\*+|_+)$/.test(line);
}

function parseHeading(line: string): MarkdownBlock | null {
  const match = /^(#{1,6})\s+(.*)$/.exec(line);
  if (match === null) return null;
  return { kind: 'heading', level: match[1]!.length, text: match[2]! };
}

function parseBulletItem(line: string): string | null {
  const match = /^\s*[-*+]\s+(.*)$/.exec(line);
  return match === null ? null : match[1]!;
}

function parseNumberedItem(line: string): string | null {
  const match = /^\s*\d+[.)]\s+(.*)$/.exec(line);
  return match === null ? null : match[1]!;
}

/**
 * A GFM table starting at `start`: a header row of `|`-cells followed by a
 * `|---|---|` separator, then body rows.
 */
function parseTable(
  lines: readonly string[],
  start: number
): { block: MarkdownBlock; next: number } | null {
  const header = (lines[start] ?? '').trim();
  const separator = (lines[start + 1] ?? '').trim();
  if (!header.includes('|') || !isTableSeparator(separator)) return null;

  const headers = tableCells(header);
  if (headers.length === 0) return null;

  const rows: string[][] = [];
  let index = start + 2;
  while (index < lines.length) {
    const line = (lines[index] ?? '').trim();
    if (line.length === 0 || !line.includes('|')) break;
    rows.push(tableCells(line));
    index += 1;
  }
  return { block: { kind: 'table', headers, rows }, next: index };
}

/** Split a `| a | b |` row into trimmed cells (outer pipes optional). */
function tableCells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  return text.split('|').map((cell) => cell.trim());
}

/** A `|---|:--:|` separator row: every cell is dashes with optional colons. */
function isTableSeparator(line: string): boolean {
  if (!line.includes('-') || !line.includes('|')) return false;
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => cell.length > 0 && /^:?-+:?$/.test(cell));
}
