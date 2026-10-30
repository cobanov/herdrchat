import type * as SQLite from 'expo-sqlite';
import { create } from 'zustand';

import type { HerdrTransport } from '@/lib/herdr/transport';
import type { PlanUsage } from '@/lib/usage/planUsage';
import {
  fetchPlanUsage,
  installUsageStatusLine,
  removeUsageStatusLine,
  type UsageSetupResult,
} from '@/lib/usage/usageClient';
import { isDemo } from './demoId';
import { deleteSetting, loadUsageConsentRows, setSetting, USAGE_CONSENT_KEY_PREFIX, usageConsentKey } from './db';

/**
 * Claude plan usage per host, for the chat list's footer, and which hosts the
 * person agreed to read it from.
 *
 * The agreement is the gate for everything else: reading usage needs the
 * status line wrapper on the host, and that changes a file of the person's
 * (Claude's settings), so nothing is installed or read until they say so,
 * host by host. The Demo needs no agreement: it has no settings to change,
 * and its usage is part of what it shows.
 *
 * A host's usage is absent until the first read lands, null when the read
 * found nothing to show (no session has redrawn a status line since the
 * install, or the person is not on a Claude plan), and the windows otherwise.
 * Not persisted: a read every 30 s refills it, and a cached percentage
 * shown at launch would pass for a live one.
 */
interface PlanUsageState {
  consent: Record<string, true>;
  byConnection: Record<string, PlanUsage | null>;
  setConsent: (connectionId: string, on: boolean) => void;
  set: (connectionId: string, usage: PlanUsage | null) => void;
  clear: (connectionId: string) => void;
  /** The launch, from the settings table. Agreements given since are kept. */
  hydrateConsent: (connectionIds: readonly string[]) => void;
}

/** Bumped by `clear`, so a read in flight for a host just turned off drops its answer. */
const generations = new Map<string, number>();
const generationOf = (connectionId: string) => generations.get(connectionId) ?? 0;

export const usePlanUsage = create<PlanUsageState>((setState) => ({
  consent: {},
  byConnection: {},
  setConsent: (connectionId, on) =>
    setState((state) => {
      if (on) return { consent: { ...state.consent, [connectionId]: true } };
      const { [connectionId]: _removed, ...rest } = state.consent;
      return { consent: rest };
    }),
  set: (connectionId, usage) =>
    setState((state) => ({ byConnection: { ...state.byConnection, [connectionId]: usage } })),
  clear: (connectionId) => {
    generations.set(connectionId, generationOf(connectionId) + 1);
    setState((state) => {
      const { [connectionId]: _consent, ...consent } = state.consent;
      const { [connectionId]: _usage, ...byConnection } = state.byConnection;
      return { consent, byConnection };
    });
  },
  hydrateConsent: (connectionIds) =>
    setState((state) => ({
      consent: { ...Object.fromEntries(connectionIds.map((id) => [id, true] as const)), ...state.consent },
    })),
}));

/** Whether the footer shows a host's usage, and the poll reads it. */
export function usageOn(connectionId: string, consent: Record<string, true> = usePlanUsage.getState().consent): boolean {
  return isDemo(connectionId) || consent[connectionId] === true;
}

export async function loadUsageConsent(db: SQLite.SQLiteDatabase): Promise<void> {
  const rows = await loadUsageConsentRows(db);
  usePlanUsage.getState().hydrateConsent(
    rows.filter((row) => row.value === '1').map((row) => row.key.slice(USAGE_CONSENT_KEY_PREFIX.length))
  );
}

// MARK: - Reading

/** The read in flight per host, so the poll and a fresh agreement share one round-trip. */
const inFlight = new Map<string, Promise<boolean>>();

/**
 * Read a host's usage file and store what it says. True when the host
 * answered; false is a failed read, which keeps what was shown (the next poll
 * tries again). Never rejects.
 */
export function checkPlanUsage(connectionId: string, transport: HerdrTransport): Promise<boolean> {
  const running = inFlight.get(connectionId);
  if (running !== undefined) return running;
  // Taken now, not when the answer lands: turning off between the two must
  // still void it.
  const generation = generationOf(connectionId);
  const check = fetchPlanUsage(transport, Date.now() / 1000)
    .then((read) => {
      if (read === null) return false;
      if (generationOf(connectionId) === generation) usePlanUsage.getState().set(connectionId, read.usage);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      if (inFlight.get(connectionId) === check) inFlight.delete(connectionId);
    });
  inFlight.set(connectionId, check);
  return check;
}

// MARK: - Turning it on and off

/**
 * Install the wrapper on the host, then remember the agreement and read at
 * once, so the footer fills without waiting out the poll's interval. A
 * failure remembers nothing: the host was left as it was, or as far as the
 * write got, and the footer shows the message.
 */
export async function turnOnUsage(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  transport: HerdrTransport
): Promise<UsageSetupResult> {
  const result = await installUsageStatusLine(transport);
  if (!result.ok) return result;
  await setSetting(db, usageConsentKey(connectionId), '1');
  usePlanUsage.getState().setConsent(connectionId, true);
  await checkPlanUsage(connectionId, transport);
  return result;
}

/**
 * Put the person's status line back and forget the host's usage. When the
 * host cannot be reached the agreement stays, so the person can try again;
 * removing the host forgets it along with everything else.
 */
export async function turnOffUsage(
  db: SQLite.SQLiteDatabase,
  connectionId: string,
  transport: HerdrTransport
): Promise<UsageSetupResult> {
  const result = await removeUsageStatusLine(transport);
  if (!result.ok) return result;
  await deleteSetting(db, usageConsentKey(connectionId));
  usePlanUsage.getState().clear(connectionId);
  return result;
}

/** For tests: forget what this session did, as a relaunch would. */
export function resetPlanUsageSession(): void {
  generations.clear();
  inFlight.clear();
  usePlanUsage.setState({ consent: {}, byConnection: {} });
}
