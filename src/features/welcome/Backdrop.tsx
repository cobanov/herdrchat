import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { welcome } from '@/theme/tokens';

/**
 * The welcome's background: the faint grid and soft glow of the App Store
 * pictures, behind whatever page is showing. `glow` places the light; each
 * page sets its own so moving through them feels like moving across one
 * surface.
 */
export function Backdrop({ glow, color }: { glow: { x: number; y: number }; color: string }) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const columns = Math.ceil(width / welcome.gridStep);
  const rows = Math.ceil(height / welcome.gridStep);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: welcome.glowRings }, (_, ring) => {
        const diameter = welcome.glowSize * (1 - ring / welcome.glowRings);
        return (
          <View
            key={ring}
            style={{
              position: 'absolute',
              left: glow.x * width - diameter / 2,
              top: glow.y * height - diameter / 2,
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              backgroundColor: color,
              opacity: welcome.glowOpacity,
            }}
          />
        );
      })}
      <View style={[StyleSheet.absoluteFill, { opacity: welcome.gridOpacity }]}>
        {Array.from({ length: columns }, (_, column) => (
          <View
            key={`c${column}`}
            style={{ position: 'absolute', top: 0, bottom: 0, left: column * welcome.gridStep, width: StyleSheet.hairlineWidth, backgroundColor: colors.separator }}
          />
        ))}
        {Array.from({ length: rows }, (_, row) => (
          <View
            key={`r${row}`}
            style={{ position: 'absolute', left: 0, right: 0, top: row * welcome.gridStep, height: StyleSheet.hairlineWidth, backgroundColor: colors.separator }}
          />
        ))}
      </View>
    </View>
  );
}
