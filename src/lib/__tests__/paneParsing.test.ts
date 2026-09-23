import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  blockedPromptSignature,
  isBlockedPromptEmpty,
  isMentionPopup,
  optionKeys,
  parseBlockedPrompt,
} from '../transcript/blockedPrompt';
import { extractLivePreview } from '../transcript/livePreview';
import { shellCommand, shellQuote, withPath } from '../herdr/shell';

/**
 * Both of these read a terminal's visible screen, which is the least structured
 * input in the app. The rule they share: when in doubt, return nothing. A wrong
 * quick-reply label sends the wrong key, and a wrong live preview reads as the
 * agent's actual answer.
 */

/**
 * Spelled out rather than typed as the bytes themselves. A literal 0x1B is
 * invisible in every editor and diff view — which is how the fixture below
 * ("strips ANSI colour before matching") could contain a real escape while the
 * regex it tested had lost one, and nobody could see the difference.
 */
const ESC = '\u001b';
const BEL = '\u0007';

const PERMISSION_PROMPT = [
  '╭──────────────────────────────────────────╮',
  '│ Bash command                             │',
  '│                                          │',
  '│ rm -rf build/                            │',
  '│ Delete the build directory               │',
  '│                                          │',
  '│ Do you want to proceed?                  │',
  '│ ❯ 1. Yes                                 │',
  '│   2. Yes, and don’t ask again            │',
  '│   3. No, tell Claude what to do (esc)    │',
  '╰──────────────────────────────────────────╯',
].join('\n');

describe('blocked prompt parsing', () => {
  it('reads the question and every labelled option', () => {
    const prompt = parseBlockedPrompt(PERMISSION_PROMPT);

    expect(prompt.question).toBe('Do you want to proceed?');
    expect(prompt.options).toEqual([
      { number: 1, label: 'Yes' },
      { number: 2, label: 'Yes, and don’t ask again' },
      { number: 3, label: 'No, tell Claude what to do' },
    ]);
  });

  it('submits a choice by number then Enter', () => {
    expect(optionKeys({ number: 2, label: 'Yes' })).toEqual(['2', 'Enter']);
  });

  // There is no way to type "10" into one of these menus, and both previous
  // attempts committed the WRONG option: "10" as a single key landed as a bare
  // "1", and one-key-per-digit selected option 1 and then submitted a stray "0"
  // into the composer. Refusing is the only answer that cannot be wrong.
  it('refuses a choice it cannot type instead of sending the wrong one', () => {
    expect(optionKeys({ number: 10, label: 'Tenth' })).toBeNull();
    expect(optionKeys({ number: 11, label: 'Eleventh' })).toBeNull();
  });

  it('accepts every single-digit choice, and nothing outside that', () => {
    for (let number = 1; number <= 9; number += 1) {
      expect(optionKeys({ number, label: 'x' })).toEqual([String(number), 'Enter']);
    }
    // A menu never numbers from zero, and a negative is a parse that went wrong
    // — neither should be handed to a live agent on the strength of a guess.
    expect(optionKeys({ number: 0, label: 'Zeroth' })).toBeNull();
    expect(optionKeys({ number: -1, label: 'Broken' })).toBeNull();
  });

  it('strips ANSI colour before matching', () => {
    const coloured = `${ESC}[1m❯ 1.${ESC}[0m Yes\n  2. No`;
    expect(parseBlockedPrompt(coloured).options).toHaveLength(2);
  });

  // Scrollback keeps old menus around. Answering the previous question with this
  // question's key is exactly the kind of mistake that is invisible until it
  // does something destructive.
  it('keeps the last menu when an older one lingers above it', () => {
    const raw = [
      'Earlier question?',
      '  1. Old A',
      '  2. Old B',
      '',
      'Current question?',
      '❯ 1. New A',
      '  2. New B',
    ].join('\n');

    const prompt = parseBlockedPrompt(raw);
    expect(prompt.question).toBe('Current question?');
    expect(prompt.options.map((option) => option.label)).toEqual(['New A', 'New B']);
  });

  // No menu means the UI shows generic chips. Inventing options would be worse.
  it('returns nothing when there is no menu', () => {
    expect(isBlockedPromptEmpty(parseBlockedPrompt('just some output\nand more'))).toBe(true);
    expect(isBlockedPromptEmpty(parseBlockedPrompt(''))).toBe(true);
  });

  it('is not fooled by prose that merely contains digits', () => {
    expect(parseBlockedPrompt('I found 3 errors\nand 2 warnings').options).toHaveLength(0);
  });

  // herdr's own rule for Codex's `@` picker: all three tab labels at once (#120).
  it('recognises the Codex mention picker only by all three of its tabs', () => {
    expect(isMentionPopup('@src\n All Results  Filesystem Only  Plugins\n 1. a.ts')).toBe(true);
    expect(isMentionPopup('Search the Plugins folder for All Results')).toBe(false);
  });
});

/**
 * Real screens, captured with `herdr pane read --source visible` from Claude
 * Code 2.1.280 and Codex 0.154 running in a herdr 0.9.1 pane (#107). Paths and
 * host names are replaced; nothing else is.
 */
const screen = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', 'screens', `${name}.txt`), 'utf8');
const labels = (name: string) => parseBlockedPrompt(screen(name)).options.map((o) => `${o.number}. ${o.label}`);

describe('captured menus', () => {
  // A description that starts "1." reset the menu and took option 1's place,
  // and the question went with it.
  it('reads an AskUserQuestion whose description starts with a number', () => {
    const prompt = parseBlockedPrompt(screen('ask-plain-numbered-description'));
    expect(prompt.question).toBe('Which database should the service use?');
    expect(labels('ask-plain-numbered-description')).toEqual([
      '1. Postgres', '2. SQLite', '3. DynamoDB', '4. Type something.', '5. Chat about this',
    ]);
  });

  it('keeps a preview panel out of the labels', () => {
    expect(parseBlockedPrompt(screen('ask-preview')).question).toBe('Which layout should the settings page use?');
    expect(labels('ask-preview')).toEqual(['1. Cards', '2. List']);
  });

  it('reads a multi-select question as ticks, not labels with boxes in them', () => {
    const prompt = parseBlockedPrompt(screen('ask-multiselect'));
    expect(prompt.multiSelect).toBe(true);
    expect(prompt.options.slice(0, 3)).toEqual([
      { number: 1, label: 'Type check', checked: false },
      { number: 2, label: 'Lint', checked: false },
      { number: 3, label: 'Unit tests', checked: false },
    ]);
    // Its review is an ordinary menu.
    const review = parseBlockedPrompt(screen('ask-multiselect-review'));
    expect(review.question).toBe('Ready to submit your answers?');
    expect(review.multiSelect).toBeUndefined();
  });

  // Ticking changes nothing but the box, and the reply must not look
  // undelivered for the whole pending timeout.
  it('changes signature when a row is ticked', () => {
    const before = parseBlockedPrompt(screen('ask-multiselect'));
    const after = parseBlockedPrompt(screen('ask-multiselect').replace('2. [ ] Lint', '2. [✔] Lint'));
    expect(after.options[1]?.checked).toBe(true);
    expect(blockedPromptSignature(after)).not.toBe(blockedPromptSignature(before));
  });

  it('keeps a wrapped permission option to its first line', () => {
    expect(parseBlockedPrompt(screen('permission-bash')).question).toBe('Do you want to proceed?');
    expect(labels('permission-bash')).toEqual(['1. Yes', '2. Yes, and always allow access to', '3. No']);
  });

  // `›` was not a known cursor, so Codex's highlighted first option vanished.
  it("reads Codex's menus, highlighted option included, without shortcut letters", () => {
    expect(labels('codex-approval')).toEqual([
      '1. Yes, proceed',
      "2. Yes, and don't ask again for commands that start with `date +%s > stamp2.txt`",
      '3. No, and tell Codex what to do differently',
    ]);
    expect(labels('codex-trust')).toEqual(['1. Yes, continue', '2. No, quit']);
  });

  // Claude's folder-trust dialog has no numbers at all. Better no options (the
  // generic chips) than a guess.
  it('offers nothing for an unnumbered menu', () => {
    expect(isBlockedPromptEmpty(parseBlockedPrompt(screen('trust')))).toBe(true);
  });
});

describe('option keys', () => {
  const option = { number: 2, label: 'SQLite' };
  it('sends the digit alone where it is the answer', () => {
    expect(optionKeys(option, { submitWithEnter: false })).toEqual(['2']);
    expect(optionKeys({ ...option, checked: false }, { multiSelect: true })).toEqual(['2']);
  });
  it('adds Enter for agents that need it, and by default', () => {
    expect(optionKeys(option, { submitWithEnter: true })).toEqual(['2', 'Enter']);
    expect(optionKeys(option)).toEqual(['2', 'Enter']);
  });
});

describe('live preview extraction', () => {
  it('does not duplicate a long Codex tool block as a live answer', () => {
    const screen = [
      '• Ran a command', ...Array.from({ length: 15 }, (_, i) => `command output line ${i}`),
      '', '• Working (40s • esc to interrupt)', '', '⠁         ⢀      ⠄',
      '› Ask Codex to do anything', '⠁       ⢀   ⠄',
      'gpt-6-astra xhigh · project · ← for agents',
    ].join('\n');
    expect(extractLivePreview(screen)).toBeNull();
    expect(extractLivePreview(screen.replace('command output line 10', '\nWaiting for flows to complete...'))).toBeNull();
    expect(extractLivePreview(screen.replace('• Ran', '• Running'))).toBeNull();
    expect(extractLivePreview(screen.replace(/• Ran a command[\s\S]*?\n\n/, '• The real answer should stay visible.\n\n')))
      .toBe('• The real answer should stay visible.');
  });
  it('ignores the standalone Codex braille animation without dropping real prose', () => {
    const dots = '⠁             ⠄                 ⠁ ⢀\n       ⢀⠐        ⠄           ⡀';
    expect(extractLivePreview(dots)).toBeNull();
    expect(extractLivePreview('The real answer should stay visible.\n' + dots)).toBe('The real answer should stay visible.');
  });
  it('removes the Codex queued-input panel and its whole footer', () => {
    const footer = '\n• Queued follow-up inputs\n? 5 questions\n⌥ + ↑ to answer\n·   ·\n› Ask Codex to do anything';
    expect(extractLivePreview(footer)).toBeNull();
    expect(extractLivePreview('The real answer should stay visible.' + footer)).toBe('The real answer should stay visible.');
  });
  it('takes the prose above the spinner line', () => {
    const screen = [
      '⏺ Looking at the transcript parser now, the byte window is the part that matters.',
      '',
      '✳ Thinking… (12s · ↓ 1.2k tokens)',
      '',
      '❯ ',
    ].join('\n');

    expect(extractLivePreview(screen)).toBe(
      'Looking at the transcript parser now, the byte window is the part that matters.'
    );
  });

  // Below the prose threshold it is almost certainly chrome that slipped
  // through, and showing it as the agent's answer would be a lie.
  it('returns null rather than surface a scrap', () => {
    expect(extractLivePreview('✳ Thinking…\n❯ ')).toBeNull();
    expect(extractLivePreview('ok\n✳ Thinking…')).toBeNull();
    expect(extractLivePreview('')).toBeNull();
  });

  /**
   * Caught in the running app: herdr's own footer was rendering as the agent's
   * in-progress answer. The chrome check missed it because the fields are
   * separated by box-drawing bars, not ASCII pipes.
   */
  it('drops a status bar whose fields are separated by box-drawing bars', () => {
    const screen = [
      'dev@mac-mini │ herdrchat │ main │ Opus 5 (1M context) │ ctx:47%',
      '✳ Working…',
    ].join('\n');
    expect(extractLivePreview(screen)).toBeNull();
  });

  /**
   * The regression this file existed to catch and didn't. `livePreview` had its
   * own copy of the ANSI pattern with the escape byte missing, so it reduced to
   * "[ followed by a letter" and ate bracketed prose — while leaving the real
   * escape byte in the output. Both halves are asserted.
   */
  it('leaves bracketed prose alone', () => {
    const screen = [
      '⏺ I checked the [TODO] list and the [README](docs/readme.md) link is stale.',
      '✳ Working… (1.2k tokens)',
    ].join('\n');

    expect(extractLivePreview(screen)).toBe(
      'I checked the [TODO] list and the [README](docs/readme.md) link is stale.'
    );
  });

  it('strips real escape sequences without leaving the escape byte behind', () => {
    const screen = [
      `${ESC}[1m⏺ The refactor is complete and every test now passes cleanly.${ESC}[0m`,
      `${ESC}[2m✳ Working… (900 tokens)${ESC}[0m`,
    ].join('\n');

    const preview = extractLivePreview(screen);
    expect(preview).toBe('The refactor is complete and every test now passes cleanly.');
    expect(preview).not.toContain(ESC);
  });

  it('drops an OSC title sequence rather than treating its payload as prose', () => {
    const screen = [
      `${ESC}]0;herdrchat — zsh${BEL}⏺ Reading the transcript store to find the cursor drift.`,
      '✳ Working…',
    ].join('\n');

    expect(extractLivePreview(screen)).toBe(
      'Reading the transcript store to find the cursor drift.'
    );
  });

  it('drops the composer, mode hints and shortcut footers', () => {
    const screen = [
      'This is the real answer text, long enough to count as prose.',
      '? for shortcuts',
      'manual mode · ctrl+r to expand',
      '✳ Working…',
    ].join('\n');

    expect(extractLivePreview(screen)).toBe(
      'This is the real answer text, long enough to count as prose.'
    );
  });
});

describe('shell quoting', () => {
  // Every message a user types passes through here on its way into a command.
  it('neutralises a single quote', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("'; rm -rf / #")).toBe(`''\\''; rm -rf / #'`);
  });

  it('quotes each argv element separately', () => {
    expect(shellCommand(['herdr', 'pane', 'run', 'w7:p1', 'hello world'])).toBe(
      `'herdr' 'pane' 'run' 'w7:p1' 'hello world'`
    );
  });

  // Non-interactive SSH shells load no profile, so herdr's install dir isn't on
  // PATH and every command would exit 127 without this.
  it('spells out the full PATH rather than trusting the inherited one', () => {
    const prefixed = withPath('herdr api snapshot');
    expect(prefixed).toContain('$HOME/.local/bin');
    expect(prefixed).toContain('/opt/homebrew/bin');
    expect(prefixed).toContain('/usr/bin:/bin');
    expect(prefixed.endsWith('herdr api snapshot')).toBe(true);
  });
});
