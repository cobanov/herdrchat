/**
 * What Discuss in chat puts in the composer: the draft the terminal's "Chat
 * in main session" puts in its prompt box, built the way the plugin builds it
 * (Claude Code 2.1.310), so a note discussed from the phone reads to Claude
 * exactly as one discussed at the computer.
 *
 *     Here is a note offered by a side agent:
 *
 *     > Heads up · The main agent chose to add prompt caching to /ask.
 *     >
 *     > **One-off /ask questions now cost more**
 *     > Prompt caching saves the start of a request …
 *
 * A blank line follows the first line, and a bare quote mark stands between
 * the note and each part of its explanation, as the plugin writes them.
 *
 * The explanation is not quoted as written: the plugin reads it into at most
 * four parts (a title, its text, a fenced sketch, a caption after the sketch)
 * and writes those back, so stray control characters, blank lines and runs of
 * spaces are gone and an overlong part is cut. Then three folds keep Claude
 * Code's prompt box from reading the quoted note as something typed: an `@`
 * that would start a file mention, a placeholder that looks like a paste or
 * an image the prompt box would expand, and a word that turns on one of its
 * ultra modes.
 */
import { noteExplanation, type Note } from './notes';

/** The longest note line the plugin quotes, as it caps a line. */
export const DRAFT_LINE_MAX = 240;
/** A part's text past this is cut at a word, with an ellipsis. */
const PART_TEXT_MAX = 4000;
/** Parts of an explanation kept. */
const PARTS_MAX = 4;
/** Lines of a sketch kept, and characters of each. */
const SKETCH_LINES_MAX = 12;
const SKETCH_WIDTH_MAX = 120;
/** Characters of a part's title kept. */
const TITLE_MAX = 120;

const FENCE = /^```/;
/** A title line: `**Title**` or `# Title`. */
const TITLE_LINE = /^(?:\*\*([^*]+)\*\*|#+\s*(.+))$/;
/** A terminal escape sequence (colours, cursor moves, links). */
const ESCAPE =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?(?:\u0007|\u001B\u005C|\u009C))|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
/** Control and invisible format characters, and the line and paragraph separators. */
const INVISIBLE =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u0600-\u0605\u061C\u06DD\u070F\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\u2028\u2029]/g;

/** Each half of a surrogate pair standing alone, given to `replace`. */
function loneSurrogates(value: string, replacement: string): string {
  let out = '';
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[index]! + value[index + 1]!;
        index += 1;
        continue;
      }
      out += replacement;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      out += replacement;
    } else {
      out += value[index]!;
    }
  }
  return out;
}

/** Without what a terminal or a prompt box would act on rather than show. */
function visible(value: string): string {
  return loneSurrogates(value, '').replace(ESCAPE, '').replace(INVISIBLE, '');
}

/** One line: no control characters, runs of space as one, trimmed. */
function oneLine(value: string): string {
  return value.replace(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g, '').replace(/\s+/g, ' ').trim();
}

/** At most `max` UTF-16 units, never ending on half a character. */
function cut(value: string, max: number): string {
  if (max <= 0) return '';
  return value.length <= max ? value : value.slice(0, max).replace(/[\uD800-\uDBFF]$/, '');
}

/** At most `max`, cut at a word when that keeps more than half, with an ellipsis. */
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const head = cut(value, max - 1);
  const space = head.search(/\s\S*$/);
  const atWord = space !== -1 ? head.slice(0, space).trimEnd() : '';
  return `${atWord.length > max / 2 ? atWord : head.trimEnd()}…`;
}

/** Lines of text with each made one clean line and the empty ones dropped. */
function tidyLines(value: string): string {
  return value.split('\n').map(oneLine).filter((line) => line !== '').join('\n');
}

/** One part of an explanation, as the plugin reads it. */
export interface ExplanationPart {
  title: string;
  lead: string;
  sketch: string[];
  caption: string;
}

const emptyPart = (): ExplanationPart => ({ title: '', lead: '', sketch: [], caption: '' });

/**
 * An explanation's parts: a title line starts a part; text before a sketch is
 * its lead and after it its caption; a ``` fence opens and closes the sketch.
 */
export function explanationParts(explanation: string): ExplanationPart[] {
  const parts: ExplanationPart[] = [];
  let part = emptyPart();
  let inSketch = false;
  let hadSketch = false;
  const close = () => {
    part.lead = clip(tidyLines(part.lead), PART_TEXT_MAX);
    part.caption = clip(tidyLines(part.caption), PART_TEXT_MAX);
    if (part.title !== '' || part.lead !== '' || part.sketch.length > 0 || part.caption !== '') parts.push(part);
    part = emptyPart();
  };
  for (const raw of explanation.split('\n')) {
    const line = visible(raw).replace(/\s+$/, '');
    if (FENCE.test(line.trim())) {
      if (!inSketch && hadSketch) close();
      inSketch = !inSketch;
      hadSketch = true;
      continue;
    }
    if (inSketch) {
      if (part.sketch.length < SKETCH_LINES_MAX) part.sketch = [...part.sketch, cut(line, SKETCH_WIDTH_MAX)];
      continue;
    }
    const title = TITLE_LINE.exec(line.trim());
    if (title !== null) {
      close();
      hadSketch = false;
      part.title = cut(oneLine(title[1] ?? title[2] ?? ''), TITLE_MAX);
      continue;
    }
    const field = part.sketch.length === 0 && !hadSketch ? 'lead' : 'caption';
    part[field] += `\n${line}`;
  }
  close();
  return parts.slice(0, PARTS_MAX);
}

/** A part written back: its title in bold, its lead, its sketch fenced, its caption. */
function writePart(part: ExplanationPart): string {
  const sketch = part.sketch.length > 0 ? ['```', ...part.sketch, '```'].join('\n') : '';
  return [part.title === '' ? '' : `**${part.title}**`, part.lead, sketch, part.caption].filter((piece) => piece !== '').join('\n');
}

/** An `@` that would start a file mention: fullwidth instead. */
export function foldMentions(value: string): string {
  return value.replace(/(^|[\s\u3002\u3001\uFF1F\uFF01])@(?!\s)/g, '$1\uFF20');
}

/** A placeholder the prompt box would expand (`[Pasted text #2]`, `[Image #1]`, …): a fullwidth bracket instead. */
export function foldPlaceholders(value: string): string {
  return value.replace(
    /\[(Pasted text|Image|\.\.\.Truncated text|\u2726 Team setup guide) #(\d+)(?: \+\d+ lines)?(\.)*\]/g,
    (match) => `\uFF3B${match.slice(1)}`
  );
}

/** A word that turns on an ultra mode (`ultrathink`, `ultraplan`, …): hyphenated instead. */
export function foldUltraWords(value: string): string {
  return value.replace(/(ultra)(code|plan|review|think)/gi, '$1-$2');
}

/** The three folds, in the plugin's order, after any half character is made a visible one. */
export function foldForPrompt(value: string): string {
  return foldUltraWords(foldPlaceholders(foldMentions(loneSurrogates(value, '\uFFFD'))));
}

/** The draft for a note, ready for the composer. */
export function noteDraft(note: Pick<Note, 'tag' | 'view'>): string {
  const line = cut(oneLine(visible(note.view.line)), DRAFT_LINE_MAX);
  const explanation = noteExplanation(note);
  const parts = explanation === null ? [] : explanationParts(explanation);
  const quoted = [`${note.tag} · ${line}`, ...parts.map(writePart)]
    .join('\n\n')
    .split('\n')
    .map((row) => (row === '' ? '>' : `> ${row}`))
    .join('\n');
  return foldForPrompt(`Here is a note offered by a side agent:\n\n${quoted}`);
}
