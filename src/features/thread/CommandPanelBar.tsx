import { Pressable, ScrollView, View } from 'react-native';

import { Glass } from '@/components/Glass';
import { Icon, type IconName } from '@/components/Icon';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import {
  overlayOptionKeys,
  overlayScaleKeys,
  type OverlayAction,
  type PaneOverlay,
} from '@/lib/transcript/paneOverlay';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing } from '@/theme/tokens';

/**
 * A slash command's panel, driven from the phone.
 *
 * Mirrors what the terminal shows rather than inventing a form for it: the
 * rows, the slider, and exactly the actions the panel's own hint line offers.
 * A row tap moves the panel's cursor; only an action commits. That split is
 * the terminal's, and it is kept because in the model picker the commit is a
 * choice in itself ("set as default" or "this session only").
 */
export function CommandPanelBar({
  overlay,
  busy,
  onKeys,
}: {
  overlay: PaneOverlay;
  busy: boolean;
  onKeys: (keys: readonly string[]) => void;
}) {
  const { colors } = useTheme();
  const press = (keys: readonly string[] | null) => {
    if (keys === null || busy) return;
    haptics.selection();
    onKeys(keys);
  };

  return (
    <Glass testID="command-panel" style={{ borderRadius: radius.lg, overflow: 'hidden', padding: spacing.md, gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon
          name="slider.horizontal.3"
          size={size.panelGlyph}
          tintColor={colors.tint}
          fallback={<Text variant="footnote" color="tint">/</Text>}
        />
        <Text variant="footnote" color="tint" weight="600" style={{ flex: 1 }} numberOfLines={1}>
          {overlay.title}
        </Text>
      </View>

      {/* An information panel (/usage, /status) can be long; it scrolls here
          rather than pushing the composer off the screen. */}
      {overlay.notes.length > 0 && (
        <ScrollView style={{ maxHeight: size.panelNotesMaxHeight }} contentContainerStyle={{ gap: spacing.xxs }}>
          {overlay.notes.map((note, index) => (
            <Text key={`${index}-${note}`} variant="caption" color="secondary">
              {note}
            </Text>
          ))}
        </ScrollView>
      )}

      {overlay.options.length > 0 && (
        <View style={{ gap: spacing.xxs }} accessibilityRole="radiogroup">
          {overlay.options.map((option) => {
            const keys = overlayOptionKeys(overlay, option);
            return (
              <Pressable
                key={option.number}
                onPress={() => press(keys)}
                disabled={busy || keys === null}
                accessibilityRole="radio"
                accessibilityState={{ selected: option.highlighted, disabled: busy || keys === null }}
                accessibilityLabel={[option.label, option.detail, option.current ? 'in use' : null]
                  .filter((part): part is string => part !== null)
                  .join('. ')}
                testID={`command-option-${option.number}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.sm,
                  backgroundColor: option.highlighted ? colors.tintMuted : pressed ? colors.fillSubtle : 'transparent',
                })}>
                <View style={{ flex: 1, gap: spacing.xxs }}>
                  <Text variant="subhead" weight={option.highlighted ? '600' : '400'} color={option.highlighted ? 'tint' : 'label'}>
                    {option.label}
                  </Text>
                  {option.detail !== null && (
                    <Text variant="caption" color="secondary" numberOfLines={1}>
                      {option.detail}
                    </Text>
                  )}
                </View>
                {option.current && (
                  <Icon name="checkmark" size={size.panelGlyph} tintColor={colors.tint} fallback={<Text color="tint">✓</Text>} />
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      {overlay.scale !== null && (
        <View style={{ flexDirection: 'row', gap: spacing.xxs }} accessibilityRole="radiogroup">
          {overlay.scale.levels.map((level, index) => {
            const selected = overlay.scale?.current === index;
            const keys = overlayScaleKeys(overlay, index);
            return (
              <Pressable
                key={level}
                onPress={() => press(keys)}
                disabled={busy || keys === null}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={level}
                testID={`command-level-${level}`}
                style={{
                  flex: 1,
                  minHeight: size.segmented.height,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.sm,
                  backgroundColor: selected ? colors.tint : colors.fillSubtle,
                }}>
                <Text variant="footnote" weight={selected ? '600' : '400'} color={selected ? 'onTint' : 'label'}>
                  {level}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {overlay.adjust !== null && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Stepper glyph="chevron.left" fallback="‹" label="Less" onPress={() => press(['Left'])} busy={busy} />
          <Text variant="footnote" style={{ flex: 1, textAlign: 'center' }}>
            {overlay.adjust.label}
          </Text>
          <Stepper glyph="chevron.right" fallback="›" label="More" onPress={() => press(['Right'])} busy={busy} />
        </View>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {overlay.actions.map((action) => (
          <ActionChip key={`${action.key}-${action.label}`} action={action} busy={busy} onPress={() => press(action.keys)} />
        ))}
      </View>
    </Glass>
  );
}

function ActionChip({ action, busy, onPress }: { action: OverlayAction; busy: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const cancel = action.key === 'Esc';
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityState={{ disabled: busy }}
      testID={`command-action-${action.key}`}
      style={({ pressed }) => ({
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: radius.full,
        backgroundColor: busy || pressed ? colors.fillSubtle : cancel ? colors.secondarySystemBackground : colors.tintMuted,
      })}>
      <Text variant="subhead" weight="600" color={busy ? 'secondary' : cancel ? 'label' : 'tint'}>
        {action.label}
      </Text>
    </Pressable>
  );
}

function Stepper({
  glyph,
  fallback,
  label,
  onPress,
  busy,
}: {
  glyph: IconName;
  fallback: string;
  label: string;
  onPress: () => void;
  busy: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={spacing.sm}
      style={({ pressed }) => ({
        width: size.segmented.height,
        height: size.segmented.height,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.fillSubtle : colors.secondarySystemBackground,
      })}>
      <Icon name={glyph} size={size.panelGlyph} tintColor={busy ? colors.tertiaryLabel : colors.label} fallback={<Text>{fallback}</Text>} />
    </Pressable>
  );
}
