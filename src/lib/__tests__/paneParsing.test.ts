import { isBlockedPromptEmpty, optionKeys, parseBlockedPrompt } from '../transcript/blockedPrompt';
import { extractLivePreview } from '../transcript/livePreview';
import { shellCommand, shellQuote, withPath } from '../herdr/shell';

/**
 * Both of these read a terminal's visible screen, which is the least structured
 * input in the app. The rule they share: when in doubt, return nothing. A wrong
 * quick-reply label sends the wrong key, and a wrong live preview reads as the
 * agent's actual answer.
 */

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

  it('strips ANSI colour before matching', () => {
    const coloured = '[1m❯ 1.[0m Yes\n  2. No';
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
});

describe('live preview extraction', () => {
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
