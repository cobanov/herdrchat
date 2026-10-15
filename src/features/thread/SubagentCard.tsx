import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { Text } from '@/components/Text';
import { openSubagent, useDelegationScope, useDelegationStates } from '@/features/thread/delegation';
import { haptics } from '@/lib/haptics';
import { formatDuration, formatTokens, formatToolCalls } from '@/lib/subagents/format';
import { subagentInput, type Delegation, type DelegationState, type ToolCall } from '@/lib/threadItems';
import { modelDisplayName } from '@/lib/transcript/sessionMeta';
import { useSettings } from '@/state/settings';
import { useToolRuns } from '@/state/toolRuns';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, size, spacing } from '@/theme/tokens';

/**
 * A subagent the agent handed work to: a card of its own rather than one
 * more line in a run, because it is a second worker, not a step.
 *
 * What it was asked, which kind of agent on which model, where it stands and
 * for how long; tapped, what it handed back. The chevron opens its own
 * transcript. Its state is the delegation's, never the call's result: a
 * background agent's result arrives at once and only says it launched.
 */
export function SubagentCard({ call, delegation }: { call: ToolCall; delegation: Delegation }) {
  const scope = useDelegationScope();
  const input = subagentInput(call);
  const title = input.description ?? 'Agent';
  const subtitle = [input.agentType, modelDisplayName(input.model)].filter((part): part is string => part !== null).join(' · ');
  const id = call.id ?? call.key;

  useReportState(call.id, delegation.state);

  // A background agent's launch named it; a foreground one is found by the
  // meta that names this call. Without a call id there is nothing to match.
  const target = delegation.agentId !== null
    ? { kind: 'agent' as const, agentId: delegation.agentId, runId: null }
    : call.id !== null ? { kind: 'call' as const, toolUseId: call.id } : null;
  const onOpen = scope === null || scope.sessionDirs.length === 0 || target === null || call.id === null
    ? null
    : () => openSubagent(scope, target, { title, subtitle, followKey: call.id!, state: delegation.state, callId: call.id });

  return (
    <DelegationCard
      testID={`subagent-${id}`}
      openTestID={`subagent-open-${id}`}
      foldKey={call.key}
      glyph="cpu"
      kindLabel="Agent"
      title={title}
      caption={[subtitle, ...figures(delegation)].filter((part) => part.length > 0).join(' · ')}
      state={delegation.state}
      result={delegation.result}
      onOpen={onOpen}
      openLabel="Open this agent's transcript"
    />
  );
}

/** Tell an open agent screen where this card's work stands, so it stops following when it ends. */
export function useReportState(key: string | null, state: DelegationState) {
  const report = useDelegationStates((store) => store.report);
  useEffect(() => {
    if (key !== null) report(key, state);
  }, [key, state, report]);
}

/** "1m 6s · 21.5k tokens · 6 tool calls", from what the transcript said. */
export function figures(delegation: Delegation): string[] {
  return [
    formatDuration(delegation.durationMs),
    formatTokens(delegation.tokens),
    formatToolCalls(delegation.toolUses),
  ].filter((part): part is string => part !== null);
}

/**
 * The card both kinds share: a header line that folds the result open, a
 * caption, and a chevron that opens the work itself.
 */
export function DelegationCard({
  testID,
  openTestID,
  foldKey,
  glyph,
  kindLabel,
  title,
  caption,
  state,
  result,
  onOpen,
  openLabel,
  detail = null,
  body = null,
}: {
  testID: string;
  openTestID: string;
  foldKey: string;
  glyph: IconName;
  kindLabel: string;
  title: string;
  caption: string;
  state: DelegationState;
  result: string | null;
  onOpen: (() => void) | null;
  openLabel: string;
  /** A second line under the title: a workflow's summary. */
  detail?: string | null;
  /** What opening the card shows above the result: a workflow's phases. */
  body?: ReactNode;
}) {
  const { colors } = useTheme();
  // In the store, not in the row: FlashList recycles rows, and state held in
  // one would open whichever card next scrolled into it.
  // Closed by default, as a tool run; the header's tool switch opens every one.
  const expandAll = useSettings((store) => store.showToolActivity);
  const stored = useToolRuns((store) => store.open[foldKey]);
  const toggle = useToolRuns((store) => store.toggle);
  const shown = result?.trim() ?? '';
  const hasResult = shown.length > 0;
  const foldable = hasResult || body !== null;
  const opened = foldable && (stored ?? expandAll);

  return (
    <View
      testID={testID}
      style={{
        borderRadius: radius.sm,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.separator,
        backgroundColor: colors.secondarySystemBackground,
        overflow: 'hidden',
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable
          onPress={foldable ? () => {
            haptics.selection();
            toggle(foldKey, opened);
          } : undefined}
          disabled={!foldable}
          accessibilityRole={foldable ? 'button' : undefined}
          accessibilityLabel={`${kindLabel}: ${title}, ${state}${caption.length > 0 ? `, ${caption}` : ''}`}
          accessibilityState={foldable ? { expanded: opened } : undefined}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            paddingVertical: spacing.sm,
            paddingLeft: spacing.sm,
          }}>
          {/* The fold's own mark, turning as a tool run's does, so the card
              says it opens in place; the chevron at the end opens the work. */}
          <View
            testID={`${testID}-fold`}
            style={{ width: size.toolRail, alignItems: 'center', opacity: foldable ? 1 : 0, transform: [{ rotate: opened ? '90deg' : '0deg' }] }}>
            <Icon name="chevron.right" size={size.toolGlyph} tintColor={colors.tertiaryLabel} fallback={<Text color="tertiary">›</Text>} />
          </View>
          <View
            style={{
              width: size.agentTile,
              height: size.agentTile,
              borderRadius: radius.xs,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.fillSubtle,
            }}>
            <Icon name={glyph} size={size.toolGlyph} tintColor={colors.secondaryLabel} fallback={<Text color="secondary">◇</Text>} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
            <Text variant="subhead" weight="600" numberOfLines={2}>
              {title}
            </Text>
            {detail !== null && (
              <Text variant="footnote" color="secondary" numberOfLines={2}>
                {detail}
              </Text>
            )}
            {caption.length > 0 && (
              <Text variant="caption" color="secondary" numberOfLines={1}>
                {caption}
              </Text>
            )}
          </View>
        </Pressable>
        {/* Outside the fold control, which would otherwise hide it from
            assistive tech (and from the UI flows) as one of its children. */}
        <View style={{ paddingLeft: spacing.sm }}>
          <StateGlyph state={state} />
        </View>
        <Pressable
          testID={openTestID}
          onPress={onOpen === null ? undefined : () => {
            haptics.light();
            onOpen();
          }}
          disabled={onOpen === null}
          accessibilityRole="button"
          accessibilityLabel={openLabel}
          accessibilityState={{ disabled: onOpen === null }}
          style={{ width: minTouchTarget, minHeight: minTouchTarget, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}>
          <Icon
            name="chevron.right"
            size={size.rowChevron}
            tintColor={onOpen === null ? colors.separator : colors.tertiaryLabel}
            fallback={<Text color="tertiary">›</Text>}
          />
        </Pressable>
      </View>
      {opened && body}
      {opened && hasResult && (
        <View
          style={{
            marginHorizontal: spacing.sm,
            marginBottom: spacing.sm,
            padding: spacing.sm,
            borderRadius: radius.xs,
            backgroundColor: colors.fillSubtle,
          }}>
          <Text testID={`${testID}-result`} variant="footnote" color={state === 'failed' ? 'attention' : 'label'} numberOfLines={size.delegationResultLines} selectable>
            {shown}
          </Text>
        </View>
      )}
    </View>
  );
}

const STATE_GLYPHS: Record<Exclude<DelegationState, 'running'>, IconName> = {
  done: 'checkmark.circle',
  failed: 'exclamationmark.circle',
};

/**
 * Where a piece of delegated work stands: the activity indicator the chat
 * rows use while it runs, a tick once it is done, the attention mark when it
 * failed. Its accessibility label is the state's own word, which is what a
 * screen reader says and what the UI flows wait for.
 */
export function StateGlyph({ state }: { state: DelegationState }) {
  const { colors, reduceMotion } = useTheme();
  return (
    <View
      testID={`state-${state}`}
      accessible
      accessibilityLabel={state}
      style={{ width: size.delegationGlyph, height: size.delegationGlyph, alignItems: 'center', justifyContent: 'center' }}>
      {state === 'running' ? (
        reduceMotion ? (
          <Icon name="ellipsis.circle" size={size.delegationGlyph} tintColor={colors.tint} />
        ) : (
          <ActivityIndicator size="small" color={colors.tint} />
        )
      ) : (
        <Icon
          name={STATE_GLYPHS[state]}
          size={size.delegationGlyph}
          tintColor={state === 'failed' ? colors.attention : colors.secondaryLabel}
          fallback={<Text color={state === 'failed' ? 'attention' : 'secondary'}>{state === 'failed' ? '!' : '✓'}</Text>}
        />
      )}
    </View>
  );
}
