import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType, Ref } from 'react';
import { Platform, View, type ViewProps } from 'react-native';

/**
 * The terminal's colours. Any CSS colour string React Native accepts. Build
 * it with `src/lib/terminal/theme.ts`, which derives it from the app palette.
 */
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  /** 16 ANSI colours: black, red, green, yellow, blue, magenta, cyan, white, then the bright ones. */
  ansi: readonly string[];
  /** Picks the software keyboard's appearance. */
  dark: boolean;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** What the accessory bar's sticky modifiers are after a key used them. */
export interface TerminalModifiers {
  control: boolean;
  meta: boolean;
}

/** Calls on a mounted terminal, through its ref. */
export interface TerminalViewHandle {
  /** Show the software keyboard and take a hardware keyboard's keys. */
  focus(): Promise<void>;
  blur(): Promise<void>;
  /** Paste the pasteboard's text, bracketed when the program asked. May raise "Allow Paste". */
  paste(): Promise<void>;
  clearScrollback(): Promise<void>;
}

export interface TerminalViewProps extends ViewProps {
  ref?: Ref<TerminalViewHandle>;
  /**
   * The shell this view shows, from `openShell` (herdr-ssh). Changing it (a
   * reconnect) keeps the scrollback; null shows the screen as it was left.
   */
  shellId: string | null;
  theme: TerminalTheme;
  fontSize: number;
  /** Pinch-to-zoom bounds. */
  minFontSize: number;
  maxFontSize: number;
  /** Apply Ctrl, or Alt as Meta, to the next key typed on the software keyboard. */
  controlModifier?: boolean;
  metaModifier?: boolean;
  /** The size in cells: on first layout (open the shell with it) and on every change. */
  onSizeChange?: (size: TerminalSize) => void;
  /** A pinch ended on a new size. */
  onFontSizeChange?: (fontSize: number) => void;
  onTitle?: (title: string) => void;
  onBell?: () => void;
  /** A typed key used a sticky modifier; the bar should let go of it. */
  onModifiersReset?: (modifiers: TerminalModifiers) => void;
}

type NativeProps = Omit<
  TerminalViewProps,
  'onSizeChange' | 'onFontSizeChange' | 'onTitle' | 'onBell' | 'onModifiersReset'
> & {
  onSizeChange: (event: { nativeEvent: TerminalSize }) => void;
  onFontSizeChange: (event: { nativeEvent: { fontSize: number } }) => void;
  onTitle: (event: { nativeEvent: { title: string } }) => void;
  onBell: () => void;
  onModifiersReset: (event: { nativeEvent: TerminalModifiers }) => void;
};

interface NativeModuleShape {
  feed(shellId: string, base64: string): boolean;
}

// iOS only, and only in a build that contains the module: Android has no
// emulator yet, and Jest or an older dev client has no native side.
const nativeModule =
  Platform.OS === 'ios' ? requireOptionalNativeModule<NativeModuleShape>('HerdrTerminal') : null;

const Native: ComponentType<NativeProps> | null =
  nativeModule !== null ? requireNativeView<NativeProps>('HerdrTerminal') : null;

/** Whether this build can show a terminal. The screen says so when it cannot. */
export const isTerminalAvailable = Native !== null;

/**
 * Hand bytes (base64) to the view showing `shellId`, as if the host sent them.
 * For the Demo's recorded screens; a host's bytes never pass through here.
 * False when there is no native terminal or the bytes are not base64.
 */
export function feed(shellId: string, base64: string): boolean {
  return nativeModule?.feed(shellId, base64) ?? false;
}

/**
 * A herdr pane's terminal: SwiftTerm, fed natively by a herdr-ssh shell.
 * Where there is no native terminal (Android, Jest), an empty view of the
 * same layout; check `isTerminalAvailable` to say why.
 */
export function TerminalView({
  onSizeChange,
  onFontSizeChange,
  onTitle,
  onBell,
  onModifiersReset,
  ...props
}: TerminalViewProps) {
  if (Native === null) {
    const { style, testID } = props;
    return <View style={style} testID={testID} />;
  }
  return (
    <Native
      {...props}
      onSizeChange={(event) => onSizeChange?.(event.nativeEvent)}
      onFontSizeChange={(event) => onFontSizeChange?.(event.nativeEvent.fontSize)}
      onTitle={(event) => onTitle?.(event.nativeEvent.title)}
      onBell={() => onBell?.()}
      onModifiersReset={(event) => onModifiersReset?.(event.nativeEvent)}
    />
  );
}
