import { act, renderHook } from '@testing-library/react-native';

import type { AgentInfo } from '@/lib/herdr/models';
import { SLASH_SCAN_AFTER_OPEN_DELAY_MS } from '@/lib/herdr/timeouts';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { emptyCatalogueCache } from '@/lib/slashCommands';
import { resetSlashCataloguesSession, useSlashCatalogues } from '@/state/slashCommands';
import { paletteAgent, useProjectSlashScan, useSlashCommands } from '../useSlashCommands';

const mockScan = jest.fn(async (_connectionId: string, _transport: unknown, _ask: unknown) => undefined);
jest.mock('@/state/slashCommands', () => {
  const actual = jest.requireActual('@/state/slashCommands');
  return {
    ...actual,
    scanSlashCatalogue: (connectionId: string, transport: unknown, ask: unknown) => mockScan(connectionId, transport, ask),
  };
});

const transport = {} as HerdrTransport;
const agent = (over: Partial<AgentInfo>) => ({ agent: 'claude', focused: false, cwd: '/p', ...over }) as AgentInfo;

beforeEach(() => {
  jest.useFakeTimers();
  mockScan.mockClear();
  resetSlashCataloguesSession();
});
afterEach(() => jest.useRealTimers());

describe('paletteAgent', () => {
  it('is the agent the thread sends to: the focused one, else the first', () => {
    expect(paletteAgent([agent({ agent: 'claude', cwd: '/a' }), agent({ agent: 'codex', focused: true, cwd: '/b' })]))
      .toEqual({ kind: 'codex', cwd: '/b' });
    expect(paletteAgent([agent({ agent: null }), agent({ agent: 'claude', cwd: '/a' })])).toEqual({ kind: 'claude', cwd: '/a' });
  });

  it('has none for OMP, a plain pane, or no agent yet', () => {
    expect(paletteAgent([agent({ agent: 'omp' })])).toBeNull();
    expect(paletteAgent([agent({ agent: null })])).toBeNull();
    expect(paletteAgent([])).toBeNull();
  });
});

describe('useSlashCommands', () => {
  it('offers the static built-ins before any scan, and what the scan found after', async () => {
    const { result } = await renderHook(() => useSlashCommands('h1', 'claude', '/p'));
    expect(result.current.map((c) => c.name)).toContain('model');
    expect(result.current.map((c) => c.name)).not.toContain('mine');
    await act(async () => {
      useSlashCatalogues.getState().set('h1', {
        ...emptyCatalogueCache(),
        projects: { '/p': [{ name: 'mine', description: '', argumentHint: null, section: 'commands', source: 'project' }] },
      });
    });
    expect(result.current.map((c) => c.name)).toContain('mine');
  });

  it('offers nothing for an agent with no catalogue', async () => {
    const { result } = await renderHook(() => useSlashCommands('h1', null, '/p'));
    expect(result.current).toEqual([]);
  });
});

// b704ec8 scanned on every thread open, ahead of the transcript read.
describe('useProjectSlashScan', () => {
  it('scans the folder a moment after the first window, never before', async () => {
    let ready = false;
    const { rerender } = await renderHook(() => useProjectSlashScan('h1', transport, 'claude', '/p', ready));
    await act(async () => { await jest.advanceTimersByTimeAsync(SLASH_SCAN_AFTER_OPEN_DELAY_MS * 2); });
    expect(mockScan).not.toHaveBeenCalled();
    ready = true;
    await rerender({});
    await act(async () => { await jest.advanceTimersByTimeAsync(SLASH_SCAN_AFTER_OPEN_DELAY_MS - 1); });
    expect(mockScan).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(mockScan).toHaveBeenCalledWith('h1', transport, { host: false, cwds: ['/p'] });
  });

  it('never scans a folder already scanned, a Codex chat, or one left before the delay', async () => {
    useSlashCatalogues.getState().set('h1', { ...emptyCatalogueCache(), projects: { '/p': [] } });
    const scanned = await renderHook(() => useProjectSlashScan('h1', transport, 'claude', '/p', true));
    const codex = await renderHook(() => useProjectSlashScan('h1', transport, 'codex', '/q', true));
    const left = await renderHook(() => useProjectSlashScan('h1', transport, 'claude', '/r', true));
    await left.unmount();
    await act(async () => { await jest.advanceTimersByTimeAsync(SLASH_SCAN_AFTER_OPEN_DELAY_MS * 2); });
    expect(mockScan).not.toHaveBeenCalled();
    await scanned.unmount();
    await codex.unmount();
  });
});
