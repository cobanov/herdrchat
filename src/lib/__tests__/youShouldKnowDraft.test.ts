import { DEMO_YSK_LINE, DEMO_YSK_OTHER_LINE, demoYskStore } from '../demo/scenarios';
import { explanationParts, foldForPrompt, foldMentions, foldPlaceholders, foldUltraWords, noteDraft, DRAFT_LINE_MAX } from '../youShouldKnow/draft';
import { parseYskFile, serializeYsk, type Note } from '../youShouldKnow/notes';

const notes = parseYskFile(serializeYsk(demoYskStore('chat', 0)))!.notes;
const offer = notes[0]!;
const explained = notes[1]!;

describe('noteDraft', () => {
  it('quotes the note and its explanation as the plugin does', () => {
    expect(noteDraft(offer)).toBe([
      'Here is a note offered by a side agent:',
      '',
      `> Heads up · ${DEMO_YSK_LINE}`,
      '>',
      '> **Some fixes are not in the notes**',
      '> - The summary lists what was merged through pull requests since the last tag.',
      '> - Two fixes went straight to main without one, so they are in the release but not in the notes.',
    ].join('\n'));
  });

  it('drops blank lines in the explanation, as the plugin tidies it', () => {
    expect(noteDraft(explained)).toBe([
      'Here is a note offered by a side agent:',
      '',
      `> You should know · ${DEMO_YSK_OTHER_LINE}`,
      '>',
      '> **Rounding per line adds up**',
      '> Each line is rounded to the cent before the lines are added, while the PDF rounds the total once.',
      '> A 40-line invoice can differ by up to 20 cents.',
    ].join('\n'));
  });

  it('is the line alone for an offer without an explanation', () => {
    const bare: Note = { sessionId: 'x', tag: 'You should know', view: { kind: 'offer', line: 'A line.', explanation: null, shownAt: 1 } };
    expect(noteDraft(bare)).toBe('Here is a note offered by a side agent:\n\n> You should know · A line.');
  });

  it('cleans and caps the line', () => {
    const line = `A\u001b[31m  red\u0007 line\u200B.${'x'.repeat(400)}`;
    const draft = noteDraft({ tag: 'Heads up', view: { kind: 'offer', line, explanation: null, shownAt: 1 } });
    const quoted = draft.split('\n')[2]!;
    expect(quoted.startsWith('> Heads up · A red line.x')).toBe(true);
    expect(quoted.length).toBe('> Heads up · '.length + DRAFT_LINE_MAX);
  });

  it('keeps a sketch fenced, with its empty lines as a bare quote mark', () => {
    const explanation = '# How it flows\nThe request goes out once.\n```\nphone ─▶ host\n\nhost ─▶ phone\n```\nThen it comes back.';
    expect(noteDraft({ tag: 'Heads up', view: { kind: 'offer', line: 'L.', explanation, shownAt: 1 } })).toBe([
      'Here is a note offered by a side agent:',
      '',
      '> Heads up · L.',
      '>',
      '> **How it flows**',
      '> The request goes out once.',
      '> ```',
      '> phone ─▶ host',
      '>',
      '> host ─▶ phone',
      '> ```',
      '> Then it comes back.',
    ].join('\n'));
  });

  it('folds what the prompt box would act on', () => {
    const explanation = 'See @src/app.ts and [Image #1], then ultrathink about it.';
    const draft = noteDraft({ tag: 'Heads up', view: { kind: 'explained', line: 'Ask @claude.', text: explanation, shownAt: 1 } });
    expect(draft).toContain('> Heads up · Ask ＠claude.');
    expect(draft).toContain('> See ＠src/app.ts and ［Image #1], then ultra-think about it.');
  });
});

describe('the folds', () => {
  it('make an @ that starts a word fullwidth, and leave an address alone', () => {
    expect(foldMentions('@a b @c me@x.dev @ alone (@d)')).toBe('＠a b ＠c me@x.dev @ alone (@d)');
    expect(foldMentions('line\n@file。@next')).toBe('line\n＠file。＠next');
  });

  it('open the prompt box’s placeholders with a fullwidth bracket', () => {
    expect(foldPlaceholders('[Pasted text #2 +40 lines] [Image #1] [...Truncated text #3.] [Other #1]')).toBe(
      '［Pasted text #2 +40 lines] ［Image #1] ［...Truncated text #3.] [Other #1]'
    );
  });

  it('hyphenate the ultra words, whatever their case', () => {
    expect(foldUltraWords('ultrathink UltraPlan ultracode ultrareview ultrafast')).toBe('ultra-think Ultra-Plan ultra-code ultra-review ultrafast');
  });

  it('make half a character a visible one', () => {
    expect(foldForPrompt('a\uD800b')).toBe('a\uFFFDb');
  });
});

describe('explanationParts', () => {
  it('reads titles, text, a sketch and a caption, at most four parts', () => {
    const text = ['**One**', 'lead one', '```', 'art', '```', 'caption one', '## Two', 'lead two', '**3**', '**4**', '**5**'].join('\n');
    const parts = explanationParts(text);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toEqual({ title: 'One', lead: 'lead one', sketch: ['art'], caption: 'caption one' });
    expect(parts[1]).toEqual({ title: 'Two', lead: 'lead two', sketch: [], caption: '' });
  });
});
