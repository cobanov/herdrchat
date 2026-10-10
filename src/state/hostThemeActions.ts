import type { HerdrTransport } from '@/lib/herdr/transport';
import { bootstrapHostTheme, resetHostTheme } from '@/lib/theme/hostThemeClient';
import { clientFor, useConnections } from './connections';
import { checkHostTheme } from './hostTheme';

/*
  The things Settings does to a host's theme, by connection id.

  Apart from `hostTheme.ts` because they find the host's client, which brings
  in the SSH module: the chat list's poll uses that store and already has its
  client, and should not drag the native transport into everything that
  imports it.
*/

function transportOf(connectionId: string): HerdrTransport | null {
  const connection = useConnections.getState().connections.find((item) => item.id === connectionId);
  return connection === undefined ? null : clientFor(connection).transport;
}

/**
 * Settings' "Reload theme": fetch the file whatever its mtime. True when the
 * host answered, for the haptic and for saying it did not.
 */
export function reloadHostTheme(connectionId: string): Promise<boolean> {
  const transport = transportOf(connectionId);
  if (transport === null) return Promise.resolve(false);
  return checkHostTheme(connectionId, transport, { force: true });
}

/**
 * Settings' "Reset to default": move theme.json aside on the host, then fetch,
 * which now finds no file and puts the app back on its own colours. False when
 * the host could not be reached for either step.
 */
export async function resetHostThemeToDefault(connectionId: string): Promise<boolean> {
  const transport = transportOf(connectionId);
  if (transport === null) return false;
  if (!(await resetHostTheme(transport))) return false;
  return checkHostTheme(connectionId, transport, { force: true });
}

/**
 * Settings' "Copy prompt for an agent": make sure the schema and README the
 * prompt names are on the host. The theme check writes them too, but it is
 * skipped while Use host themes is off, and the prompt is offered regardless.
 * Never overwrites; a failure is silent, as the next check retries it.
 */
export function writeHostThemeReference(connectionId: string): Promise<boolean> {
  const transport = transportOf(connectionId);
  if (transport === null) return Promise.resolve(false);
  return bootstrapHostTheme(transport);
}
