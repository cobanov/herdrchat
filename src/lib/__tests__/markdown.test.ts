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
      { kind: 'table', headers: ['a', 'b'], align: [null, 'center'], rows: [['1', '2'], ['3', '4']] },
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

  // An address pasted into prose is a link, as in every chat app; the sentence
  // around it stays prose.
  it('links a bare address and keeps its trailing punctuation as prose', () => {
    expect(parseInline('see https://github.com/cobanov/herdrchat/pull/161.')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'https://github.com/cobanov/herdrchat/pull/161', href: 'https://github.com/cobanov/herdrchat/pull/161' },
      { kind: 'text', text: '.' },
    ]);
    expect(parseInline('(http://x.dev/a?b=1&c=2), then')).toEqual([
      { kind: 'text', text: '(' },
      { kind: 'link', text: 'http://x.dev/a?b=1&c=2', href: 'http://x.dev/a?b=1&c=2' },
      { kind: 'text', text: '), then' },
    ]);
  });
  it('keeps balanced parentheses in a bare address', () => {
    expect(parseInline('https://en.wikipedia.org/wiki/Rust_(programming_language) is it')).toEqual([
      { kind: 'link', text: 'https://en.wikipedia.org/wiki/Rust_(programming_language)', href: 'https://en.wikipedia.org/wiki/Rust_(programming_language)' },
      { kind: 'text', text: ' is it' },
    ]);
  });
  it('drops the brackets of an angle-bracket address', () => {
    expect(parseInline('at <https://x.dev/>.')).toEqual([
      { kind: 'text', text: 'at ' },
      { kind: 'link', text: 'https://x.dev/', href: 'https://x.dev/' },
      { kind: 'text', text: '.' },
    ]);
  });
  it('leaves an address inside a code span or a markdown link alone', () => {
    expect(parseInline('`curl https://x.dev`')).toEqual([{ kind: 'code', text: 'curl https://x.dev' }]);
    expect(parseInline('[docs](https://x.dev/docs)')).toEqual([{ kind: 'link', text: 'docs', href: 'https://x.dev/docs' }]);
  });
  it('links only web addresses', () => {
    expect(parseInline('ftp://x.dev and file:///etc/hosts')).toEqual([{ kind: 'text', text: 'ftp://x.dev and file:///etc/hosts' }]);
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

// A table is drawn as columns, so a cell landing in the wrong column moves the
// rest of its row: these are the ways a row used to come out skewed.
describe('table cells', () => {
  const table = (text: string) => {
    const block = parseMarkdown(text)[0];
    if (block?.kind !== 'table') throw new Error(`not a table: ${JSON.stringify(block)}`);
    return block;
  };

  it('reads each column\'s alignment', () => {
    expect(table('| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |').align).toEqual([
      'left', 'center', 'right', null,
    ]);
  });

  it('gives every row one cell per header', () => {
    expect(table('| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 |').rows).toEqual([
      ['1', '', ''],
      ['1', '2', '3'],
    ]);
  });

  // GFM would drop the extra cells. They are nearly always a stray pipe in the
  // last cell's text, so they go back into it rather than vanishing.
  it('keeps a long row\'s extra cells in its last column', () => {
    expect(table('| cmd | does |\n|---|---|\n| ls | lists | then pipes |').rows).toEqual([
      ['ls', 'lists | then pipes'],
    ]);
  });

  it('treats an escaped pipe as text', () => {
    expect(table('| op | means |\n|---|---|\n| a \\| b | either |').rows).toEqual([
      ['a | b', 'either'],
    ]);
  });

  it('does not split inside a code span', () => {
    expect(table('| type | note |\n|---|---|\n| `\'a\' | \'b\'` | a union |\n| ``x | `y` | z`` | nested |').rows).toEqual([
      ["`'a' | 'b'`", 'a union'],
      ['``x | `y` | z``', 'nested'],
    ]);
  });

  it('unescapes a pipe inside a code span, as GFM does', () => {
    expect(table('| cmd |\n|---|\n| `ls \\| wc` |').rows).toEqual([['`ls | wc`']]);
  });

  // An unclosed backtick is a character, not the start of a span that eats the
  // rest of the row.
  it('splits after an unclosed backtick', () => {
    expect(table('| a | b |\n|---|---|\n| `open | shut |').rows).toEqual([['`open', 'shut']]);
  });

  it('keeps markup in a cell for the renderer to format', () => {
    expect(table('| **Name** | [Docs](https://x.dev) |\n|---|---|').headers).toEqual([
      '**Name**', '[Docs](https://x.dev)',
    ]);
  });
});
