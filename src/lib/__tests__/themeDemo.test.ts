import { darkPalette, lightPalette } from '@/theme/tokens';
import { HerdrClient } from '../herdr/client';
import { DemoHost } from '../demo/host';
import { DEMO_SESSION_IDS, DEMO_WORKSPACES } from '../demo/fixtures';
import { displayText } from '../transcript/message';
import { TranscriptStore } from '../transcript/store';
import { DEMO_PHRASES, DEMO_THEME_REPLY, DEMO_THEME_TEXT } from '../demo/scenarios';
import { bootstrapCommand, bootstrapFiles } from '../theme/bootstrap';
import { afterFetch, knownMtime, parseThemeFetch, themeFetchCommand, themeResetCommand } from '../theme/hostTheme';
import { resolveHostTheme, type HostThemeFile } from '../theme/resolve';

const base = { light: lightPalette, dark: darkPalette };

/** A host whose clock the test moves, so the agent's reply lands on demand. */
function demo() {
  let now = Date.parse('2026-10-08T12:00:00Z');
  const host = new DemoHost(() => now);
  return { host, advance: (ms: number) => { now += ms; } };
}

/** The notes chat's messages, read by the real reader. */
async function notesMessages(host: DemoHost) {
  const store = new TranscriptStore(host);
  const workspace = DEMO_WORKSPACES[1]!;
  const path = store.sessionTranscriptPath(await store.homeDirectory(), workspace.cwd, DEMO_SESSION_IDS[workspace.paneId]!);
  return (await store.recent(path!, 'claude', 262_144)).messages;
}

async function check(host: DemoHost, held: HostThemeFile): Promise<HostThemeFile> {
  const result = await host.exec(themeFetchCommand(knownMtime(held)), 5_000);
  expect(result.ok).toBe(true);
  const parsed = parseThemeFetch(result.ok ? result.stdout : '', knownMtime(held));
  expect(parsed).not.toBeNull();
  return afterFetch(held, parsed!);
}

describe('the Demo host’s theme', () => {
  it('has no theme file, so every other flow looks as it always has', async () => {
    const { host } = demo();
    await expect(check(host, { kind: 'missing' })).resolves.toEqual({ kind: 'missing' });
  });

  it('keeps the bootstrap files in memory and never rewrites one', async () => {
    const { host } = demo();
    await host.exec(bootstrapCommand(), 5_000);
    for (const { name, text } of bootstrapFiles()) expect(host.hostFile(name)).toBe(text);
    expect(host.hostFile('theme.json')).toBeNull();
  });

  it('plays an agent writing a theme, which the phone then fetches', async () => {
    const { host, advance } = demo();
    await new HerdrClient(host).sendPrompt('w2:p1', `please ${DEMO_PHRASES.theme}`);

    // Not before the reply lands: the agent has not written it yet.
    expect(await check(host, { kind: 'missing' })).toEqual({ kind: 'missing' });

    advance(2_000);
    const held = await check(host, { kind: 'missing' });
    expect(held).toMatchObject({ kind: 'present', text: DEMO_THEME_TEXT });
    const resolved = resolveHostTheme(held, base);
    expect(resolved.name).toBe('Demo dusk');
    expect(resolved.problems).toEqual([]);
    expect(resolved.overrides.light?.tint).toBe('#B5562F');

    // Unchanged from then on, until it changes.
    expect(await check(host, held)).toBe(held);

    // And the agent said so in the chat, after a Write to the file.
    const messages = await notesMessages(host);
    expect(displayText(messages.at(-1)!)).toBe(DEMO_THEME_REPLY);
    expect(JSON.stringify(messages.slice(-3))).toContain('/home/demo/.herdrchat/theme.json');
  });

  it('resets by renaming the file away, and a second write gets a newer mtime', async () => {
    const { host, advance } = demo();
    await new HerdrClient(host).sendPrompt('w2:p1', DEMO_PHRASES.theme);
    advance(2_000);
    const first = await check(host, { kind: 'missing' });

    await host.exec(themeResetCommand(), 5_000);
    expect(await check(host, first)).toEqual({ kind: 'missing' });
    expect(host.hostFile('theme.json.bak')).toBe(DEMO_THEME_TEXT);

    await new HerdrClient(host).sendPrompt('w2:p1', DEMO_PHRASES.theme);
    advance(2_000);
    const second = await check(host, { kind: 'missing' });
    expect(second.kind === 'present' && first.kind === 'present' && second.mtime > first.mtime).toBe(true);
  });
});
