import { useState } from 'react';

import type { ServerConnection } from '@/state/connections';

/**
 * The host editor's fields, whether they make a host, and whether anything
 * was entered or changed. `onChange` runs on every edit: any change to a
 * connection-relevant field invalidates a prior test.
 */
export function useHostForm(id: string, existing: ServerConnection | null, onChange: () => void) {
  const [name, setName] = useState(existing?.name ?? '');
  const [host, setHost] = useState(existing?.host ?? '');
  const [port, setPort] = useState(String(existing?.port ?? 22));
  const [username, setUsername] = useState(existing?.username ?? '');
  const [authKind, setAuthKind] = useState<ServerConnection['authKind']>(existing?.authKind ?? 'password');
  const [secret, setSecret] = useState('');
  const [herdrPath, setHerdrPath] = useState(existing?.herdrPath ?? 'herdr');
  const [sessionName, setSessionName] = useState(existing?.sessionName ?? '');

  const edit =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      onChange();
      setter(value);
    };

  const valid =
    name.trim().length > 0 &&
    host.trim().length > 0 &&
    username.trim().length > 0 &&
    Number.isInteger(Number(port)) &&
    Number(port) > 0 &&
    Number(port) <= 65535;

  const draft = (): ServerConnection => ({
    id,
    name: name.trim(),
    host: host.trim(),
    port: Number(port) || 22,
    username: username.trim(),
    authKind,
    herdrPath: herdrPath.trim().length === 0 ? 'herdr' : herdrPath.trim(),
    sessionName: sessionName.trim(),
  });

  /**
   * Done used to drop a half-typed host without a word, key and all (#4
   * acceptance). With anything entered or changed the editor asks first.
   */
  const dirty = existing === null
    ? [name, host, username, secret, sessionName].some((value) => value.trim().length > 0) ||
      herdrPath !== 'herdr' ||
      port !== '22'
    : name !== existing.name ||
      host !== existing.host ||
      port !== String(existing.port) ||
      username !== existing.username ||
      authKind !== existing.authKind ||
      secret.length > 0 ||
      herdrPath !== existing.herdrPath ||
      sessionName !== existing.sessionName;

  return {
    values: { name, host, port, username, authKind, secret, herdrPath, sessionName },
    set: {
      name: edit(setName),
      host: edit(setHost),
      port: edit(setPort),
      username: edit(setUsername),
      authKind: edit(setAuthKind),
      secret: edit(setSecret),
      herdrPath: edit(setHerdrPath),
      sessionName: edit(setSessionName),
    },
    valid,
    draft,
    dirty,
  };
}

export type HostForm = ReturnType<typeof useHostForm>;
