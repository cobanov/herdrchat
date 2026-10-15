/**
 * What the terminal's accessory bar sends for each of its keys.
 *
 * A hardware keyboard and the software keyboard's own letters go through the
 * emulator (SwiftTerm), which knows the modes the program asked for. The bar's
 * keys do not: they are written to the shell directly (`writeShellText`), so
 * they are encoded here, as xterm encodes them.
 *
 * The modes the program set are not visible from here. `applicationCursor`
 * (DECCKM, `ESC [ ? 1 h`) changes the arrows from `ESC [ A` to `ESC O A`, and
 * the kitty keyboard protocol (`ESC [ > flags u`, which herdr pushes) makes a
 * bare Esc ambiguous with the start of a sequence, so it wants `ESC [ 27 u`.
 * Both are options; the defaults are the plain xterm forms, which herdr, a
 * shell and every full-screen program read too (Esc after herdr's short wait).
 */

/** A key on the bar that is not a character. */
export type TerminalKey =
  | 'escape'
  | 'tab'
  | 'up'
  | 'down'
  | 'right'
  | 'left'
  | 'home'
  | 'end'
  | 'pageUp'
  | 'pageDown';

/** A key press: a named key, or one character typed with the bar's modifiers. */
export type KeyPress = { key: TerminalKey } | { char: string };

export interface KeyModifiers {
  /** Ctrl, sticky on the bar. */
  control?: boolean;
  /** Alt, sent as Meta: an Esc in front. */
  alt?: boolean;
}

export interface KeyModes {
  /** DECCKM: the program asked for application cursor keys. */
  applicationCursor?: boolean;
  /** The kitty keyboard protocol is on: Esc and modified keys as `CSI … u`. */
  kitty?: boolean;
}

const ESC = '\u001b';
const CSI = `${ESC}[`;

/** The final byte of each cursor-like key's CSI sequence. */
const CURSOR_FINAL: Partial<Record<TerminalKey, string>> = {
  up: 'A',
  down: 'B',
  right: 'C',
  left: 'D',
  home: 'H',
  end: 'F',
};

/** The number of each tilde key's `CSI n ~` sequence. */
const TILDE_NUMBER: Partial<Record<TerminalKey, number>> = {
  pageUp: 5,
  pageDown: 6,
};

/** xterm's modifier parameter: 1 + Shift(1) + Alt(2) + Ctrl(4). */
function modifierParameter(modifiers: KeyModifiers): number {
  return 1 + (modifiers.alt === true ? 2 : 0) + (modifiers.control === true ? 4 : 0);
}

/** The bytes (as a string of code units) one press sends. */
export function encodeKey(press: KeyPress, modifiers: KeyModifiers = {}, modes: KeyModes = {}): string {
  return 'key' in press ? encodeNamed(press.key, modifiers, modes) : encodeChar(press.char, modifiers, modes);
}

function encodeNamed(key: TerminalKey, modifiers: KeyModifiers, modes: KeyModes): string {
  const parameter = modifierParameter(modifiers);
  const final = CURSOR_FINAL[key];
  if (final !== undefined) {
    if (parameter > 1) return `${CSI}1;${parameter}${final}`;
    // Application mode changes the arrows and Home/End alike (`ESC O H`).
    return modes.applicationCursor === true ? `${ESC}O${final}` : `${CSI}${final}`;
  }
  const tilde = TILDE_NUMBER[key];
  if (tilde !== undefined) return parameter > 1 ? `${CSI}${tilde};${parameter}~` : `${CSI}${tilde}~`;
  const code = key === 'escape' ? 27 : 9;
  if (modes.kitty === true) {
    // Tab with no modifier stays a tab even under kitty; Esc never does.
    if (key === 'tab' && parameter === 1) return '\t';
    return parameter > 1 ? `${CSI}${code};${parameter}u` : `${CSI}${code}u`;
  }
  const bare = key === 'escape' ? ESC : '\t';
  return modifiers.alt === true ? ESC + bare : bare;
}

function encodeChar(char: string, modifiers: KeyModifiers, modes: KeyModes): string {
  if (char.length === 0) return '';
  const control = modifiers.control === true;
  const alt = modifiers.alt === true;
  if (modes.kitty === true && (control || alt)) {
    // A single code point, lower-cased as kitty reports the key.
    const codePoint = char.toLowerCase().codePointAt(0) ?? 0;
    return `${CSI}${codePoint};${modifierParameter(modifiers)}u`;
  }
  const base = control ? controlCode(char) : char;
  return alt ? ESC + base : base;
}

/**
 * Ctrl plus a character, as a terminal sends it. Letters map to 1–26 (Ctrl-C
 * is 3), the punctuation xterm maps (`@ [ \ ] ^ _ ? space`) to theirs, and
 * the bar's own `/`, `-` and `~` to what xterm sends for them. Anything else
 * goes as it is: there is no control form to send.
 */
export function controlCode(char: string): string {
  const lower = char.toLowerCase();
  if (lower.length === 1 && lower >= 'a' && lower <= 'z') return String.fromCharCode(lower.charCodeAt(0) - 96);
  switch (char) {
    case '@':
    case ' ':
    case '2':
      return '\u0000';
    case '[':
    case '3':
      return ESC;
    case '\\':
    case '|':
    case '4':
      return '\u001c';
    case ']':
    case '5':
      return '\u001d';
    case '^':
    case '~':
    case '6':
      return '\u001e';
    case '_':
    case '-':
    case '/':
    case '7':
      return '\u001f';
    case '?':
    case '8':
      return '\u007f';
    default:
      return char;
  }
}

/** One key on the accessory bar, in the order it shows them. */
export interface AccessoryKey {
  id: string;
  /** What the key says. An SF Symbol name is the screen's business; this is its text. */
  label: string;
  /** What VoiceOver says. */
  accessibilityLabel: string;
  press: KeyPress | null;
  /** Ctrl and Alt hold until the next key; they send nothing themselves. */
  modifier?: 'control' | 'alt';
}

export const ACCESSORY_KEYS: readonly AccessoryKey[] = [
  { id: 'esc', label: 'esc', accessibilityLabel: 'Escape', press: { key: 'escape' } },
  { id: 'tab', label: 'tab', accessibilityLabel: 'Tab', press: { key: 'tab' } },
  { id: 'ctrl', label: 'ctrl', accessibilityLabel: 'Control', press: null, modifier: 'control' },
  { id: 'alt', label: 'alt', accessibilityLabel: 'Alt', press: null, modifier: 'alt' },
  { id: 'left', label: '←', accessibilityLabel: 'Left arrow', press: { key: 'left' } },
  { id: 'down', label: '↓', accessibilityLabel: 'Down arrow', press: { key: 'down' } },
  { id: 'up', label: '↑', accessibilityLabel: 'Up arrow', press: { key: 'up' } },
  { id: 'right', label: '→', accessibilityLabel: 'Right arrow', press: { key: 'right' } },
  { id: 'slash', label: '/', accessibilityLabel: 'Slash', press: { char: '/' } },
  { id: 'dash', label: '-', accessibilityLabel: 'Dash', press: { char: '-' } },
  { id: 'pipe', label: '|', accessibilityLabel: 'Pipe', press: { char: '|' } },
  { id: 'tilde', label: '~', accessibilityLabel: 'Tilde', press: { char: '~' } },
  { id: 'home', label: 'home', accessibilityLabel: 'Home', press: { key: 'home' } },
  { id: 'end', label: 'end', accessibilityLabel: 'End', press: { key: 'end' } },
];
