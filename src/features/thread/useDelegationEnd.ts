import { useEffect, useState } from 'react';

import type { HerdrClient } from '@/lib/herdr/client';
import { SUBAGENT_END_POLL_MS } from '@/lib/herdr/timeouts';
import { delegationFromLines } from '@/lib/subagents/delegationEnd';
import { SubagentReader } from '@/lib/subagents/reader';
import type { Delegation } from '@/lib/threadItems';

/**
 * Where a subagent stands, read by its own screen from the transcript its
 * call was made in, every `SUBAGENT_END_POLL_MS` while `active`.
 *
 * The card in the chat cannot tell it: the chat stops reading its transcript
 * while a screen covers it (its poll is gated on focus), so the card never
 * learned the agent ended and the screen followed it forever. This reads only
 * the lines naming the call or the agent, the same way the card would, and
 * only when they changed; it stops once they say the agent ended, and that
 * answer stays. Null until a read finds the call.
 */
export function useDelegationEnd(
  client: HerdrClient | null,
  parents: readonly string[],
  toolUseId: string | null,
  agentId: string | null,
  active: boolean
): Delegation | null {
  const parentsKey = parents.join('\u0000');
  const key = `${parentsKey}\u0001${toolUseId ?? ''}\u0001${agentId ?? ''}`;
  const [found, setFound] = useState<{ key: string; delegation: Delegation } | null>(null);

  useEffect(() => {
    if (!active || client === null || toolUseId === null || parentsKey.length === 0) return;
    const paths = parentsKey.split('\u0000');
    const ids = agentId === null ? [toolUseId] : [toolUseId, agentId];
    const reader = new SubagentReader(client.transport);
    const signatures = new Map<string, string>();
    /** The transcript the call was found in; the others are not asked again. */
    let home: string | null = null;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const look = async () => {
      for (const path of home === null ? paths : [home]) {
        const read = await reader.linesNaming(path, ids, signatures.get(path) ?? null);
        if (!alive || read.kind !== 'text') continue;
        signatures.set(path, read.signature);
        const delegation = delegationFromLines(read.text, toolUseId);
        if (delegation === null) continue;
        home = path;
        setFound({ key, delegation });
        return delegation.state;
      }
      return 'running';
    };
    const tick = () => {
      void look()
        .catch(() => 'running' as const)
        .then((state) => {
          // Once it ended there is nothing more to learn here.
          if (alive && state === 'running') timer = setTimeout(tick, SUBAGENT_END_POLL_MS);
        });
    };
    tick();
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
    };
    // `parents` is described by `parentsKey`, and `key` by the ids in it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, client, key]);

  return found !== null && found.key === key ? found.delegation : null;
}
