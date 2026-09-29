/**
 * A slash command's panel, read off the pane.
 *
 * `/model`, `/effort`, `/usage` and friends open a panel over Claude's
 * composer and wait for keys, but herdr keeps reporting the agent `idle`
 * (measured on Claude Code 2.1.285), so the blocked-prompt path never sees
 * them. The panel is recognised from the screen instead, by the two things
 * that frame every one of them:
 *
 * - a rule of `▔` drawn across its top, and
 * - a key-hint line at its foot ending in "Esc to cancel".
 *
 * Both are required. Agents print numbered lists all the time; the frame is
 * what separates a panel from prose. Codex draws its panels differently and
 * is not recognised here.
 *
 * Answering is by keys, never by digit. A digit in Claude's model picker
 * commits the row at once AND saves it as the default for new sessions, so a
 * row tap only moves the highlight (Up/Down), and the hint's own actions,
 * "Enter to set as default" or "s to use this session only", commit it.
 */

import { stripAnsi } from './ansi';

export interface OverlayOption {
  number: number;
  /** "Sonnet". */
  label: string;
  /** "Sonnet 5.5 · Efficient for routine tasks", or null. */
  detail: string | null;
  /** Under the panel's cursor, what Enter would pick. */
  highlighted: boolean;
  /** Ticked (✔): what is in use now. */
  current: boolean;
}

/** A slider, like `/effort`'s low … max with a ▲ over the current stop. */
export interface OverlayScale {
  levels: string[];
  /** Index into `levels`, or null when the marker could not be placed. */
  current: number | null;
}

export interface OverlayAction {
  keys: string[];
  /** The key as the panel names it: "Enter", "s", "Esc". */
  key: string;
  /** "Set as default", "Use this session only", "Cancel". */
  label: string;
}

export interface PaneOverlay {
  title: string;
  /** Other text on the panel, wrapped lines joined. */
  notes: string[];
  options: OverlayOption[];
  scale: OverlayScale | null;
  /** A ←/→ setting inside the panel, e.g. "High effort" in the model picker. */
  adjust: { label: string } | null;
  /** From the hint line, Esc last. */
  actions: OverlayAction[];
}

/** The panel on this screen, or null when there is none. */
export function parsePaneOverlay(screen: string): PaneOverlay | null {
  const lines = screen.split('\n').map((line) => stripAnsi(line).replace(/\s+$/, ''));
  const hintIndex = findLastIndex(lines, (line) => ESC_HINT.test(line));
  if (hintIndex < 0) return null;
  const ruleIndex = findLastIndex(lines.slice(0, hintIndex), (line) => line.includes(TOP_RULE));
  if (ruleIndex < 0) return null;

  const body = lines.slice(ruleIndex + 1, hintIndex);
  const actions: OverlayAction[] = [];
  let adjust: PaneOverlay['adjust'] = null;
  let scale: OverlayScale | null = null;
  const options: OverlayOption[] = [];
  const texts: (string | null)[] = [];

  for (let index = 0; index < body.length; index += 1) {
    const raw = body[index] ?? '';
    const line = raw.trim();
    if (line.length === 0) {
      texts.push(null);
      continue;
    }

    const option = OPTION.exec(line);
    if (option !== null) {
      const [name = '', ...rest] = (option[3] ?? '').split(/\s{2,}/);
      const current = name.includes(TICK);
      options.push({
        number: Number(option[2]),
        label: name.replace(TICK, '').trim(),
        detail: rest.length === 0 ? null : rest.join(' ').trim(),
        highlighted: option[1] !== undefined,
        current,
      });
      continue;
    }
    if (line.includes(SCALE_MARKER) && line.includes('─')) {
      const levelsLine = body[index + 1] ?? '';
      const trailing = trailingHint(levelsLine);
      const words = [...(trailing?.rest ?? levelsLine).matchAll(/\S+/g)];
      const marker = raw.indexOf(SCALE_MARKER);
      scale = { levels: words.map((word) => word[0]), current: nearestWord(words, marker) };
      // The caption above the bar ("Faster … Smarter") only labels its ends.
      if (texts.length > 0 && texts.at(-1) !== null) texts.pop();
      // "Ultracode  off" beside the bar is a setting of its own.
      const beside = collapse(raw.slice(raw.lastIndexOf('─') + 1));
      if (beside.length > 0) texts.push(beside);
      // Its toggle hint sits on the line below: "Toggle Ultracode", not "Toggle".
      if (trailing !== null) {
        const setting = beside.split(' ')[0] ?? '';
        const label = setting.length > 0 ? `${trailing.action.label} ${setting}` : trailing.action.label;
        actions.push({ ...trailing.action, label });
      }
      index += 1;
      continue;
    }

    const arrows = line.indexOf(ADJUST_HINT);
    if (arrows >= 0) {
      const label = line.slice(0, arrows).replace(/^[●○◐◑◒◓•]\s*/, '').trim();
      adjust = { label: label.length > 0 ? label : 'Adjust' };
      continue;
    }

    const trailing = trailingHint(raw);
    if (trailing !== null) actions.push(trailing.action);
    const text = collapse(trailing?.rest ?? line);
    if (text.length > 0) texts.push(text);
  }

  const [title, ...notes] = paragraphs(texts);
  if (title === undefined) return null;
  for (const segment of (lines[hintIndex] ?? '').split(' · ')) {
    const action = hintAction(segment.trim());
    if (action !== null) actions.push(action);
  }
  // Cancel last, where a row of buttons puts the way out.
  actions.sort((a, b) => Number(a.key === 'Esc') - Number(b.key === 'Esc'));
  return { title, notes, options, scale, adjust, actions };
}

/** Keys that move the panel's cursor onto `option`, or null when it has none to move. */
export function overlayOptionKeys(overlay: PaneOverlay, option: OverlayOption): string[] | null {
  const from = overlay.options.find((candidate) => candidate.highlighted);
  if (from === undefined) return null;
  const steps = option.number - from.number;
  return Array.from({ length: Math.abs(steps) }, () => (steps > 0 ? 'Down' : 'Up'));
}

/** Keys that move a slider to `level`, or null when its position is unknown. */
export function overlayScaleKeys(overlay: PaneOverlay, level: number): string[] | null {
  const current = overlay.scale?.current;
  if (current === null || current === undefined) return null;
  const steps = level - current;
  return Array.from({ length: Math.abs(steps) }, () => (steps > 0 ? 'Right' : 'Left'));
}

// MARK: - Internals

const TOP_RULE = '▔'.repeat(8);
const ESC_HINT = /\bEsc to (cancel|close|exit|go back)\b/i;
const OPTION = /^(❯\s*)?(\d{1,2})\.\s+(.+)$/;
const TICK = '✔';
const SCALE_MARKER = '▲';
const ADJUST_HINT = '←/→ to adjust';

/** "Enter to set as default" → its keys and a button label. */
function hintAction(segment: string): OverlayAction | null {
  const match = /^(\S+) (?:to|for) (.+)$/.exec(segment);
  if (match === null) return null;
  const key = match[1] ?? '';
  const keys = KEYS[key.toLowerCase()] ?? (/^[a-z]$/.test(key) ? [key] : null);
  if (keys === null) return null;
  const words = (match[2] ?? '').trim();
  return { keys, key, label: words.charAt(0).toUpperCase() + words.slice(1) };
}

/**
 * Only keys herdr's `send-keys` accepts and that act inside the panel. Arrows
 * are handled as the adjust control and the row cursor, not as buttons.
 */
const KEYS: Record<string, string[]> = {
  enter: ['Enter'],
  return: ['Enter'],
  esc: ['Escape'],
  tab: ['Tab'],
  space: ['Space'],
};

/** A hint at the right end of a body line, "…      Tab to toggle", split off it. */
function trailingHint(line: string): { action: OverlayAction; rest: string } | null {
  const match = /\s{2,}((?:Tab|Space) to [a-z ]+)$/.exec(line);
  if (match === null || match.index === undefined) return null;
  const action = hintAction(match[1] ?? '');
  return action === null ? null : { action, rest: line.slice(0, match.index) };
}

function nearestWord(words: RegExpMatchArray[], column: number): number | null {
  if (column < 0 || words.length === 0) return null;
  let best = 0;
  let distance = Infinity;
  words.forEach((word, index) => {
    const centre = (word.index ?? 0) + word[0].length / 2;
    if (Math.abs(centre - column) < distance) {
      distance = Math.abs(centre - column);
      best = index;
    }
  });
  return best;
}

/**
 * Text lines as paragraphs: a line that ran to the panel's width continues
 * on the next, anything shorter ends where it ends. `null` is a blank line.
 */
function paragraphs(texts: readonly (string | null)[]): string[] {
  const out: string[] = [];
  let open = false;
  for (const text of texts) {
    if (text === null) {
      open = false;
      continue;
    }
    if (open && out.length > 0) out[out.length - 1] = `${out[out.length - 1]} ${text}`;
    else out.push(text);
    open = text.length >= WRAP_WIDTH;
  }
  return out;
}

/** Past this a panel line has probably wrapped rather than ended. */
const WRAP_WIDTH = 70;

function collapse(text: string): string {
  return text.replace(/\s{2,}/g, ' ').trim();
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index] as T)) return index;
  }
  return -1;
}
