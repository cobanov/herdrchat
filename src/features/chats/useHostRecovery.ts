import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { confirmDestructive } from '@/components/ActionSheet';
import { connectionRecovery } from '@/lib/connectionRecovery';
import type { HerdrClient } from '@/lib/herdr/client';
import type { HerdrErrorCode } from '@/lib/herdr/protocol';
import { loadHostKeyPin, type ServerConnection } from '@/state/connections';

/**
 * Run `work`, letting a failure go: the poll's own banner already carries it,
 * and a second one here would stack two messages about one problem. Out of
 * the hook because the React Compiler skips a function holding a try/catch
 * with a conditional in it, and the list renders every chat row.
 */
async function quietly(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch {
    /* reported by the poll */
  }
}

/**
 * The way out of a failed connection that the chat list offers.
 *
 * Two things can be fixed from here, and they are different sizes: missing
 * herdr downloads and runs an install script; a stopped server is one
 * process. Offering them as one button would make the smaller one feel as
 * consequential as the larger. The rest go to the host's editor, or retry.
 *
 * A changed host key is not one failure among many: it is the only one where
 * the right move might be to stop using the app, so it gets its own surface
 * (`keyChanged`, with the pin it was checked against). By code, not by the
 * message: the wording is the transport's to change, and it did (the native
 * sentence became a plain one), which silently turned that banner back into
 * an ordinary error.
 */
export function useHostRecovery({ connection, client, error, errorCode, refresh }: {
  connection: ServerConnection | null;
  client: HerdrClient | null;
  error: string | null;
  errorCode: HerdrErrorCode | null;
  refresh: () => Promise<void>;
}) {
  const router = useRouter();
  /** One flag for both recovery actions, only one is ever offered at a time. */
  const [fixing, setFixing] = useState(false);
  const keyChanged = error !== null && errorCode === 'host_key_changed';
  const [storedPin, setStoredPin] = useState<string | null>(null);
  useEffect(() => {
    if (!keyChanged || connection === null) return;
    let alive = true;
    void loadHostKeyPin(connection.id).then((pin) => {
      if (alive) setStoredPin(pin);
    });
    return () => {
      alive = false;
    };
  }, [keyChanged, connection]);

  const fixHost = async (action: 'install' | 'start') => {
    if (client === null) return;
    setFixing(true);
    await quietly(async () => {
      await (action === 'install' ? client.installHerdr() : client.startServer());
      await refresh();
    });
    setFixing(false);
  };

  /**
   * Never one tap. Installing pipes a script from the network into a shell on
   * someone's machine, so the exact command is stated and confirmed before it
   * runs, the same bargain a terminal would offer, where you would at least
   * have typed it. Starting a stopped server is not in that class and goes
   * straight through.
   */
  const confirmInstallHerdr = () => {
    if (connection === null) return;
    confirmDestructive({
      title: 'Run the herdr installer?',
      message: `This runs curl -fsSL https://herdr.dev/install.sh | sh on ${connection.host} as ${connection.username}. It downloads a script from herdr.dev and runs it there.`,
      confirmLabel: 'Run the installer',
      onConfirm: () => void fixHost('install'),
    });
  };

  /** The fix that matches the failure, for the banner and the empty state alike. */
  const recover = () => {
    const { action } = connectionRecovery(errorCode);
    if (action === 'install') confirmInstallHerdr();
    else if (action === 'start') void fixHost('start');
    else if (action === 'retry') void refresh();
    else if (connection !== null) router.push({ pathname: '/server/[id]', params: { id: connection.id } });
  };

  return { keyChanged, storedPin, fixing, recover };
}
