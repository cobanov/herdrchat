/**
 * Best-effort extraction of an agent's in-progress answer from the pane's
 * VISIBLE screen, for a live "streaming" preview bubble while the turn is still
 * being written (transcripts are only turn-granular).
 *
 * Find the status/spinner line, take the prose block above it, and drop all TUI
 * chrome. Returns null unless it finds real prose, so the caller can fall back to
 * a plain waiting bar rather than show noise — a wrong preview is worse than
 * none, because it reads as the agent's actual answer.
 *
 * Ported from `legacy/ios/Sources/HerdrKit/Transcript/LivePreview.swift`.
 */
export function extractLivePreview(raw: string): string | null {
  const lines = raw.split('\n').map(clean);

  // Anchor: the last status/spinner line (Claude prints one while working).
  const anchor = lastIndexWhere(lines, isStatusLine);
  // Otherwise stop at the composer input line near the bottom.
  const composer = lastIndexWhere(lines, (line) => line.startsWith('❯'));
  const end = anchor ?? composer ?? lines.length;

  const collected: string[] = [];
  let index = end - 1;
  while (index >= 0 && collected.length < 8) {
    const line = lines[index] ?? '';
    if (line.length === 0) {
      if (collected.length === 0) {
        index -= 1;
        continue;
      }
      break;
    }
    if (isChrome(line)) {
      index -= 1;
      continue;
    }
    collected.unshift(line);
    index -= 1;
  }

  let text = collected.join('\n').trim();
  for (const bullet of ['⏺', '●', '⏵']) {
    if (text.startsWith(bullet)) {
      text = text.slice(bullet.length).trim();
      break;
    }
  }
  // Require real prose. Anything shorter is almost certainly chrome that slipped
  // through, and showing it as the agent's answer would be a lie.
  return text.length >= 20 ? text : null;
}

// MARK: - Internals

const ANSI_CSI = /\[[0-9;?]*[A-Za-z]/g;
const BORDER_CHARS = '│┃|╭╮╰╯─┌┐└┘├┤ \t';
const SPINNER_GLYPHS = '✳✽✻✢✶✷✸✹✺⚹∗·';

function clean(line: string): string {
  const withoutAnsi = line.replace(ANSI_CSI, '');
  let start = 0;
  let end = withoutAnsi.length;
  while (start < end && BORDER_CHARS.includes(withoutAnsi[start] ?? '')) start += 1;
  while (end > start && BORDER_CHARS.includes(withoutAnsi[end - 1] ?? '')) end -= 1;
  return withoutAnsi.slice(start, end);
}

/**
 * Claude's working status line: a spinner glyph, a token counter, or an
 * "esc to interrupt" hint.
 */
function isStatusLine(line: string): boolean {
  if (line.length === 0) return false;
  for (const glyph of SPINNER_GLYPHS) {
    if (line.includes(glyph)) return true;
  }
  const lower = line.toLowerCase();
  return (
    lower.includes('esc to interrupt') ||
    lower.includes('tokens)') ||
    lower.includes('token · ') ||
    (lower.includes('↓ ') && lower.includes('token'))
  );
}

/**
 * TUI chrome that isn't the agent's answer: the composer, rules, the shell
 * prompt or herdr footer, mode hints.
 */
function isChrome(line: string): boolean {
  if (line.startsWith('❯') || line.startsWith('>')) return true;
  if (/^[-─=]+$/.test(line)) return true;
  const lower = line.toLowerCase();
  return (
    lower.includes('manual mode') ||
    lower.includes('for agents') ||
    lower.includes('/effort') ||
    lower.includes('◉') ||
    lower.includes('esc to') ||
    lower.includes('ctrl+') ||
    lower.includes('⏸') ||
    lower.includes('resume this session') ||
    lower.includes('? for shortcuts') ||
    // A shell prompt line, e.g. "user@host | ~/projects".
    (line.includes('|') && line.includes('@') && (line.includes('~') || line.includes('/')))
  );
}

function lastIndexWhere(lines: readonly string[], predicate: (line: string) => boolean): number | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (predicate(lines[index] ?? '')) return index;
  }
  return null;
}
