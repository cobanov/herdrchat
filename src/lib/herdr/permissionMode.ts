/**
 * How much Claude asks before acting, chosen when a chat is started.
 *
 * This matters more from a phone than from a desk: the default mode stops for
 * confirmation on essentially every tool call, and answering those one tap at a
 * time over SSH is the opposite of why you'd drive an agent from your pocket. So
 * new chats default to `bypassPermissions` — the mode you'd pick by hand anyway
 * — while the stricter modes stay one tap away.
 */
export type PermissionMode = 'bypassPermissions' | 'acceptEdits' | 'manual' | 'plan';

/** Ordered for the picker. The first entry is the default for a new chat. */
export const PERMISSION_MODES: readonly PermissionMode[] = [
  'bypassPermissions',
  'acceptEdits',
  'manual',
  'plan',
];

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'bypassPermissions';

interface PermissionModeCopy {
  title: string;
  detail: string;
  /** SF Symbol name. */
  symbol: string;
}

const COPY: Record<PermissionMode, PermissionModeCopy> = {
  bypassPermissions: {
    title: 'Full access',
    detail: 'Runs tools without asking. Best from a phone.',
    symbol: 'bolt.fill',
  },
  acceptEdits: {
    title: 'Auto-accept edits',
    detail: 'Edits apply automatically; other tools ask.',
    symbol: 'pencil.circle',
  },
  manual: {
    title: 'Ask every time',
    detail: 'Confirms every tool call. Claude’s default.',
    symbol: 'hand.raised',
  },
  plan: {
    title: 'Plan only',
    detail: 'Proposes a plan and changes nothing until approved.',
    symbol: 'list.bullet.clipboard',
  },
};

export function permissionModeCopy(mode: PermissionMode): PermissionModeCopy {
  return COPY[mode];
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value);
}

/**
 * The shell command that launches an agent in this mode.
 *
 * `manual` is spelled out rather than left implicit: the host's own settings may
 * set a different default, and a chat started as "Ask every time" must actually
 * ask.
 */
export function launchCommand(mode: PermissionMode, executable = 'claude'): string {
  return `${executable} --permission-mode ${mode}`;
}

/**
 * The same choice as argv, for `agent start … -- <args>`.
 *
 * herdr supplies the executable from `--kind`, so this is only what follows it.
 * Kept next to `launchCommand` because the two must always say the same thing:
 * one is used when the host has the agent-aware verb and the other when it does
 * not, and a chat started either way should have the same permissions.
 */
export function launchArgs(mode: PermissionMode): string[] {
  return ['--permission-mode', mode];
}
