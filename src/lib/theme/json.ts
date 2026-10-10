/**
 * Where a JSON text stops being JSON.
 *
 * `JSON.parse` says so differently on every engine: V8 names a character
 * position, Hermes (what the app runs on) usually names nothing. The theme's
 * problem line is meant to send a person, or an agent, to the line to fix, so
 * the app finds the place itself with this small scanner and leaves the
 * decoding to `JSON.parse` once the text is known to be valid.
 */

export type JsonResult = { ok: true; value: unknown } | { ok: false; line: number; column: number };

/**
 * How deep arrays and objects may nest. A theme is three levels deep; the cap
 * is there because the scanner recurses, and a file of `[[[[…` tens of
 * thousands deep would otherwise overflow the stack instead of being reported.
 */
export const MAX_JSON_DEPTH = 64;

class Fail {
  constructor(readonly offset: number) {}
}

function scan(text: string): void {
  let at = 0;
  let depth = 0;

  const fail = (): never => {
    throw new Fail(at);
  };
  const space = () => {
    while (at < text.length && ' \t\n\r'.includes(text[at]!)) at += 1;
  };
  const literal = (word: string) => {
    for (const char of word) {
      if (text[at] !== char) fail();
      at += 1;
    }
  };
  const string = () => {
    if (text[at] !== '"') fail();
    at += 1;
    for (;;) {
      if (at >= text.length) fail();
      const char = text[at]!;
      if (char === '"') {
        at += 1;
        return;
      }
      if (char < ' ') fail();
      if (char === '\\') {
        at += 1;
        const escape = text[at];
        if (escape === 'u') {
          for (let index = 0; index < 4; index += 1) {
            at += 1;
            if (!/[0-9a-fA-F]/.test(text[at] ?? '')) fail();
          }
        } else if (escape === undefined || !'"\\/bfnrt'.includes(escape)) fail();
      }
      at += 1;
    }
  };
  const number = () => {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(at));
    if (match === null) fail();
    at += match![0].length;
  };
  const value = (): void => {
    space();
    const char = text[at];
    if (char === '{' || char === '[') {
      if (depth >= MAX_JSON_DEPTH) fail();
      depth += 1;
      container(char);
      depth -= 1;
      return;
    }
    if (char === '"') return string();
    if (char === 't') return literal('true');
    if (char === 'f') return literal('false');
    if (char === 'n') return literal('null');
    return number();
  };
  const container = (char: '{' | '['): void => {
    if (char === '{') {
      at += 1;
      space();
      if (text[at] === '}') {
        at += 1;
        return;
      }
      for (;;) {
        space();
        string();
        space();
        if (text[at] !== ':') fail();
        at += 1;
        value();
        space();
        if (text[at] === ',') {
          at += 1;
          continue;
        }
        if (text[at] === '}') {
          at += 1;
          return;
        }
        fail();
      }
    }
    // An array.
    at += 1;
    space();
    if (text[at] === ']') {
      at += 1;
      return;
    }
    for (;;) {
      value();
      space();
      if (text[at] === ',') {
        at += 1;
        continue;
      }
      if (text[at] === ']') {
        at += 1;
        return;
      }
      fail();
    }
  };

  value();
  space();
  if (at < text.length) fail();
}

/** Line and column (1-based) of an offset. */
function position(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

export function parseJson(text: string): JsonResult {
  try {
    scan(text);
  } catch (error) {
    if (error instanceof Fail) return { ok: false, ...position(text, error.offset) };
    // Anything else (a stack overflow the depth cap missed, an engine quirk)
    // still means the file cannot be read, and the check that called this
    // must not reject over it.
    return { ok: false, ...position(text, text.length) };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    // The scanner and the engine disagree, which should not happen; report the
    // file as invalid rather than trusting either about where.
    return { ok: false, ...position(text, text.length) };
  }
}
