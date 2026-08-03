import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  launchCommand,
  permissionModeCopy,
} from '../herdr/permissionMode';

/**
 * The launch command is the whole feature: a wrong flag value doesn't error, it
 * silently starts the agent in a different permission mode than the one the user
 * picked. These strings were checked against `claude --help` on Claude Code
 * v2.1.220, whose accepted choices are acceptEdits, auto, bypassPermissions,
 * manual, dontAsk and plan.
 */
describe('permission modes', () => {
  it('only emits flag values the CLI accepts', () => {
    // Anything not in this set makes `claude` exit with a usage error.
    const accepted = new Set(['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan']);
    for (const mode of PERMISSION_MODES) {
      expect(accepted.has(mode)).toBe(true);
    }
  });

  it('builds the full invocation', () => {
    expect(launchCommand('bypassPermissions')).toBe('claude --permission-mode bypassPermissions');
    expect(launchCommand('plan', '/opt/bin/claude')).toBe(
      '/opt/bin/claude --permission-mode plan'
    );
  });

  /**
   * `manual` must be passed explicitly rather than omitted: the host's own
   * settings can set a different default, so a chat started as "Ask every time"
   * would otherwise silently inherit something more permissive.
   */
  it('states manual explicitly instead of implying it', () => {
    expect(launchCommand('manual')).toContain('--permission-mode manual');
  });

  /**
   * Phone-first default. If this ever flips, every new chat starts asking for
   * confirmation on each tool call — the complaint that created this type.
   */
  it('defaults to full access', () => {
    expect(DEFAULT_PERMISSION_MODE).toBe('bypassPermissions');
    expect(PERMISSION_MODES[0]).toBe('bypassPermissions');
  });

  it('gives every mode distinct, presentable copy', () => {
    const titles = new Set<string>();
    for (const mode of PERMISSION_MODES) {
      const copy = permissionModeCopy(mode);
      expect(copy.title).not.toHaveLength(0);
      expect(copy.detail).not.toHaveLength(0);
      expect(copy.symbol).not.toHaveLength(0);
      titles.add(copy.title);
    }
    expect(titles.size).toBe(PERMISSION_MODES.length);
  });
});
