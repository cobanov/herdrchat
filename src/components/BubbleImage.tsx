import { useState } from 'react';
import { Image, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './Icon';
import { Text } from './Text';
import { localImageUri } from '@/state/attachmentFiles';
import { useTheme } from '@/theme/ThemeProvider';
import { minTouchTarget, radius, size, spacing } from '@/theme/tokens';

/**
 * A picture in a bubble. The phone's own copy when it sent the picture, shown
 * at its own proportions and opened full screen on a tap; otherwise a label,
 * since the picture itself lives on the host.
 */
export function BubbleImage({ path, onTint }: { path: string; onTint: boolean }) {
  const { colors } = useTheme();
  // Taken from the app's own provider: inside a Modal the safe-area view measured
  // no insets and put the close button under the status bar.
  const insets = useSafeAreaInsets();
  const uri = localImageUri(path);
  const [aspect, setAspect] = useState(1);
  const [open, setOpen] = useState(false);

  if (uri === null) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Icon
          name="photo"
          tintColor={onTint ? colors.onTint : colors.secondaryLabel}
          fallback={<Text variant="footnote" color={onTint ? 'onTint' : 'secondary'}>▣</Text>}
        />
        <Text variant="footnote" color={onTint ? 'onTint' : 'secondary'}>
          Picture
        </Text>
      </View>
    );
  }

  const wide = aspect >= 1;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel="Picture"
        accessibilityHint="Opens it full screen"
        testID="bubble-image">
        <Image
          source={{ uri }}
          accessibilityIgnoresInvertColors
          onLoad={(event) => {
            const { width, height } = event.nativeEvent.source;
            if (width > 0 && height > 0) setAspect(width / height);
          }}
          style={{
            width: wide ? size.bubbleImage : size.bubbleImage * aspect,
            height: wide ? size.bubbleImage / aspect : size.bubbleImage,
            borderRadius: radius.sm,
            backgroundColor: colors.fillSubtle,
          }}
        />
      </Pressable>
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: colors.systemBackground,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.sm }}>
            <Pressable
              onPress={() => setOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close picture"
              testID="image-viewer-close"
              style={{ width: minTouchTarget, height: minTouchTarget, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="xmark" size={size.composerAccessoryGlyph} tintColor={colors.label} fallback={<Text>✕</Text>} />
            </Pressable>
          </View>
          {/* A tap anywhere on the picture closes it too. */}
          <Pressable onPress={() => setOpen(false)} accessible={false} style={{ flex: 1 }}>
            <Image source={{ uri }} resizeMode="contain" accessibilityIgnoresInvertColors style={{ flex: 1 }} />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}
