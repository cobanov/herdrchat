import HerdrSshModule from './HerdrSshModule';
import type { OpenShellResult, ShellClosedEvent, ShellWriteResult } from './HerdrSsh.types';

/**
 * The connection id of the Demo host. `openShell` on it opens an echo shell
 * with no SSH under it: what is typed comes back, and the Demo feeds its
 * recorded screens to the view with `feed` from `herdr-terminal`.
 */
export const DEMO_CONNECTION = 'demo';

/** What the emulator (SwiftTerm) answers to. */
export const DEFAULT_TERM = 'xterm-256color';

export interface OpenShellOptions {
  /** POSIX shell. Run under `/bin/sh -c` on the host, whatever the login shell is. */
  command: string;
  cols: number;
  rows: number;
  term?: string;
  /** Bounds opening the channel, and how long the launch marker is waited for. */
  startTimeoutMs: number;
  /** How the shell ended, when it ends on its own. Not called after `closeShell`. */
  onClosed?: (event: ShellClosedEvent) => void;
}

let shellCounter = 0;
const closedSubscriptions = new Map<string, { remove: () => void }>();

/**
 * Ids outlive a JavaScript reload on the native side (the registry and the
 * channels are native), so a counter alone would reuse a live id after Fast
 * Refresh.
 */
function nextShellId(): string {
  shellCounter += 1;
  return `t${Date.now().toString(36)}-${shellCounter}`;
}

/**
 * Open a terminal shell on a connected host and run `command` in it.
 *
 * The listener for its end is in place before the channel opens, so a command
 * that fails at once (herdr not installed) still reports its exit. The
 * output itself never comes here: the `TerminalView` given the returned
 * `shellId` shows it.
 */
export async function openShell(connectionId: string, options: OpenShellOptions): Promise<OpenShellResult> {
  const shellId = nextShellId();
  const { onClosed } = options;
  if (onClosed !== undefined) {
    const subscription = HerdrSshModule.addListener('onShellClosed', (event: ShellClosedEvent) => {
      if (event.shellId !== shellId) return;
      forgetListener(shellId);
      onClosed(event);
    });
    closedSubscriptions.set(shellId, subscription);
  }
  const result = await HerdrSshModule.openShell(
    connectionId,
    shellId,
    options.command,
    options.cols,
    options.rows,
    options.term ?? DEFAULT_TERM,
    options.startTimeoutMs
  );
  if (!result.ok) forgetListener(shellId);
  return result;
}

function forgetListener(shellId: string) {
  closedSubscriptions.get(shellId)?.remove();
  closedSubscriptions.delete(shellId);
}

/** Bytes, already base64, to the shell's input. */
export function writeShell(shellId: string, base64: string): Promise<ShellWriteResult> {
  return HerdrSshModule.writeShell(shellId, base64);
}

/** Text (UTF-8 on the wire) to the shell's input: the accessory bar's keys, a paste. */
export function writeShellText(shellId: string, text: string): Promise<ShellWriteResult> {
  return HerdrSshModule.writeShell(shellId, base64FromBytes(utf8Bytes(text)));
}

export function resizeShell(shellId: string, cols: number, rows: number): Promise<ShellWriteResult> {
  return HerdrSshModule.resizeShell(shellId, cols, rows);
}

/** Hang up. Safe to call on a shell that has already ended; reports no end. */
export function closeShell(shellId: string): Promise<void> {
  forgetListener(shellId);
  return HerdrSshModule.closeShell(shellId);
}

/** UTF-8, without relying on a TextEncoder being present in every runtime. */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return Uint8Array.from(out);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64, padded: what `Data(base64Encoded:)` reads. */
export function base64FromBytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET.charAt((triple >> 18) & 0x3f);
    out += ALPHABET.charAt((triple >> 12) & 0x3f);
    out += b === undefined ? '=' : ALPHABET.charAt((triple >> 6) & 0x3f);
    out += c === undefined ? '=' : ALPHABET.charAt(triple & 0x3f);
  }
  return out;
}
