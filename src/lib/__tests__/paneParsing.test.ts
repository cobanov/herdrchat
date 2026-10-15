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
import { agentSpec } from '../herdr/agents';
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

  // Grok's permission prompt, as herdr's grok.toml quotes its rows: a `┃`
  // gutter, the key, a radio for the focused row. `1`–`9` answers it directly
  // (Grok's 03-keyboard-shortcuts.md), so no Enter follows the digit.
  it("reads Grok's radio rows and answers them with the digit alone", () => {
    const screen = [
      '◆ Run a shell command',
      '┃  npm test',
      '┃',
      '┃  1 (●) Yes, allow once',
      '┃  2 (○) Yes, and always allow npm test',
      '┃  3 (○) No, and tell Grok what to do differently',
      '┃  z (○) Type your answer here',
      '1/3:select │ Ctrl+o:yolo │ Ctrl+c:cancel',
    ].join('\n');
    const prompt = parseBlockedPrompt(screen);
    expect(prompt.options).toEqual([
      { number: 1, label: 'Yes, allow once' },
      { number: 2, label: 'Yes, and always allow npm test' },
      { number: 3, label: 'No, and tell Grok what to do differently' },
    ]);
    expect(prompt.question).toContain('npm test');
    expect(optionKeys(prompt.options[1]!, { ...prompt, submitWithEnter: agentSpec('grok')?.digitAnswers !== true })).toEqual(['2']);
    expect(agentSpec('codex')?.digitAnswers).not.toBe(true);
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
  readFileSync(join(__dirname, 'fixtures', 'screens', `${name}.txt`), 'utf8')
    // A fixture's provenance, where it is more than a plain capture.
    .replace(/^(?:#\| .*\n)+/, '');
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

  // Claude's folder-trust question has no numbers, a digit does nothing, and
  // the cursor starts on "No, exit": the generic Confirm closed Claude. Each
  // option carries the arrows to its row and Enter instead.
  it("answers Claude's folder-trust question with the cursor's own keys", () => {
    const prompt = parseBlockedPrompt(screen('trust'));
    expect(prompt.question).toBe(
      'Trust /home/me/work/askq? Claude Code will be able to read, edit and run files there.'
    );
    expect(prompt.unnumbered).toBe(true);
    expect(prompt.options.map((option) => [option.label, optionKeys(option, prompt)])).toEqual([
      ['No, exit', ['Enter']],
      ['Yes, I trust this folder', ['Down', 'Enter']],
    ]);
  });

  it('counts the arrows from wherever the cursor is', () => {
    const moved = screen('trust').replace('❯ No, exit', '  No, exit').replace('  Yes, I trust', '❯ Yes, I trust');
    const prompt = parseBlockedPrompt(moved);
    expect(prompt.options.map((option) => optionKeys(option, prompt))).toEqual([['Up', 'Enter'], ['Enter']]);
  });

  // A heading without the answer, or an unnumbered list without the heading,
  // is not the trust question, and a guess there sends Enter into something.
  it('offers nothing for any other unnumbered menu', () => {
    expect(isBlockedPromptEmpty(parseBlockedPrompt('Pick one\n❯ Apples\n  Pears\n'))).toBe(true);
    expect(isBlockedPromptEmpty(parseBlockedPrompt(screen('trust').replace('Yes, I trust this folder', 'Yes')))).toBe(true);
  });
});

/**
 * What is being approved. The phone showed only "Do you want to proceed?",
 * with the command, its description and Claude's warning cut off by the blank
 * line above the question, so nobody could tell what they were approving.
 *
 * `permission-bash-tip-120`, `permission-bash-tip-80`, `permission-heredoc-120`
 * and `permission-write-120` are captured from Claude Code 2.1.299;
 * `permission-bash-120` and `permission-bash-deadline-80` are written from
 * those captures and the shapes the maintainer captured on #170 (the auto-deny
 * line never appeared in a captured run), and each file's `#|` header says how.
 * `permission-bash` is a real 2.1.280 capture.
 */
describe('prompt details', () => {
  const COMMAND = 'mkdir -p cap && cd cap && for f in a b; do bash -c "echo $f > out-$f.txt && rm out-$f.txt"; done; date +%s';
  const NOTE = "A variable in this command can't be checked before it runs";

  // The dashed rules and the `│ ` margin frame the command; the Tip is Claude's
  // hint, not the prompt's description.
  it('reads a 2.1.299 Bash prompt: summary, the command alone, the note', () => {
    for (const name of ['permission-bash-tip-120', 'permission-bash-120']) {
      const prompt = parseBlockedPrompt(screen(name));
      expect(prompt.question).toBe('Do you want to proceed?');
      expect(prompt.details).toEqual({
        title: 'Bash command',
        summary: 'Create cap dir, write and remove two temp files, print epoch time',
        body: [COMMAND],
        notes: [NOTE],
        deadline: null,
      });
    }
    expect(labels('permission-bash-tip-120')).toEqual(['1. Yes', '2. Yes, and switch to auto mode · auto mode handles these prompts for you', '3. No']);
  });

  // At 80 columns the Tip and the command wrap, as Claude really draws them.
  it('joins what wrapped in a captured 80-column prompt', () => {
    const prompt = parseBlockedPrompt(screen('permission-bash-tip-80'));
    expect(prompt.question).toBe('Do you want to proceed?');
    expect(prompt.details).toEqual({
      title: 'Bash command',
      summary: 'Create cap directory, write and remove two temp files, print epoch time',
      body: [COMMAND],
      notes: [NOTE],
      deadline: null,
    });
    expect(labels('permission-bash-tip-80')).toEqual(['1. Yes', '2. Yes, and switch to auto mode · auto mode handles these prompts for you', '3. No']);
  });

  // The auto-deny line wraps too, and its deadline goes in the notes.
  it('joins what wrapped at 80 columns, and keeps the deadline in the notes', () => {
    const prompt = parseBlockedPrompt(screen('permission-bash-deadline-80'));
    expect(prompt.details).toEqual({
      title: 'Bash command',
      summary: 'Create and remove two temp files, then print epoch time',
      body: ['cd /home/me/work/cap && for f in a b; do bash -c "echo $f > out-$f.txt && rm out-$f.txt"; done; date +%s'],
      notes: [NOTE, '⚠ Claude Code will automatically deny this request in 1:32, to avoid blocking progress on an unattended session'],
      deadline: '1:32',
    });
  });

  // A second later Claude prints 1:31; the reply in flight must not read as
  // superseded and unlock its options.
  it('keeps its signature while the deadline ticks at 80 columns, and changes it for another command', () => {
    const now = parseBlockedPrompt(screen('permission-bash-deadline-80'));
    const later = parseBlockedPrompt(screen('permission-bash-deadline-80').replace('in 1:32,', 'in 1:31,'));
    expect(later.details?.deadline).toBe('1:31');
    expect(blockedPromptSignature(later)).toBe(blockedPromptSignature(now));
    const other = parseBlockedPrompt(screen('permission-bash-deadline-80').replace('date +%s', 'rm -rf ~'));
    expect(blockedPromptSignature(other)).not.toBe(blockedPromptSignature(now));
  });

  it('reads the deadline Claude prints when it rounds to minutes', () => {
    const rounded = screen('permission-bash-deadline-80').replace('in 1:32,', 'in about 2 minutes,');
    expect(parseBlockedPrompt(rounded).details?.deadline).toBe('about 2 minutes');
  });

  // The rule and the tool line have scrolled off: whatever is at the top is a
  // line of the command, and taking it for the title would misstate the prompt.
  it('gives no details, and says so, when the start of the prompt is off screen', () => {
    const prompt = parseBlockedPrompt(screen('permission-heredoc-120'));
    expect(prompt.question).toBe('Do you want to proceed?');
    expect(prompt.details).toBeNull();
    expect(prompt.detailsOffScreen).toBe(true);
    expect(labels('permission-heredoc-120')).toEqual([
      '1. Yes',
      '2. Yes, and always allow access to /home/me/work/cap from this project',
      '3. Yes, and switch to auto mode · auto mode handles these prompts for you',
      '4. No',
    ]);
    // The same, with the rule on screen but the tool line not.
    const ruled = screen('permission-heredoc-120').replace(' │ line 17 of the note', '─'.repeat(120));
    expect(parseBlockedPrompt(ruled).detailsOffScreen).toBe(true);
  });

  // The closing dashed rule sits right on top of the question.
  it('reads a Write prompt: its question alone, the file in the details', () => {
    const prompt = parseBlockedPrompt(screen('permission-write-120'));
    expect(prompt.question).toBe('Do you want to create new.txt?');
    expect(prompt.details).toEqual({
      title: 'Create file',
      summary: 'new.txt',
      body: ['1 alpha', '2 beta', '3 gamma'],
      notes: [],
      deadline: null,
    });
    expect(labels('permission-write-120')).toEqual([
      '1. Yes',
      '2. Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)',
      '3. No',
    ]);
  });

  // The description sits under the command there; copying the body must give
  // only the command, or pasting it would run the description as one.
  it('reads the older single-rule shape, command under a blank line', () => {
    expect(parseBlockedPrompt(screen('permission-bash')).details).toEqual({
      title: 'Bash command',
      summary: 'Get current Unix timestamp and write to stamp.txt',
      body: ['date +%s > stamp.txt'],
      notes: [],
      deadline: null,
    });
  });

  it('reads an older boxed prompt, its borders gone', () => {
    expect(parseBlockedPrompt(PERMISSION_PROMPT).details).toMatchObject({
      title: 'Bash command',
      summary: 'Delete the build directory',
      body: ['rm -rf build/'],
    });
  });

  // A real newline in a command is kept: only a line that ran to the edge wrapped.
  it('keeps a command’s own newlines', () => {
    const rule = '─'.repeat(80);
    const dashed = '╌'.repeat(80);
    const prompt = parseBlockedPrompt(
      [rule, ' Bash command', ' Two steps', dashed, ' │ npm ci', ' │ npm test', dashed, '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No'].join('\n')
    );
    expect(prompt.details?.body).toEqual(['npm ci', 'npm test']);
  });

  // A question with its options and no tool line: the question is the whole of it.
  it('has no details for an AskUserQuestion, a review, or the trust prompt', () => {
    for (const name of ['ask-plain-numbered-description', 'ask-preview', 'ask-multiselect', 'ask-multiselect-review', 'trust']) {
      const prompt = parseBlockedPrompt(screen(name));
      expect(prompt.details).toBeNull();
      expect(prompt.detailsOffScreen).toBeUndefined();
    }
    expect(parseBlockedPrompt('Pick one?\n❯ 1. A\n  2. B').details).toBeNull();
    // Prose with no rule above it is not a prompt's details, however long.
    const prose = Array.from({ length: 50 }, (_, index) => `line ${index}`);
    expect(parseBlockedPrompt([...prose, '', 'Do you want to proceed?', '❯ 1. Yes', '  2. No'].join('\n')).details).toBeNull();
  });

  // Codex's banner box closes long before its question; it is not the prompt.
  it('does not take a closed box or the conversation for the prompt', () => {
    expect(parseBlockedPrompt(screen('codex-approval')).details?.title).toBe('Would you like to run the following command?');
    expect(parseBlockedPrompt(screen('codex-trust')).details).toBeNull();
  });

  // Codex puts the command where the question goes and prose in the block: the
  // command is what goes in the box that copies, the reason is its summary.
  it('puts the command of a Codex approval in the body and its reason in the summary', () => {
    const prompt = parseBlockedPrompt(screen('codex-approval'));
    expect(prompt.question).toBe('$ date +%s > stamp2.txt');
    expect(prompt.details).toEqual({
      title: 'Would you like to run the following command?',
      summary: 'Environment: local\nReason: Do you allow me to write the current Unix timestamp to stamp2.txt?',
      body: ['date +%s > stamp2.txt'],
      notes: [],
      deadline: null,
    });
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
