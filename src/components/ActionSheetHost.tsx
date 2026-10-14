import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text as RNText,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Text } from './Text';
import { useActionSheet, type PresentedSheet } from '@/state/actionSheet';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, motion, radius, sheet as sheetSize, size, spacing } from '@/theme/tokens';

/**
 * Android's action sheet: a Material modal bottom sheet, mounted once at the
 * root and driven by `showActionSheet` through a store.
 *
 * It replaced `Alert.alert`, which holds at most three buttons and drops the
 * rest without a word. The long press on a chat offers five rows, so Close chat
 * and Cancel simply were not there, and since an alert ignores Back unless told
 * otherwise, the only way out of it was to pick one of the three it kept.
 *
 * The same ordering as iOS (`buildSheet`): safe actions as given, destructive
 * ones below them in red, Cancel last. It leaves the way a Material sheet
 * does: Cancel, a tap on the dim, Back, or a drag down. An action runs once the
 * sheet has gone, as on iOS, so an action that opens the next sheet (Close chat
 * asks to confirm) never stacks one on another.
 *
 * An overlay above the navigator, not a `Modal`. A Modal is a window of its
 * own, and closing it hands focus back to the app a beat later: Rename… opened
 * its sheet in that beat, and the name field's autofocus went to a window that
 * no longer had focus, so no keyboard came up.
 */
export function ActionSheetHost() {
  const presented = useActionSheet((state) => state.sheet);
  if (Platform.OS !== 'android' || presented === null) return null;
  // Keyed, so every presentation starts from closed rather than inheriting the
  // last one's animation.
  return <Sheet key={presented.id} presented={presented} />;
}

function Sheet({ presented }: { presented: PresentedSheet }) {
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const title = useRef<RNText>(null);
  const finish = useActionSheet((state) => state.finish);
  const { config } = presented;

  // 0 is gone, 1 is up; the sheet's measured height turns that into a slide.
  // Until it is measured it counts as a screen tall, so the first frame cannot
  // flash the sheet in place before it slides.
  const progress = useSharedValue(0);
  const height = useSharedValue(useWindowDimensions().height);
  const drag = useSharedValue(0);
  // Shared values rather than refs: the drag gesture, built during render,
  // reaches them through `dismiss`.
  const chosen = useSharedValue<number | null>(null);
  const closing = useSharedValue(false);

  useEffect(() => {
    // A sheet raised from the composer would otherwise open behind the keyboard.
    Keyboard.dismiss();
    progress.set(reduceMotion ? withTiming(1, { duration: motion.fade }) : withSpring(1, motion.standard));
    // What a Modal would have done for TalkBack: start reading at the sheet.
    if (title.current !== null) AccessibilityInfo.sendAccessibilityEvent(title.current, 'focus');
  }, [progress, reduceMotion]);

  const done = () => {
    finish(presented.id);
    const index = chosen.get();
    if (index !== null) config.handlers[index]?.();
  };

  const close = (index: number | null) => {
    // One way out per sheet: a second tap during the exit would run a second
    // action, or the same one twice.
    if (closing.get()) return;
    closing.set(true);
    chosen.set(index);
    progress.set(withTiming(0, { duration: motion.fadeFast }, (finished) => {
      if (finished) scheduleOnRN(done);
    }));
  };
  const dismiss = () => close(null);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => back.remove();
  });

  const pan = Gesture.Pan()
    // Down only, and only once it is clearly a drag, so a tap on a row stays a tap.
    .activeOffsetY(spacing.sm)
    .failOffsetX([-spacing.lg, spacing.lg])
    .onChange((event) => {
      drag.set(Math.max(0, drag.get() + event.changeY));
    })
    .onEnd((event) => {
      if (drag.get() > height.get() * sheetSize.dismissFraction || event.velocityY > sheetSize.dismissVelocity) {
        scheduleOnRN(dismiss);
      } else {
        drag.set(withSpring(0, motion.press));
      }
    });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, progress.get()) }));
  // Clamped at the bottom edge: the spring's overshoot would lift the sheet
  // off it and show the screen through the gap.
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(0, drag.get() + (1 - progress.get()) * height.get()) }],
  }));

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, scrimStyle]}>
        <Pressable testID="action-sheet-scrim" accessible={false} onPress={dismiss} style={{ flex: 1 }} />
      </Animated.View>

      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' }}>
        <GestureDetector gesture={pan}>
          <Animated.View
            testID="action-sheet"
            onLayout={(event) => height.set(event.nativeEvent.layout.height)}
            style={[
              {
                width: '100%',
                maxWidth: size.contentMaxWidth,
                backgroundColor: colors.secondarySystemBackground,
                borderTopLeftRadius: radius.lg,
                borderTopRightRadius: radius.lg,
                paddingTop: spacing.sm,
                paddingHorizontal: spacing.sm,
                paddingBottom: insets.bottom + spacing.sm,
              },
              sheetStyle,
            ]}>
            <View
              style={{
                alignSelf: 'center',
                width: sheetSize.handleWidth,
                height: sheetSize.handleHeight,
                borderRadius: radius.full,
                backgroundColor: colors.tertiaryLabel,
              }}
            />
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs }}>
              <Text ref={title} variant="headline" accessibilityRole="header">
                {presented.title}
              </Text>
              {presented.message !== undefined && (
                <Text variant="footnote" color="secondary">
                  {presented.message}
                </Text>
              )}
            </View>

            {config.options.map((label, index) => {
              const cancel = index === config.cancelButtonIndex;
              const destructive = config.destructiveButtonIndices.includes(index);
              return (
                <View key={`${index}-${label}`}>
                  {cancel && (
                    <View style={{ height: 1, marginHorizontal: spacing.lg, marginVertical: spacing.xs, backgroundColor: colors.separator }} />
                  )}
                  <Pressable
                    onPress={() => close(index)}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    testID={cancel ? 'action-sheet-cancel' : `action-sheet-option-${index}`}
                    android_ripple={{ color: colors.fillSubtle }}
                    style={{
                      minHeight: minTouchTarget,
                      justifyContent: 'center',
                      paddingHorizontal: spacing.lg,
                      paddingVertical: spacing.md,
                      borderRadius: radius.sm,
                      overflow: 'hidden',
                    }}>
                    <Text variant="body" color={destructive ? 'destructive' : cancel ? 'secondary' : 'label'}>
                      {label}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}
