/**
 * Which parser the thread cache's rows were made by.
 *
 * The cache keeps parsed messages, not lines, so a parser that learns to read
 * something new (a task notification, a hand-back) never sees the lines
 * already cached: a background card in an unchanged transcript stayed
 * "running" because the row that ended it was cached without its notice. The
 * version rides on the session stamp each row carries, so a row from an older
 * parser reads as another session's and `rebind` drops it, with its tail
 * cursor, and the transcript is read again.
 *
 * Bump it whenever a change to `parser.ts` changes what an already-cached
 * line would parse to.
 */
export const TRANSCRIPT_CACHE_VERSION = 2;

/**
 * The stamp a cached row carries for `sessionSig`. Version 1 is the bare
 * signature, what every row was stamped with before there was a version, so
 * those rows compare as version 1's.
 */
export function cacheStamp(sessionSig: string, version: number = TRANSCRIPT_CACHE_VERSION): string {
  return version <= 1 ? sessionSig : `v${version}|${sessionSig}`;
}
