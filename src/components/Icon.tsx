import { SymbolView } from 'expo-symbols';
import type { ComponentProps, ReactNode } from 'react';

import { Text } from './Text';

/** The symbol names expo-symbols accepts, so callers can't invent one. */
export type IconName = ComponentProps<typeof SymbolView>['name'];

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
      name={name}
      size={size}
      type={type}
      tintColor={tintColor}
      fallback={fallback ?? <Text variant="caption">•</Text>}
    />
  );
}
