import { act, renderHook } from '@testing-library/react-native';

import { HerdrClient } from '@/lib/herdr/client';
import type { AgentInfo } from '@/lib/herdr/models';
import type { HerdrTransport } from '@/lib/herdr/transport';

import { useIntegrationInstall } from '../useIntegrationInstall';

const agent = (kind: string): AgentInfo => ({
  agent: kind, agentStatus: 'idle', cwd: '/w', foregroundCwd: null, focused: true, paneId: `${kind}-pane`, tabId: 't',
  terminalId: null, workspaceId: 'w', agentSession: null, stateChangeSeq: null, completionSeq: null,
  inputPending: false, name: null, title: null,
});

// herdr has no Gemini integration and keeps no session reported for Gemini
// (herdr 0.9.5), so there is nothing to install for it; a hook that reported one
// changed the person's settings for nothing.
it("offers nothing for Gemini, and herdr's integration for the rest", async () => {
  const transport: HerdrTransport = {
    exec: async () => ({ ok: true, stdout: '', stderr: '', exitCode: 0 }),
    streamLines: async function* () {},
  };
  const client = new HerdrClient(transport);
  const integration = jest.spyOn(client, 'installIntegration').mockResolvedValue();

  const gemini = await renderHook(() => useIntegrationInstall(client, [agent('gemini')]));
  expect(gemini.result.current.agentKind).toBeNull();
  expect(gemini.result.current.install).toBeUndefined();

  // A Claude chat waiting for its session beside a Gemini screen installs Claude's.
  const claude = await renderHook(() => useIntegrationInstall(client, [agent('gemini'), agent('claude')]));
  await act(async () => { claude.result.current.install?.(); });
  expect(integration).toHaveBeenCalledWith('claude');

  const none = await renderHook(() => useIntegrationInstall(client, [agent('opencode')]));
  expect(none.result.current.install).toBeUndefined();
});
