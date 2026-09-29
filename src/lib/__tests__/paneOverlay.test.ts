import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { overlayOptionKeys, overlayScaleKeys, parsePaneOverlay } from '../transcript/paneOverlay';

// Unedited `pane.read` captures from Claude Code 2.1.285. If Claude redraws
// these panels, this is where it shows.
const screen = (name: string) => readFileSync(join(__dirname, 'fixtures/screens', name), 'utf8');

describe('slash command panels', () => {
  it('reads the model picker: rows, the tick, the cursor and both ways to commit', () => {
    const overlay = parsePaneOverlay(screen('claude-model-picker.txt'))!;
    expect(overlay.title).toBe('Select model');
    expect(overlay.options.map((option) => option.label)).toEqual([
      'Default (recommended)',
      'Opus',
      'Fable',
      'Sonnet',
      'Haiku',
    ]);
    expect(overlay.options[0]).toMatchObject({ current: true, highlighted: false });
    expect(overlay.options[2]).toMatchObject({ highlighted: true, detail: expect.stringContaining('Fable 5.1') });
    expect(overlay.adjust).toEqual({ label: 'High effort (default)' });
    expect(overlay.actions).toEqual([
      { keys: ['Enter'], key: 'Enter', label: 'Set as default' },
      { keys: ['s'], key: 's', label: 'Use this session only' },
      { keys: ['Escape'], key: 'Esc', label: 'Cancel' },
    ]);
    // Wrapped description lines read as one sentence.
    expect(overlay.notes).toEqual([expect.stringMatching(/model names, specify with --model\.$/)]);
  });

  // A digit commits the row AND saves it as the default, so a tap only moves.
  it('moves the cursor to a row rather than typing its number', () => {
    const overlay = parsePaneOverlay(screen('claude-model-picker.txt'))!;
    expect(overlayOptionKeys(overlay, overlay.options[4]!)).toEqual(['Down', 'Down']);
    expect(overlayOptionKeys(overlay, overlay.options[0]!)).toEqual(['Up', 'Up']);
    expect(overlayOptionKeys(overlay, overlay.options[2]!)).toEqual([]);
    const lost = { ...overlay, options: overlay.options.map((option) => ({ ...option, highlighted: false })) };
    expect(overlayOptionKeys(lost, overlay.options[1]!)).toBeNull();
  });

  it('reads the effort slider and where its marker sits', () => {
    const overlay = parsePaneOverlay(screen('claude-effort-slider.txt'))!;
    expect(overlay.title).toBe('Effort');
    expect(overlay.options).toEqual([]);
    expect(overlay.scale).toEqual({ levels: ['low', 'medium', 'high', 'xhigh', 'max'], current: 2 });
    expect(overlay.notes).toEqual(['Ultracode off']);
    expect(overlay.actions.map((action) => [action.key, action.label])).toEqual([
      ['Tab', 'Toggle Ultracode'],
      ['Enter', 'Confirm'],
      ['s', 'This session only'],
      ['Esc', 'Cancel'],
    ]);
    expect(overlayScaleKeys(overlay, 4)).toEqual(['Right', 'Right']);
    expect(overlayScaleKeys(overlay, 0)).toEqual(['Left', 'Left']);
  });

  it('finds nothing once the panel has closed', () => {
    expect(parsePaneOverlay(screen('claude-idle-after-command.txt'))).toBeNull();
  });

  // Numbered menus without the panel frame are someone else's: a permission
  // prompt belongs to the blocked bar, and prose to the chat.
  it.each(['permission-bash.txt', 'trust.txt', 'ask-plain-numbered-description.txt', 'codex-approval.txt'])(
    'does not claim %s',
    (name) => {
      expect(parsePaneOverlay(screen(name))).toBeNull();
    }
  );

  it('needs the rule above the hint, not just a hint', () => {
    expect(parsePaneOverlay('Pick one\n1. a\n2. b\nEsc to cancel')).toBeNull();
    expect(parsePaneOverlay('Esc to cancel\n▔▔▔▔▔▔▔▔▔▔\n Title')).toBeNull();
  });

  it('reads an information panel as a title and its lines', () => {
    const overlay = parsePaneOverlay(
      ['▔▔▔▔▔▔▔▔▔▔▔▔ ● high · /effort ▔', '   Settings  Status   Usage', '', '   Total cost:            $0.0000', '   Total duration (API):  0s', '', '   Esc to cancel'].join('\n')
    )!;
    expect(overlay.title).toBe('Settings Status Usage');
    expect(overlay.notes).toEqual(['Total cost: $0.0000', 'Total duration (API): 0s']);
    expect(overlay.actions).toEqual([{ keys: ['Escape'], key: 'Esc', label: 'Cancel' }]);
  });
});

// A Max plan's model list is longer than the panel: rows below the fold are
// marked with a scroll arrow instead of the cursor.
it('keeps a row marked with a scroll arrow', () => {
  const overlay = parsePaneOverlay(
    ['▔▔▔▔▔▔▔▔▔▔', '   Select model', '   ❯ 9.  Opus 4.8     Best', '   ↓ 10. Opus 4.7     Best', '      … +2 models', '   Enter to set as default · Esc to cancel'].join('\n')
  )!;
  expect(overlay.options.map((option) => [option.number, option.label, option.highlighted])).toEqual([
    [9, 'Opus 4.8', true],
    [10, 'Opus 4.7', false],
  ]);
  expect(overlay.notes).toEqual(['… +2 models']);
});

// Measured on 2.1.285: "Use this session only" on a new model asks again,
// and that panel has no hint line.
it('reads the confirmation that follows a model pick', () => {
  const overlay = parsePaneOverlay(screen('claude-model-switch-confirm.txt'))!;
  expect(overlay.title).toBe('Switch model?');
  expect(overlay.options.map((option) => [option.label, option.highlighted])).toEqual([
    ['Yes, switch to Sonnet 5.5', true],
    ['No, go back', false],
  ]);
  expect(overlay.actions.map((action) => action.label)).toEqual(['Confirm', 'Cancel']);
});
