import type { AgentStatus } from './herdr/models';

/** A chat's state as its row's mark draws it. */
export type ShownStatus = 'blocked' | 'working' | 'done' | 'idle' | 'unknown';

/**
 * What a chat's mark says, the way herdr's sidebar says it: finished and not
 * yet read is `done`, read is `idle`. herdr turns `done` into `idle` once the
 * pane is viewed there; reading the chat here is the same act, so an unread
 * reply reads as done and a read one as idle, whatever herdr last saw.
 */
export function shownStatus(status: AgentStatus, unread: boolean): ShownStatus {
  if (status === 'blocked' || status === 'working') return status;
  if (unread) return 'done';
  return status === 'unknown' ? 'unknown' : 'idle';
}
