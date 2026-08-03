import { parseInline, parseMarkdown } from '../markdown';

describe('block parsing', () => {
  it('separates paragraphs on blank lines', () => {
    expect(parseMarkdown('one\n\ntwo')).toEqual([
      { kind: 'paragraph', text: 'one' },
      { kind: 'paragraph', text: 'two' },
    ]);
  });

  it('keeps a fenced block verbatim, including blank lines', () => {
    const blocks = parseMarkdown('```bash\nnpm test\n\nnpm run lint\n```');
    expect(blocks).toEqual([
      { kind: 'code', language: 'bash', content: 'npm test\n\nnpm run lint' },
    ]);
  });

  // Markdown inside a fence is content, not markup. Formatting it would corrupt
  // a surface people copy commands out of.
  it('does not interpret markdown inside a fence', () => {
    const blocks = parseMarkdown('```\n# not a heading\n- not a list\n```');
    expect(blocks[0]).toMatchObject({ kind: 'code' });
    expect(blocks).toHaveLength(1);
  });

  it('reads headings by level', () => {
    expect(parseMarkdown('## Done')).toEqual([{ kind: 'heading', level: 2, text: 'Done' }]);
  });

  // "#tag" is not a heading. Requiring the space is what keeps a hashtag out of
  // the type scale.
  it('requires a space after the hashes', () => {
    expect(parseMarkdown('#notaheading')).toEqual([{ kind: 'paragraph', text: '#notaheading' }]);
  });

  it('groups consecutive list items into one block', () => {
    expect(parseMarkdown('- a\n- b\n- c')).toEqual([{ kind: 'bullet', items: ['a', 'b', 'c'] }]);
    expect(parseMarkdown('1. a\n2. b')).toEqual([{ kind: 'numbered', items: ['a', 'b'] }]);
  });

  it('reads a GFM table with its alignment row', () => {
    const blocks = parseMarkdown('| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 | 4 |');
    expect(blocks).toEqual([
      { kind: 'table', headers: ['a', 'b'], rows: [['1', '2'], ['3', '4']] },
    ]);
  });

  // Without the separator row it is just a line with pipes in it.
  it('does not mistake a piped sentence for a table', () => {
    expect(parseMarkdown('run a | b to pipe')[0]).toMatchObject({ kind: 'paragraph' });
  });

  it('reads rules and quotes', () => {
    expect(parseMarkdown('---')).toEqual([{ kind: 'rule' }]);
    expect(parseMarkdown('> quoted\n> lines')).toEqual([{ kind: 'quote', text: 'quoted\nlines' }]);
  });

  // The failure mode that matters for a chat surface: unknown syntax must show
  // its raw characters, never vanish.
  it('falls through to a paragraph rather than dropping anything', () => {
    const blocks = parseMarkdown('<div>raw html</div>\n\n:::admonition:::');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: '<div>raw html</div>' },
      { kind: 'paragraph', text: ':::admonition:::' },
    ]);
  });

  it('handles an unterminated fence without losing the rest', () => {
    const blocks = parseMarkdown('```js\nconst x = 1;');
    expect(blocks).toEqual([{ kind: 'code', language: 'js', content: 'const x = 1;' }]);
  });
});

describe('inline parsing', () => {
  it('reads bold, italic, code and links', () => {
    expect(parseInline('a **b** c `d` [e](https://x.dev) *f*')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' c ' },
      { kind: 'code', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'e', href: 'https://x.dev' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'f' },
    ]);
  });

  // A lone asterisk is ordinary text. Leaking a delimiter into a bubble is the
  // visible bug this guards.
  it('leaves unpaired delimiters alone', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ kind: 'text', text: '2 * 3 = 6' }]);
  });

  it('returns the whole string when there is no markup', () => {
    expect(parseInline('plain text')).toEqual([{ kind: 'text', text: 'plain text' }]);
    expect(parseInline('')).toEqual([{ kind: 'text', text: '' }]);
  });

  // Code spans are literal: asterisks inside backticks are characters, not
  // emphasis, and a shell glob would otherwise render as italics.
  it('does not format inside a code span', () => {
    expect(parseInline('`ls *.ts`')).toEqual([{ kind: 'code', text: 'ls *.ts' }]);
  });
});
