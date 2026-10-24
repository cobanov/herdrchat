import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { confirmDestructive, showActionSheet } from '@/components/ActionSheet';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { haptics } from '@/components/haptics';
import { usePollGate } from '@/features/usePollGate';
import type { HerdrTransport } from '@/lib/herdr/transport';
import { capturedNote, usageRows, type UsageRow } from '@/lib/usage/usageRows';
import { isDemo } from '@/state/demoId';
import { saveSetting } from '@/state/saveSetting';
import { useSettings } from '@/state/settings';
import { checkPlanUsage, turnOffUsage, turnOnUsage, usageOn, usePlanUsage } from '@/state/usage';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, size, spacing, usageFooter } from '@/theme/tokens';

/** What the footer needs of a host: which one, and what to name in the confirmation. */
export interface UsageHost {
  id: string;
  host: string;
  username: string;
}

/**
 * Claude plan usage under the chat list: the week's and the five hours'
 * limits, each as the share left, a bar of it and when it resets.
 *
 * Before the person has agreed for this host it is one quiet row offering
 * to set it up, because reading usage means changing Claude's status line
 * there, and that is theirs to allow. Once agreed, tapping the block offers
 * to show the share used instead of the share left (or back), and to turn it
 * off again. The Demo shows its usage from the start, and has no Turn off.
 *
 * It shows nothing it did not read: no row until the host has answered, and
 * a line saying when numbers will appear while there are none.
 */
export function UsageFooter({ host, transport, style }: {
  host: UsageHost;
  transport: HerdrTransport | null;
  /** For the block itself, so a footer that draws nothing leaves no gap either. */
  style?: StyleProp<ViewStyle>;
}) {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const consent = usePlanUsage((state) => state.consent);
  const usage = usePlanUsage((state) => state.byConnection[host.id]);
  const now = useClock(usageFooter.clockTickMs);
  const shown = useSettings((state) => state.usageShown);
  const [busy, setBusy] = useState<'on' | 'off' | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLiveRead(usageOn(host.id, consent) ? host.id : null, transport);

  const run = async (change: 'on' | 'off') => {
    if (transport === null) return;
    setBusy(change);
    setError(null);
    try {
      const result = await (change === 'on' ? turnOnUsage : turnOffUsage)(db, host.id, transport);
      if (!result.ok) setError(result.message);
    } catch (thrown) {
      // Only the settings table can throw here; the host's answers are results.
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(null);
    }
  };

  if (!usageOn(host.id, consent)) {
    const setUp = () => {
      haptics.light();
      // What changes, where, and as whom, before anything does: the same
      // bargain as the herdr installer's confirmation.
      confirmDestructive({
        title: `Show Claude usage from ${host.host}?`,
        message: `This sets Claude Code's status line on ${host.host} (as ${host.username}) to a small script in ~/.cache/herdrchat that saves your plan usage for HerdrChat, then runs your current status line unchanged. Turn off puts the current one back.`,
        confirmLabel: 'Set up',
        onConfirm: () => void run('on'),
      });
    };
    return (
      <View testID="usage-footer" style={[{ gap: spacing.xs }, style]}>
        <Pressable
          testID="usage-setup"
          accessibilityRole="button"
          accessibilityLabel="Show Claude usage"
          accessibilityHint="Week and 5-hour limits from this computer's Claude Code"
          accessibilityState={{ busy: busy !== null }}
          disabled={busy !== null || transport === null}
          onPress={setUp}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            minHeight: minTouchTarget,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderRadius: radius.md,
            backgroundColor: pressed ? colors.chatCardPressed : colors.chatCard,
          })}>
          <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
            <Text variant="subhead" weight="600" color="tint">
              {busy === 'on' ? 'Setting up…' : 'Show Claude usage'}
            </Text>
            <Text variant="caption" color="secondary">
              Week and 5-hour limits from this computer&apos;s Claude Code
            </Text>
          </View>
          <Icon name="chevron.right" size={size.rowChevron} tintColor={colors.tertiaryLabel} />
        </Pressable>
        {error !== null && <UsageError message={error} />}
      </View>
    );
  }

  // Not read yet: nothing, rather than a hint that may be wrong in a second.
  if (usage === undefined && error === null) return null;

  const rows = usage === undefined || usage === null ? [] : usageRows(usage, now / 1000, shown);
  const note = usage === undefined || usage === null || rows.length === 0
    ? null
    : capturedNote(usage.capturedAt, now / 1000, usageFooter.staleAfterMs / 1000);
  // The Demo has nothing to put back, so it offers no Turn off.
  const canTurnOff = !isDemo(host.id) && transport !== null && busy === null;
  const manage = () =>
    showActionSheet({
      title: 'Claude usage',
      message: canTurnOff
        ? `Turning it off puts back the status line ${host.host} had before and removes HerdrChat's script there.`
        : undefined,
      actions: [
        // One choice for every host: it is how this person reads a limit.
        shown === 'left'
          ? { label: 'Show % used', onPress: () => saveSetting(db, 'usageShown', 'used') }
          : { label: 'Show % left', onPress: () => saveSetting(db, 'usageShown', 'left') },
        ...(canTurnOff ? [{ label: 'Turn off Claude usage', destructive: true, onPress: () => void run('off') }] : []),
      ],
    });

  return (
    <Pressable
      testID="usage-footer"
      // Each row is read on its own; the way to the options for a screen
      // reader is the button in the heading.
      accessible={false}
      disabled={busy !== null}
      onPress={manage}
      style={[{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.chatCard }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <Text variant="caption" mono color="secondary">CLAUDE USAGE</Text>
        {busy === null && (
          <Pressable
            testID="usage-options"
            accessibilityRole="button"
            accessibilityLabel="Claude usage options"
            hitSlop={spacing.md}
            onPress={manage}>
            <Icon name="ellipsis" size={size.rowBadgeGlyph} tintColor={colors.secondaryLabel} />
          </Pressable>
        )}
      </View>
      {rows.map((row) => <UsageBar key={row.key} row={row} />)}
      {rows.length === 0 && busy === null && (
        <Text variant="footnote" color="secondary">Usage appears after Claude runs here</Text>
      )}
      {busy === 'off' && <Text variant="footnote" color="secondary">Turning off…</Text>}
      {note !== null && <Text variant="caption" color="secondary">{note}</Text>}
      {error !== null && <UsageError message={error} />}
    </Pressable>
  );
}

function UsageBar({ row }: { row: UsageRow }) {
  const { colors } = useTheme();
  const low = row.percentLeft <= usageFooter.lowPercent;
  return (
    <View testID={`usage-${row.key}`} accessible accessibilityLabel={row.spoken} style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
        <Text variant="subhead" weight="600">{row.title}</Text>
        <Text variant="subhead" color={low ? 'attention' : 'secondary'} style={{ flex: 1, minWidth: 0 }}>
          {row.amount}
        </Text>
        <Text variant="footnote" color="secondary">{row.reset}</Text>
      </View>
      <View style={{ height: usageFooter.barHeight, borderRadius: radius.full, backgroundColor: colors.controlTrack, overflow: 'hidden' }}>
        <View style={{ width: `${row.percent}%`, height: '100%', backgroundColor: low ? colors.attention : colors.tint }} />
      </View>
    </View>
  );
}

function UsageError({ message }: { message: string }) {
  return (
    <Text testID="usage-error" variant="footnote" color="destructive">
      {message}
    </Text>
  );
}

/**
 * Read the host's usage file every `usageFooter.liveReadMs` while someone can
 * see the footer, and once again on coming back to it.
 *
 * Its own loop rather than the chat list's poll: that poll slows to 30 s once
 * the host's events are live, so the footer ran half a minute behind a file
 * Claude rewrites every few seconds. It shares the list's gate (`usePollGate`),
 * though: Expo Router keeps the list mounted under a pushed chat, and the read
 * there sent an exec every few seconds for a footer nobody could see. The
 * list does not draw the footer under a host it cannot reach, so a host that
 * needs the person (a changed key) is not asked again from here either.
 */
function useLiveRead(connectionId: string | null, transport: HerdrTransport | null) {
  const polling = usePollGate();
  useEffect(() => {
    if (connectionId === null || transport === null || !polling) return;
    const read = () => void checkPlanUsage(connectionId, transport);
    read();
    const timer = setInterval(read, usageFooter.liveReadMs);
    return () => clearInterval(timer);
  }, [connectionId, transport, polling]);
}

/**
 * The time now, again every `intervalMs`, so labels measured against it
 * (a reset's weekday, "as of") move on without a new read.
 */
function useClock(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
