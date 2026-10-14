import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorBanner } from '@/components/ErrorBanner';
import { EdgeFade, Glass } from '@/components/Glass';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { StateGlyph } from '@/features/thread/SubagentCard';
import type { DelegationState } from '@/lib/threadItems';
import { useTheme } from '@/theme/ThemeProvider';
import { glass, minTouchTarget, radius, screenPadding, size, spacing } from '@/theme/tokens';

/**
 * The header of a screen that only shows work: a subagent's transcript, a
 * workflow's run. The thread's own header, without its reload, stop and tool
 * switch: there is nothing here to send to or interrupt.
 *
 * Overlaid like the thread's, so the list scrolls under it and blurs into
 * the page; `onHeight` gives the list the room to keep clear.
 */
export function ReadOnlyHeader({
  testID,
  title,
  subtitle,
  state,
  backLabel,
  onBack,
  onHeight,
  error,
  onDismissError,
}: {
  testID: string;
  title: string;
  subtitle: string;
  state: DelegationState | null;
  backLabel: string;
  onBack: () => void;
  onHeight: (height: number) => void;
  error: string | null;
  onDismissError?: () => void;
}): ReactNode {
  const { colors } = useTheme();
  return (
    <View
      testID={`${testID}-header`}
      pointerEvents="box-none"
      onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
      style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
      <View style={{ paddingBottom: glass.edgeTail }}>
        <EdgeFade />
        <SafeAreaView edges={['top', 'left', 'right']}>
          <View style={{ width: '100%', maxWidth: size.contentMaxWidth, alignSelf: 'center' }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingHorizontal: screenPadding,
                paddingVertical: spacing.sm,
              }}>
              <Glass interactive style={{ borderRadius: radius.full, overflow: 'hidden' }}>
                <Pressable
                  onPress={onBack}
                  accessibilityRole="button"
                  accessibilityLabel={backLabel}
                  testID={`${testID}-back`}
                  style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="chevron.left" size={size.headerGlyph} tintColor={colors.label} fallback={<Text>‹</Text>} />
                </Pressable>
              </Glass>
              <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
                <Text testID={`${testID}-title`} variant="headline" numberOfLines={1}>
                  {title}
                </Text>
                {(subtitle.length > 0 || state !== null) && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    {state !== null && <StateGlyph state={state} />}
                    <Text testID={`${testID}-meta`} variant="caption" color="secondary" style={{ flexShrink: 1 }} numberOfLines={1}>
                      {subtitle}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            {error !== null && <ErrorBanner message={error} onDismiss={onDismissError} />}
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}
