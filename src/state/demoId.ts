/**
 * The reserved id of the host that isn't one.
 *
 * A real connection in every respect the app cares about — it is selected,
 * listed and opened by the same code as any other — except that its transport
 * answers from fixtures instead of a socket. That is deliberate: a separate
 * "demo screen" would be a second implementation of the app, free to drift from
 * the one people actually use.
 *
 * In a file of its own, without the SSH transport `connections.ts` brings,
 * so a store that only needs to recognise the Demo (Claude usage) can be
 * imported where no native module exists.
 */
export const DEMO_CONNECTION_ID = 'demo';

export const isDemo = (id: string): boolean => id === DEMO_CONNECTION_ID;
