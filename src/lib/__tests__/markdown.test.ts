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
    expect(parseMarkdown('1. a\n2. b')).toEqual([{ kind: 'numbered', start: 1, items: ['a', 'b'] }]);
  });

  it('keeps the starting number when a reply separates list items with blank lines', () => {
    expect(parseMarkdown('11. Before\n\n12. Last')).toEqual([
      { kind: 'numbered', start: 11, items: ['Before'] },
      { kind: 'numbered', start: 12, items: ['Last'] },
    ]);
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
  it.each(['javascript:alert', 'file:///private/test', 'intent://test', 'shortcuts://run-shortcut', '//host/path', 'docs/readme.md'])('keeps unsafe link %s readable but inert', href => {
    expect(parseInline(`[link](${href})`)).toEqual([{ kind: 'text', text: `link (${href})` }]);
  });
  it('keeps underscores inside identifiers literal', () => {
    expect(parseInline('CODEX_PHONE_OK and snake_case_name')).toEqual([
      { kind: 'text', text: 'CODEX_PHONE_OK and snake_case_name' },
    ]);
    expect(parseInline('_italic_')).toEqual([{ kind: 'italic', text: 'italic' }]);
    expect(parseInline('ürün_adı_test _italic_ **bold**')).toEqual([
      { kind: 'text', text: 'ürün_adı_test ' },
      { kind: 'italic', text: 'italic' },
      { kind: 'text', text: ' ' },
      { kind: 'bold', text: 'bold' },
    ]);
    expect(parseInline('_literal_suffix')).toEqual([
      { kind: 'text', text: '_literal_suffix' },
    ]);
  });
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

describe('fences and link targets (#108)', () => {
  it('keeps a three-backtick example inside a four-backtick block', () => {
    const text = ['````markdown', 'Use a fence:', '```js', 'x()', '```', '````', 'after'].join('\n');
    expect(parseMarkdown(text)).toEqual([
      { kind: 'code', language: 'markdown', content: 'Use a fence:\n```js\nx()\n```' },
      { kind: 'paragraph', text: 'after' },
    ]);
  });

  it('reads ~~~ fences', () => {
    expect(parseMarkdown('~~~sh\nls -la\n~~~')).toEqual([{ kind: 'code', language: 'sh', content: 'ls -la' }]);
  });

  it('is not closed by a fence of the other kind or with an info string', () => {
    expect(parseMarkdown('~~~\n```\nstill code\n~~~')).toEqual([
      { kind: 'code', language: null, content: '```\nstill code' },
    ]);
  });

  it('keeps balanced parentheses in a link target', () => {
    expect(parseInline('see [Rust](https://en.wikipedia.org/wiki/Rust_(programming_language)) here')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'Rust', href: 'https://en.wikipedia.org/wiki/Rust_(programming_language)' },
      { kind: 'text', text: ' here' },
    ]);
  });
});
