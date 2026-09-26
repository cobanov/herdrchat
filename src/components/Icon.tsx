import { SymbolView, type AndroidSymbol } from 'expo-symbols';
import type { ComponentProps, ReactNode } from 'react';

import { Text } from './Text';

/** SF Symbol names, so callers can't invent one. */
export type IconName = Extract<ComponentProps<typeof SymbolView>['name'], string>;

/**
 * The Material Symbol drawn for each SF Symbol on Android.
 *
 * expo-symbols renders on Android only when it is given a Material name, and
 * every icon here was SF-only, so the Android app showed "•" for all of them
 * (#4 acceptance). One table keeps call sites platform-free; an unmapped name
 * falls back to the caller's fallback as before.
 */
const MATERIAL: Partial<Record<IconName, AndroidSymbol>> = {
  'arrow.clockwise': 'refresh',
  'arrow.down.circle.fill': 'arrow_circle_down',
  'arrow.up.circle': 'arrow_circle_up',
  'arrow.up.circle.fill': 'arrow_circle_up',
  'arrow.up.right': 'north_east',
  asterisk: 'asterisk',
  'bubble.left.and.bubble.right': 'forum',
  'bubble.left.and.bubble.right.fill': 'forum',
  checkmark: 'check',
  'checkmark.square.fill': 'check_box',
  'chevron.down': 'expand_more',
  'chevron.left': 'chevron_left',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron_right',
  'chevron.up': 'expand_less',
  circle: 'radio_button_unchecked',
  'circle.fill': 'fiber_manual_record',
  'ellipsis.circle': 'pending',
  'exclamationmark.bubble.fill': 'chat_error',
  'exclamationmark.circle': 'error',
  'exclamationmark.triangle': 'warning',
  'exclamationmark.triangle.fill': 'warning',
  'folder.fill': 'folder',
  gearshape: 'settings',
  'gearshape.fill': 'settings',
  magnifyingglass: 'search',
  pencil: 'edit',
  photo: 'image',
  'photo.on.rectangle': 'photo_library',
  plus: 'add',
  'server.rack': 'dns',
  square: 'check_box_outline_blank',
  'square.and.pencil': 'edit_square',
  'stop.circle': 'stop_circle',
  tray: 'inbox',
  'wrench.and.screwdriver': 'build',
  'wrench.and.screwdriver.fill': 'build',
  xmark: 'close',
  'xmark.circle.fill': 'cancel',
};

/**
 * SF Symbols, with a text fallback.
 *
 * A thin wrapper so screens can take an `IconName` prop rather than a bare
 * string — the symbol set is typed, and a typo'd name renders nothing at all on
 * a device, which is exactly the sort of thing that survives review.
 *
 * Named `Icon`, not `Symbol`: the latter shadows the global `Symbol`
 * constructor, which TypeScript reports as an unrelated JSX error.
 */
export function Icon({
  name,
  size = 17,
  tintColor,
  fallback,
  type,
}: {
  name: IconName;
  size?: number;
  tintColor?: string;
  fallback?: ReactNode;
  type?: ComponentProps<typeof SymbolView>['type'];
}) {
  return (
    <SymbolView
      name={MATERIAL[name] === undefined ? name : { ios: name, android: MATERIAL[name] }}
      size={size}
      type={type}
      tintColor={tintColor}
      fallback={fallback ?? <Text variant="caption">•</Text>}
    />
  );
}
