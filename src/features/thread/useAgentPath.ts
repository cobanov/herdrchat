import { useEffect, useRef, useState } from 'react';

import type { AgentTarget } from '@/features/thread/delegation';
import type { HerdrClient } from '@/lib/herdr/client';
import { SUBAGENT_RESOLVE_RETRY_MS } from '@/lib/herdr/timeouts';
import type { AgentMeta } from '@/lib/subagents/meta';
import { agentTranscriptPath, isInertId } from '@/lib/subagents/paths';
import { SubagentReader } from '@/lib/subagents/reader';
import { TranscriptStore } from '@/lib/transcript/store';

export interface AgentPath {
  /** The agent's transcript, once found. */
  path: string | null;
  /** Its meta, when it was found by one. */
  meta: AgentMeta | null;
  /** Looked at least once and not found: starting, if it runs; gone, if not. */
  missing: boolean;
}

/**
 * Which file a subagent screen reads, found only by the agent's own ids.
 *
 * A call's agent is the one whose meta names the call; an agent whose id is
 * known is the file named by it. Never the newest file in a folder: two
 * agents start within a millisecond of each other, and a guess shows someone
 * else's work. Until the agent has written its meta (a moment after its call)
 * this is null and is asked again every `SUBAGENT_RESOLVE_RETRY_MS` while
 * `running`: the screen says the agent is starting. An agent that ended and
 * is not found is looked for once.
 */
export function useAgentPath(
  client: HerdrClient | null,
  dirs: readonly string[],
  target: AgentTarget | null,
  running: boolean
): AgentPath {
  const [found, setFound] = useState<(AgentPath & { key: string }) | null>(null);
  const keepLooking = useRef(running);
  useEffect(() => {
    keepLooking.current = running;
  }, [running]);
  const dirsKey = dirs.join('\u0000');
  const targetKey = target === null ? '' : target.kind === 'call' ? `call:${target.toolUseId}` : `agent:${target.runId ?? ''}/${target.agentId}`;
  const key = `${dirsKey}\u0001${targetKey}`;

  useEffect(() => {
    if (client === null || target === null || dirsKey.length === 0) return;
    const folders = dirsKey.split('\u0000');
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reader = new SubagentReader(client.transport);
    const store = new TranscriptStore(client.transport);

    const look = async (): Promise<AgentPath | null> => {
      for (const dir of folders) {
        if (target.kind === 'call') {
          const resolved = await reader.resolve(dir, target.toolUseId);
          if (resolved !== null) return { path: agentTranscriptPath(dir, resolved.agentId), meta: resolved.meta, missing: false };
        } else {
          if (!isInertId(target.agentId) || (target.runId !== null && !isInertId(target.runId))) return null;
          const path = agentTranscriptPath(dir, target.agentId, target.runId);
          // One folder needs no asking: the screen's own read says if it is not there yet.
          if (folders.length === 1) return { path, meta: null, missing: false };
          const probe = await store.fileProbe(path);
          if (probe.kind === 'size') return { path, meta: null, missing: false };
        }
      }
      return null;
    };

    const attempt = () => {
      void look()
        .catch(() => null)
        .then((result) => {
          if (!alive) return;
          if (result !== null) {
            setFound({ ...result, missing: false, key });
            return;
          }
          setFound((previous) => (previous?.key === key && previous.missing ? previous : { path: null, meta: null, missing: true, key }));
          if (keepLooking.current) timer = setTimeout(attempt, SUBAGENT_RESOLVE_RETRY_MS);
        });
    };
    attempt();
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
    };
    // `target` is described by `targetKey`; an object re-made by each render must not restart the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);

  // A result for another target (the params changed) is not this one's.
  return found !== null && found.key === key
    ? { path: found.path, meta: found.meta, missing: found.missing }
    : { path: null, meta: null, missing: false };
}
