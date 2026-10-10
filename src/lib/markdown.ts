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
 * Behaviour ported from the original SwiftUI implementation (see git
 * history before the Expo rewrite).
 */

export type MarkdownBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'bullet'; items: string[] }
  | { kind: 'numbered'; start: number; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; language: string | null; content: string }
  | { kind: 'table'; headers: string[]; align: TableAlign[]; rows: string[][] }
  | { kind: 'rule' };

/** A column's alignment from its `:--`, `:-:` or `--:` separator; null is the default. */
export type TableAlign = 'left' | 'center' | 'right' | null;

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

    const fence = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
    if (fence !== null) {
      flush();
      // Closed only by the same character, at least as long, and nothing else
      // on the line (#108). A block opened with four backticks can therefore
      // show a three-backtick example inside it, and `~~~` fences work.
      const marker = fence[1] ?? '```';
      const closing = new RegExp(`^${marker[0] === '~' ? '~' : '`'}{${marker.length},}\\s*$`);
      const language = (fence[2] ?? '').trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !closing.test((lines[index] ?? '').trim())) {
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
      const start = Number(/^\s*(\d+)/.exec(line)?.[1]);
      const items = [numbered];
      index += 1;
      for (;;) {
        const next = index < lines.length ? parseNumberedItem(lines[index] ?? '') : null;
        if (next === null) break;
        items.push(next);
        index += 1;
      }
      blocks.push({ kind: 'numbered', start, items });
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
  // The link target allows one level of balanced parentheses, so a URL such as
  // https://en.wikipedia.org/wiki/Rust_(programming_language) is not cut at its
  // first `)` (#108).
  // A bare address (`https://…`) is a link too, as it is in every chat app:
  // agents paste pull request and issue addresses in prose far more often
  // than they write a markdown link, and a URL you have to copy out by hand
  // on a phone is not a link. `<https://…>` is the same with its brackets
  // dropped. Both take the same balanced-parentheses rule as a link target,
  // and trailing punctuation stays prose (`see https://x.dev.`).
  const pattern = /(\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)|(<(https?:\/\/[^\s<>]+)>)|(https?:\/\/(?:[^()\s<>]|\([^()\s]*\))+)/g;

  let cursor = 0;
  for (;;) {
    const match = pattern.exec(text);
    if (match === null) break;

    // Underscores inside identifiers are literal, not emphasis delimiters.
    if (match[11] !== undefined && (
      /[\p{L}\p{N}_]/u.test(text[match.index - 1] ?? '') ||
      /[\p{L}\p{N}_]/u.test(text[match.index + match[0].length] ?? '')
    )) {
      pattern.lastIndex = match.index + 1;
      continue;
    }

    if (match.index > cursor) {
      spans.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }

    if (match[13] !== undefined || match[14] !== undefined) {
      // A sentence's full stop or comma after an address is not part of it.
      const bare = match[14];
      const href = bare === undefined ? match[13]! : bare.replace(/[.,;:!?'"]+$/, '');
      spans.push(safeLink(href) ? { kind: 'link', text: href, href } : { kind: 'text', text: href });
      cursor = match.index + (bare === undefined ? match[0].length : href.length);
      pattern.lastIndex = cursor;
      continue;
    }

    if (match[2] !== undefined && match[3] !== undefined) {
      spans.push(safeLink(match[3]) ? { kind: 'link', text: match[2], href: match[3] }
        : { kind: 'text', text: `${match[2]} (${match[3]})` });
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

/** Agent output is untrusted. Never dispatch app/file/script schemes. */
function safeLink(href: string): boolean {
  try {
    const url = new URL(href);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0;
  } catch {
    // Relative paths stay readable, not actionable.
    return false;
  }
}

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
 *
 * Every row comes back with exactly one cell per header, so the renderer can
 * lay the table out as columns. A short row is padded, as GFM does. A long one
 * is not cut, as GFM would: the extra cells are almost always an unescaped
 * `|` in the last cell's text, so they are joined back into it and nothing the
 * agent wrote disappears.
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
  const marks = tableCells(separator);
  const align = headers.map((_, column) => alignment(marks[column] ?? ''));

  const rows: string[][] = [];
  let index = start + 2;
  while (index < lines.length) {
    const line = (lines[index] ?? '').trim();
    if (line.length === 0 || !line.includes('|')) break;
    rows.push(fitRow(tableCells(line), headers.length));
    index += 1;
  }
  return { block: { kind: 'table', headers, align, rows }, next: index };
}

function fitRow(cells: string[], columns: number): string[] {
  if (cells.length > columns) {
    return [...cells.slice(0, columns - 1), cells.slice(columns - 1).join(' | ')];
  }
  return [...cells, ...Array<string>(columns - cells.length).fill('')];
}

/**
 * Split a `| a | b |` row into trimmed cells (outer pipes optional).
 *
 * A pipe is a cell boundary unless it is escaped (`\|`, which GFM defines as a
 * literal pipe) or inside a code span. GFM itself splits inside code spans, but
 * agents write `` `a | b` `` for shell pipes and union types far more often
 * than they escape it, and splitting there pushes the rest of the row one
 * column to the right.
 */
function tableCells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);

  const cells: string[] = [];
  let cell = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    if (char === '\\' && text[index + 1] === '|') {
      cell += '|';
      index += 2;
    } else if (char === '`') {
      const run = /^`+/.exec(text.slice(index))?.[0] ?? '`';
      const close = closingRun(text, index + run.length, run.length);
      const end = close === -1 ? index + run.length : close + run.length;
      cell += text.slice(index, end).replace(/\\\|/g, '|');
      index = end;
    } else if (char === '|') {
      cells.push(cell.trim());
      cell = '';
      index += 1;
    } else {
      cell += char;
      index += 1;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** Where a backtick run of exactly `length` starts at or after `from`, or -1. */
function closingRun(text: string, from: number, length: number): number {
  const runs = /`+/g;
  runs.lastIndex = from;
  for (;;) {
    const match = runs.exec(text);
    if (match === null) return -1;
    if (match[0].length === length) return match.index;
  }
}

/** A `|---|:--:|` separator row: every cell is dashes with optional colons. */
function isTableSeparator(line: string): boolean {
  if (!line.includes('-') || !line.includes('|')) return false;
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => cell.length > 0 && /^:?-+:?$/.test(cell));
}

function alignment(mark: string): TableAlign {
  const left = mark.startsWith(':');
  const right = mark.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}
