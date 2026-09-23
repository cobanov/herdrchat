import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';

import { agentName } from '@/lib/herdr/agentName';
import type { HerdrClient } from '@/lib/herdr/client';
import type { WorkspaceCreation } from '@/lib/herdr/models';
import {
  DEFAULT_PERMISSION_MODE,
  isPermissionMode,
  launchArgs,
  launchCommand,
  type PermissionMode,
} from '@/lib/herdr/permissionMode';
import { HerdrError } from '@/lib/herdr/protocol';
import { getSetting, setSetting } from '@/state/db';

/** The agents a new chat can start. Both have full chat support once running. */
export type NewChatAgent = 'claude' | 'codex';

const isAgent = (value: unknown): value is NewChatAgent => value === 'claude' || value === 'codex';

export interface Remembered {
  cwd: string;
  mode: PermissionMode;
  agent: NewChatAgent;
}

/**
 * What a new chat on this host used last, read once per host. Each value is
 * kept per connection, so repeat use is one tap.
 */
export function useRemembered(connectionId: string | null): Remembered | null {
  const db = useSQLiteContext();
  const [remembered, setRemembered] = useState<Remembered | null>(null);
  useEffect(() => {
    let cancelled = false;
    const key = (name: string) => `${name}.${connectionId ?? 'none'}`;
    void (async () => {
      const [cwd, mode, agent] = await Promise.all([
        getSetting(db, key('lastCwd')),
        getSetting(db, key('permissionMode')),
        getSetting(db, key('agent')),
      ]);
      if (cancelled) return;
      // One update, so the form never flickers through a half-loaded state.
      setRemembered({
        cwd: cwd ?? '',
        mode: isPermissionMode(mode) ? mode : DEFAULT_PERMISSION_MODE,
        agent: isAgent(agent) ? agent : 'claude',
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [db, connectionId]);
  return remembered;
}

/**
 * Creating the workspace and starting the agent in it, as one retryable step.
 *
 * They are two host calls, and the second can fail after the first worked.
 * Pressing Start again used to create a second workspace next to the first
 * (#101). The workspace that was created is kept, and a retry for the same
 * folder starts the agent in it. A retry for a different folder closes it
 * first, best effort, rather than leaving an empty workspace behind.
 */
export function useStartChat(connectionId: string | null) {
  const db = useSQLiteContext();
  const pending = useRef<{ directory: string; creation: WorkspaceCreation } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (
    client: HerdrClient,
    choice: { directory: string; label: string; agent: NewChatAgent; mode: PermissionMode }
  ): Promise<WorkspaceCreation | null> => {
    setCreating(true);
    setError(null);
    try {
      let creation = pending.current?.directory === choice.directory ? pending.current.creation : null;
      if (creation === null) {
        if (pending.current !== null) {
          const orphan = pending.current.creation.workspace.workspaceId;
          pending.current = null;
          await client.closeWorkspace(orphan).catch(() => undefined);
        }
        creation = await client.createWorkspace(
          choice.directory,
          choice.label.length === 0 ? null : choice.label
        );
        pending.current = { directory: choice.directory, creation };
      }
      // Named after the workspace, so `herdr agent list` on the desktop shows
      // the same thing this app calls the chat. On a host without `agent start`
      // this falls back to typing the launch command, which is what shipped.
      await client.startNamedAgent(
        creation.rootPane.paneId,
        agentName(creation.workspace.label),
        choice.agent,
        choice.agent === 'claude' ? launchArgs(choice.mode) : [],
        choice.agent === 'claude' ? launchCommand(choice.mode) : 'codex'
      );
      pending.current = null;
      const key = (name: string) => `${name}.${connectionId ?? 'none'}`;
      await setSetting(db, key('lastCwd'), choice.directory);
      await setSetting(db, key('agent'), choice.agent);
      if (choice.agent === 'claude') await setSetting(db, key('permissionMode'), choice.mode);
      return creation;
    } catch (thrown) {
      setError(thrown instanceof HerdrError ? thrown.message : String(thrown));
      setCreating(false);
      return null;
    }
  };

  return { start, creating, error };
}
