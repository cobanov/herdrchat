/**
 * Reading what the discovery script printed (`discover.ts`): the command
 * literals grepped out of the Claude binary, and the command and skill files
 * found on disk, into catalogue entries.
 *
 * Nothing here throws. A line or a record that does not read is left out; a
 * frame that does not read makes the whole answer null, which the caller
 * treats as a failed scan and keeps what it had.
 */
import {
  SLASH_BEGIN,
  SLASH_BINARY,
  SLASH_BUILTINS,
  SLASH_BUILTINS_END,
  SLASH_BUILTINS_FAILED,
  SLASH_BUILTINS_UNCHANGED,
  SLASH_END,
  SLASH_FILE,
  SLASH_FILE_END,
  SLASH_NO_BINARY,
  SLASH_PLUGIN,
} from './discover';
import { CLAUDE_BUILTIN_DESCRIPTIONS } from './builtins';
import { SOURCE_PRECEDENCE, type CatalogueCommand, type CommandSection, type CommandSource } from './types';

/** Longest description kept, in characters. The palette shows one line; the cache stays small. */
export const MAX_DESCRIPTION_CHARS = 300;

// MARK: - JavaScript literals, as they appear in the bundle

/** Undo a JS string's escapes (`—`, `\xB7`, `\"`, `\n`). */
export function decodeJsString(raw: string): string {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, escape: string) => {
    if (escape.startsWith('u{')) return String.fromCodePoint(parseInt(escape.slice(2, -1), 16));
    if (escape.length > 1 && (escape[0] === 'u' || escape[0] === 'x')) return String.fromCharCode(parseInt(escape.slice(1), 16));
    if (escape === 'n') return '\n';
    if (escape === 't') return '\t';
    return escape;
  });
}

/** The index just past a string literal that opens at `start`, or -1 when it never closes. */
function skipString(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\') {
      i += 1;
    } else if (quote === '`' && char === '$' && text[i + 1] === '{') {
      const end = skipBalanced(text, i + 1);
      if (end === -1) return -1;
      i = end - 1;
    } else if (char === quote) {
      return i + 1;
    }
  }
  return -1;
}

/** The index just past the bracket that closes the one at `start`, or -1. String-aware. */
function skipBalanced(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === '"' || char === "'" || char === '`') {
      const end = skipString(text, i);
      if (end === -1) return -1;
      i = end - 1;
    } else if (char === '{' || char === '(' || char === '[') {
      depth += 1;
    } else if (char === '}' || char === ')' || char === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** The index of the `,` or closing `}` that ends a value starting at `start`, or -1. */
function skipValue(text: string, start: number): number {
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === ',' || char === '}') return i;
    if (char === '"' || char === "'" || char === '`') {
      const end = skipString(text, i);
      if (end === -1) return -1;
      i = end - 1;
    } else if (char === '{' || char === '(' || char === '[') {
      const end = skipBalanced(text, i);
      if (end === -1) return -1;
      i = end - 1;
    }
  }
  return -1;
}

/** One key of an object literal, as far as the catalogue cares. */
export type LiteralValue =
  | { kind: 'string'; value: string }
  /** A template literal with `${…}` in it: its text varies at run time. */
  | { kind: 'template'; raw: string }
  /** `get key(){…}`: the body between the braces. */
  | { kind: 'getter'; body: string }
  /** Anything else, as written (`!0`, `()=>!1`, `void 0`). */
  | { kind: 'raw'; raw: string };

function readValue(raw: string): LiteralValue {
  const text = raw.trim();
  const quote = text[0];
  if ((quote === '"' || quote === "'" || quote === '`') && skipString(text, 0) === text.length) {
    const inner = text.slice(1, -1);
    if (quote === '`' && inner.includes('${')) return { kind: 'template', raw: inner };
    return { kind: 'string', value: decodeJsString(inner) };
  }
  return { kind: 'raw', raw: text };
}

/**
 * The top-level keys of an object literal that starts at the first `{` of
 * `text`. The first of a repeated key wins. A literal cut short (the grep's
 * own bounds, or `BUILTIN_LINE_BYTES`) gives the keys before the cut.
 */
export function literalKeys(text: string): Map<string, LiteralValue> {
  const keys = new Map<string, LiteralValue>();
  const open = text.indexOf('{');
  if (open === -1) return keys;
  let i = open + 1;
  const set = (key: string, value: LiteralValue) => {
    if (!keys.has(key)) keys.set(key, value);
  };
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i]!)) i += 1;
    if (i >= text.length || text[i] === '}') break;
    if (text.startsWith('...', i)) {
      const end = skipValue(text, i + 3);
      if (end === -1) break;
      i = end;
      continue;
    }
    const getter = /^get\s+([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\{/.exec(text.slice(i, i + 200));
    if (getter !== null) {
      const braceAt = i + getter[0].length - 1;
      const end = skipBalanced(text, braceAt);
      if (end === -1) {
        // Cut inside the getter: keep what there is of its body.
        set(getter[1]!, { kind: 'getter', body: text.slice(braceAt + 1) });
        break;
      }
      set(getter[1]!, { kind: 'getter', body: text.slice(braceAt + 1, end - 1) });
      i = end;
      continue;
    }
    const key = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*([:(])/.exec(text.slice(i, i + 200));
    if (key === null) break;
    const after = i + key[0].length;
    if (key[2] === '(') {
      // A method: its parameters, then its body.
      const params = skipBalanced(text, after - 1);
      if (params === -1) break;
      const body = text.indexOf('{', params);
      const end = body === -1 ? -1 : skipBalanced(text, body);
      if (end === -1) break;
      i = end;
      continue;
    }
    const end = skipValue(text, after);
    if (end === -1) {
      // The grep's match ends before the literal's own `}`, so the last value
      // runs to the end of the line (or to a cut, which only shortens it).
      set(key[1]!, readValue(text.slice(after)));
      break;
    }
    set(key[1]!, readValue(text.slice(after, end)));
    i = end;
  }
  return keys;
}

/** The plain strings in a stretch of code, in order. */
function stringsIn(code: string): { quote: string; inner: string }[] {
  const found: { quote: string; inner: string }[] = [];
  for (let i = 0; i < code.length; i += 1) {
    const char = code[i]!;
    if (char !== '"' && char !== "'" && char !== '`') continue;
    const end = skipString(code, i);
    if (end === -1) break;
    found.push({ quote: char, inner: code.slice(i + 1, end - 1) });
    i = end - 1;
  }
  return found;
}

/**
 * The fixed part of a template: `Toggle fast mode (${x})` is "Toggle fast
 * mode". A parenthetical that holds a value goes whole; anything after a
 * remaining value, or a ` · ` before one, goes too.
 */
function templateText(raw: string): string {
  let text = decodeJsString(raw).replace(/\s*\([^()]*\$\{[^}]*\}[^()]*\)/g, '');
  const value = text.indexOf('${');
  if (value !== -1) text = text.slice(0, value);
  const dot = text.indexOf(' · ');
  if (dot !== -1) text = text.slice(0, dot);
  return text.replace(/[\s:,·-]+$/u, '').trim();
}

/**
 * What a computed description says when it is not the special case: the last
 * sentence it can return (the `else` branch, by how these getters are written),
 * else its template's fixed part. Null when it only calls something.
 */
export function getterDescription(body: string): string | null {
  const strings = stringsIn(body);
  // A description is a sentence: a capital, then words. That passes over the
  // values a getter compares against and the fragments it builds a status from.
  const phrases = strings.filter((s) => s.quote !== '`' && /^[A-Z]/.test(s.inner) && /\s/.test(s.inner));
  const last = phrases[phrases.length - 1];
  if (last !== undefined) return decodeJsString(last.inner);
  for (const s of strings) {
    if (s.quote !== '`') continue;
    const text = templateText(s.inner);
    if (/\s/.test(text)) return text;
  }
  return null;
}

// MARK: - Built-ins out of the binary

export type BuiltinType = 'local' | 'local-jsx' | 'prompt' | 'bundled';

/** One literal of one command. A name may have several (an interactive and a non-interactive one). */
export interface BuiltinVariant {
  name: string;
  type: BuiltinType;
  description: string | null;
  argumentHint: string | null;
  /** Never listed: `isHidden:!0`, `isEnabled:()=>!1`, or a skill with `userInvocable:!1`. */
  hidden: boolean;
}

const NAME = /^[a-z0-9][a-z0-9-]*$/;

function stringOf(value: LiteralValue | undefined): string | null {
  if (value === undefined) return null;
  if (value.kind === 'string') return value.value;
  if (value.kind === 'template') {
    const text = templateText(value.raw);
    return text.length > 0 ? text : null;
  }
  if (value.kind === 'getter') return getterDescription(value.body);
  return null;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * A literal's name: its string, or the string its variable is set to in the
 * bundle's name table (`zs({name:M7t,…})` with `M7t="simplify"`).
 */
function literalName(value: LiteralValue | undefined, names: ReadonlyMap<string, string>): string | null {
  if (value?.kind === 'string') return NAME.test(value.value) ? value.value : null;
  if (value?.kind === 'raw' && IDENTIFIER.test(value.raw)) return names.get(value.raw) ?? null;
  return null;
}

/**
 * The name-table lines the script sent with the literals (`,M7t="simplify"`),
 * as identifier to name. A minified identifier is reused across modules, so
 * one the table sets to two different names is left out: a wrong name is
 * worse than a missing one.
 */
export function parseNameTable(lines: readonly string[]): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const line of lines) {
    const match = /^,([A-Za-z_$][\w$]*)="([a-z0-9][a-z0-9-]*)"$/.exec(line.trim());
    if (match === null) continue;
    const [, id, name] = match as unknown as [string, string, string];
    const held = seen.get(id);
    seen.set(id, held === undefined || held === name ? name : null);
  }
  const names = new Map<string, string>();
  for (const [id, name] of seen) if (name !== null) names.set(id, name);
  return names;
}

/** One grepped line, or null when it is not a command literal (or names itself by a variable not in `names`). */
export function parseBuiltinLiteral(line: string, names: ReadonlyMap<string, string> = new Map()): BuiltinVariant | null {
  const keys = literalKeys(line);
  const name = literalName(keys.get('name'), names);
  if (name === null) return null;
  const typeValue = keys.get('type');
  let type: BuiltinType;
  if (typeValue?.kind === 'string' && ['local', 'local-jsx', 'prompt'].includes(typeValue.value)) {
    type = typeValue.value as BuiltinType;
  } else if (typeValue === undefined && line.trimStart().startsWith('({')) {
    type = 'bundled';
  } else {
    return null;
  }

  // A bundled skill's `description` is written for the model; the menu shows `menuDescription`.
  const described = type === 'bundled' ? (stringOf(keys.get('menuDescription')) ?? stringOf(keys.get('description')))
    : stringOf(keys.get('description'));
  const hint = keys.get('argumentHint');
  const raw = (key: string) => {
    const value = keys.get(key);
    return value?.kind === 'raw' ? value.raw.replace(/\s/g, '') : null;
  };
  return {
    name,
    type,
    description: described === null ? null : oneLine(described),
    // A computed hint (`get argumentHint(){…}`) depends on the session; show none.
    argumentHint: hint?.kind === 'string' && hint.value.trim().length > 0 ? hint.value.trim() : null,
    hidden: raw('isHidden') === '!0' || raw('isEnabled') === '()=>!1' || raw('userInvocable') === '!1',
  };
}

/** Which literal of a name speaks for it: the terminal's own (interactive) one first. */
const TYPE_PREFERENCE: readonly BuiltinType[] = ['local-jsx', 'prompt', 'local', 'bundled'];

/**
 * The built-ins, one per name, from every literal grepped.
 *
 * A name is listed when any of its literals is: the interactive one may be
 * enabled where the non-interactive one is hidden. Its description and hint
 * come from its literals in `TYPE_PREFERENCE` order, the first that has one.
 * `fallback` fills a description no literal states (one only computed at run
 * time), by name.
 */
export function mergeBuiltins(
  variants: readonly BuiltinVariant[],
  fallback: ReadonlyMap<string, string> = new Map()
): CatalogueCommand[] {
  const byName = new Map<string, BuiltinVariant[]>();
  for (const variant of variants) {
    const list = byName.get(variant.name) ?? [];
    list.push(variant);
    byName.set(variant.name, list);
  }
  const commands: CatalogueCommand[] = [];
  for (const [name, list] of byName) {
    const shown = list
      .filter((variant) => !variant.hidden)
      .sort((a, b) => TYPE_PREFERENCE.indexOf(a.type) - TYPE_PREFERENCE.indexOf(b.type));
    if (shown.length === 0) continue;
    const description = shown.find((variant) => variant.description)?.description ?? fallback.get(name) ?? '';
    const bundled = shown.every((variant) => variant.type === 'bundled');
    commands.push({
      name,
      description,
      argumentHint: shown.find((variant) => variant.argumentHint !== null)?.argumentHint ?? null,
      section: bundled ? 'skills' : 'builtin',
      source: bundled ? 'bundled' : 'builtin',
    });
  }
  return sortCommands(commands);
}

/**
 * The built-ins in what the grep printed: command literals, and the name-table
 * lines for the ones that name themselves by a variable. A description only
 * computed at run time comes from `fallback`, by default the static list's.
 */
export function parseBuiltins(
  text: string,
  fallback: ReadonlyMap<string, string> = CLAUDE_BUILTIN_DESCRIPTIONS
): CatalogueCommand[] {
  const lines = text.split('\n');
  const names = parseNameTable(lines.filter((line) => line.startsWith(',')));
  const variants: BuiltinVariant[] = [];
  for (const line of lines) {
    if (line.startsWith(',')) continue;
    const variant = parseBuiltinLiteral(line, names);
    if (variant !== null) variants.push(variant);
  }
  return mergeBuiltins(variants, fallback);
}

// MARK: - Command and skill files

/**
 * A file's frontmatter, as far as these files use YAML: `key: value` at the
 * margin, quoted or plain, folded (`>`) or literal (`|`) blocks, and plain
 * values continued on indented lines. Keys are lowercased.
 */
export function parseFrontmatter(excerpt: string): { fields: Map<string, string>; body: string[] } {
  const lines = excerpt.replace(/\r/g, '').split('\n');
  const fields = new Map<string, string>();
  if (lines[0]?.trim() !== '---') return { fields, body: lines };
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  const head = lines.slice(1, close === -1 ? lines.length : close);
  const body = close === -1 ? [] : lines.slice(close + 1);

  for (let i = 0; i < head.length; i += 1) {
    const match = /^([A-Za-z][\w-]*)\s*:(?:\s+(.*))?$/.exec(head[i]!);
    if (match === null) continue;
    const key = match[1]!.toLowerCase();
    let value = (match[2] ?? '').trim();
    const continued: string[] = [];
    while (i + 1 < head.length && (/^\s+\S/.test(head[i + 1]!) || head[i + 1]!.trim() === '')) {
      continued.push(head[i + 1]!.trim());
      i += 1;
    }
    if (/^[>|][+-]?$/.test(value)) {
      value = continued.join(value.startsWith('|') ? '\n' : ' ');
    } else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = decodeJsString(value.slice(1, -1));
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1).replaceAll("''", "'");
    } else {
      value = [value.replace(/\s+#.*$/, ''), ...continued].join(' ');
    }
    if (!fields.has(key)) fields.set(key, value.trim());
  }
  return { fields, body };
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_DESCRIPTION_CHARS ? `${flat.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…` : flat;
}

/** A file the script found: its record line's fields and its excerpt. */
export interface FileRecord {
  kind: 'command' | 'skill';
  source: 'user' | 'project' | 'plugin';
  /** `-` for the person's own, the folder for a project's, the install path for a plugin's. */
  owner: string;
  /** For a command, its path under the commands folder (`foo/bar.md`); for a skill, its folder's name. */
  name: string;
  path: string;
  excerpt: string;
}

/** The name a plugin goes by when its `plugin.json` does not say: `…/swift-lsp/1.0.0` is `swift-lsp`. */
export function pluginNameFromPath(installPath: string): string {
  const parts = installPath.split('/').filter((part) => part.length > 0);
  const last = parts[parts.length - 1] ?? '';
  const isVersion = /^v?\d+(\.\d+)*([-+].*)?$/.test(last) || /^[0-9a-f]{7,40}$/.test(last);
  return (isVersion ? parts[parts.length - 2] : last) ?? last;
}

/**
 * One file as a catalogue entry, or null when it is not one the terminal
 * would list: inside a hidden folder, a skill marked `user-invocable: false`,
 * or a name with a space in it.
 *
 * A command's name is its path, `/` read as `:` (`foo/bar.md` is `/foo:bar`),
 * the terminal's rule; a skill's is its folder; a plugin's either is prefixed
 * with the plugin's name. The description is the frontmatter's, else the first
 * line of the file. A skill is listed even with `disable-model-invocation`:
 * that flag keeps the model from using it, not the person.
 */
export function fileCommand(record: FileRecord, pluginName?: string): CatalogueCommand | null {
  const segments = (record.kind === 'command' ? record.name.replace(/\.md$/i, '') : record.name).split('/');
  if (segments.some((segment) => segment.length === 0 || segment.startsWith('.') || /\s/.test(segment))) return null;
  const { fields, body } = parseFrontmatter(record.excerpt);
  if (record.kind === 'skill' && fields.get('user-invocable')?.toLowerCase() === 'false') return null;

  const base = segments.join(':');
  const name = record.source === 'plugin' ? `${pluginName ?? pluginNameFromPath(record.owner)}:${base}` : base;
  const firstLine = body.find((line) => line.trim().length > 0 && line.trim() !== '---')?.replace(/^\s*#+\s*/, '') ?? '';
  const hint = fields.get('argument-hint') ?? '';
  const section: CommandSection =
    record.source === 'plugin' ? 'plugins' : record.kind === 'skill' ? 'skills' : 'commands';
  return {
    name,
    description: oneLine(fields.get('description') || firstLine),
    argumentHint: hint.length > 0 ? hint : null,
    section,
    source: record.source,
  };
}

// MARK: - The script's answer

/** What one run of the discovery script found. */
export interface ScanResult {
  /**
   * The built-ins: `unchanged` when the binary is the one already read (keep
   * them), a list when it was read (empty when the grep found none: an older
   * or newer bundle, so the static list stands in), or null when the host
   * part was not asked for or did not arrive whole.
   */
  builtins: { kind: 'unchanged' } | { kind: 'read'; commands: CatalogueCommand[] } | null;
  /** `binaryKey` of the binary read, null when there is none, undefined when not asked. */
  binary: string | null | undefined;
  /** The person's commands and skills; null when not asked. */
  user: CatalogueCommand[] | null;
  /** Installed plugins' commands and skills; null when not asked. */
  plugins: CatalogueCommand[] | null;
  /** Each folder scanned, with its commands and skills (an empty list for a folder with none). */
  projects: Record<string, CatalogueCommand[]>;
}

/**
 * Read the script's stdout. `request` is what was asked, so a folder with
 * nothing in it still comes back as scanned. Null when the frame is not the
 * script's (a login banner in front is fine; no begin or end sentinel is not).
 */
export function parseScanOutput(
  stdout: string,
  request: { host: boolean; cwds: readonly string[] },
  fallback?: ReadonlyMap<string, string>
): ScanResult | null {
  const lines = stdout.split('\n');
  const begin = lines.findIndex((line) => line === SLASH_BEGIN);
  const end = lines.lastIndexOf(SLASH_END);
  if (begin === -1 || end === -1 || end < begin) return null;

  const result: ScanResult = {
    builtins: null,
    binary: request.host ? null : undefined,
    user: request.host ? [] : null,
    plugins: request.host ? [] : null,
    projects: Object.fromEntries(request.cwds.map((cwd) => [cwd, [] as CatalogueCommand[]])),
  };
  const pluginNames = new Map<string, string>();

  for (let i = begin + 1; i < end; i += 1) {
    const line = lines[i]!;
    const fields = line.split('\t');
    const tag = fields[0];
    if (tag === SLASH_NO_BINARY) {
      result.binary = null;
      result.builtins = { kind: 'read', commands: [] };
    } else if (tag === SLASH_BINARY && fields.length >= 3) {
      result.binary = `${fields[1]!} ${fields.slice(2).join('\t')}`;
    } else if (tag === SLASH_BUILTINS_UNCHANGED) {
      result.builtins = { kind: 'unchanged' };
    } else if (tag === SLASH_BUILTINS_FAILED) {
      // The grep failed or hit its deadline: nothing read, nothing to record.
      // The held built-ins stay, and so does the held binary, so the next due
      // scan reads this one again.
      result.builtins = null;
    } else if (tag === SLASH_BUILTINS) {
      const close = lines.indexOf(SLASH_BUILTINS_END, i + 1);
      // Cut before its end: the built-ins did not arrive whole; keep the ones held.
      if (close === -1 || close > end) break;
      result.builtins = { kind: 'read', commands: parseBuiltins(lines.slice(i + 1, close).join('\n'), fallback) };
      i = close;
    } else if (tag === SLASH_PLUGIN && fields.length >= 3) {
      const path = fields.slice(2).join('\t');
      const name = fields[1]!.trim();
      pluginNames.set(path, name.length > 0 ? name : pluginNameFromPath(path));
    } else if (tag === SLASH_FILE && fields.length >= 6) {
      const close = lines.indexOf(SLASH_FILE_END, i + 1);
      if (close === -1 || close > end) break;
      const [, kind, source, owner, name] = fields;
      const record: FileRecord = {
        kind: kind === 'skill' ? 'skill' : 'command',
        source: source === 'project' ? 'project' : source === 'plugin' ? 'plugin' : 'user',
        owner: owner!,
        name: name!,
        path: fields.slice(5).join('\t'),
        excerpt: lines.slice(i + 1, close).join('\n'),
      };
      i = close;
      if (kind !== 'skill' && kind !== 'command') continue;
      const command = fileCommand(record, pluginNames.get(record.owner));
      if (command === null) continue;
      if (record.source === 'user') result.user?.push(command);
      else if (record.source === 'plugin') result.plugins?.push(command);
      else (result.projects[record.owner] ??= []).push(command);
    }
  }
  return result;
}

// MARK: - Order and precedence

const SECTION_RANK: Record<CommandSection, number> = { builtin: 0, skills: 1, commands: 2, plugins: 3 };

function sourceRank(source: CommandSource): number {
  return SOURCE_PRECEDENCE.indexOf(source);
}

/** Section order, then source precedence inside a section, then name. */
export function sortCommands(commands: readonly CatalogueCommand[]): CatalogueCommand[] {
  return [...commands].sort(
    (a, b) =>
      SECTION_RANK[a.section] - SECTION_RANK[b.section] ||
      sourceRank(a.source) - sourceRank(b.source) ||
      a.name.localeCompare(b.name)
  );
}

/**
 * One entry per name, the terminal's way: a built-in over a file, then
 * project over user over plugin, a bundled skill last (`SOURCE_PRECEDENCE`).
 * Sorted for the palette.
 */
export function dedupeCommands(commands: readonly CatalogueCommand[]): CatalogueCommand[] {
  const winners = new Map<string, CatalogueCommand>();
  for (const command of commands) {
    const held = winners.get(command.name);
    if (held === undefined || sourceRank(command.source) < sourceRank(held.source)) winners.set(command.name, command);
  }
  return sortCommands([...winners.values()]);
}
