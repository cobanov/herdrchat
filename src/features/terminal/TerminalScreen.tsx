import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { isTerminalAvailable, TerminalView, type TerminalViewHandle } from '../../../modules/herdr-terminal/src';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import type { TerminalPaneKind } from '@/lib/terminal/command';
import { terminalTheme } from '@/lib/terminal/theme';
import { useConnectionFor, useConnections } from '@/state/connections';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, terminal } from '@/theme/tokens';
import { AccessoryBar, type StickyModifiers } from './AccessoryBar';
import { useTerminalFont } from './fontSize';
import type { TerminalBackControl } from './backControl';
import { TerminalHeader } from './TerminalHeader';
import { useTerminalShell } from './useTerminalShell';

/**
 * A herdr pane's own terminal: whatever runs in it, live, in colour, typed
 * into. SwiftTerm (iOS) or Termux's emulator (Android) draws it, fed natively
 * by a PTY channel on the host's SSH connection (`modules/herdr-terminal`,
 * `modules/herdr-ssh`); none of the pane's bytes cross into JavaScript.
 *
 * For a pane no chat can show (a shell, a build, `vim`), and for an agent's
 * own screen when the chat cannot show what it is asking.
 */
export default function TerminalScreen({ connectionId, paneId, kind, terminalId, title, back, onBack }: {
  /** The chat's host. */
  connectionId: string;
  paneId: string;
  kind: TerminalPaneKind;
  /** The pane's terminal (the snapshot's `terminal_id`), which a shell pane attaches by. */
  terminalId: string | null;
  title: string;
  /** How the header's leading control draws; Back when absent. */
  back?: TerminalBackControl;
  onBack: () => void;
}) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const connection = useConnectionFor(connectionId);
  const hydrated = useConnections((state) => state.hydrated);
  const view = useRef<TerminalViewHandle>(null);
  // An iPad's hardware keyboard reaches the pane only once the terminal is
  // first responder: without this, Ctrl-C and the arrows went nowhere until a
  // tap. Not on a phone, where focusing means the software keyboard covering
  // half of what was just opened.
  const onOpened = useCallback(() => {
    if (Platform.OS === 'ios' && Platform.isPad) void view.current?.focus();
  }, []);
  const pane = useMemo(() => ({ paneId, kind, terminalId }), [paneId, kind, terminalId]);
  const shell = useTerminalShell({ connection, pane, onOpened });
  const theme = useMemo(() => terminalTheme(colors, scheme === 'dark'), [colors, scheme]);
  const fontSize = useTerminalFont((state) => state.size);
  const setFontSize = useTerminalFont((state) => state.set);
  const [modifiers, setModifiers] = useState<StickyModifiers>({ control: false, alt: false });
  const keyboardShown = useKeyboardState((state) => state.isVisible);
  // Named when it is not the selected host's: the list mixes every host's panes.
  const selectedId = useConnections((state) => state.selectedId);
  const place = connection !== null && connection.id !== selectedId ? connection.name : null;

  const header = (
    <TerminalHeader
      title={title}
      place={place}
      phase={shell.phase}
      back={back}
      onBack={onBack}
      onReconnect={shell.reconnect}
      onTakeOver={shell.takeOver}
    />
  );

  if (!isTerminalAvailable || (hydrated && connection === null)) {
    return (
      <Screen>
        {header}
        {!isTerminalAvailable ? (
          <EmptyState
            symbol="terminal"
            title="No terminal here"
            body="This build of the app has no terminal in it. Install a newer one."
          />
        ) : (
          <EmptyState symbol="server.rack" title="Host not found" body="The host this pane is on is no longer saved in the app." />
        )}
      </Screen>
    );
  }

  // Edge to edge: an iPad's terminal takes the whole width of its column,
  // not the readable width the other screens keep to. The insets are its own,
  // and measured where it is, as the thread's header measures them: beside
  // the iPad's sidebar there is no left edge to clear, alone on a phone there
  // is the status bar and, on its side, the notch. (The window's insets, read
  // as numbers, would pad the column's left for an edge that is the sidebar's.)
  return (
    <Screen presentation="edge-to-edge">
      <SafeAreaView testID="terminal-safe-area" edges={['top', 'left', 'right']} style={{ flex: 1 }}>
        {header}
        {/* The keyboard pushes the terminal up rather than covering its last
            rows, which is where a prompt is. The view takes the new height as a
            resize, and the remote pane follows. */}
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <View style={{ flex: 1, paddingHorizontal: spacing.xs }}>
            <TerminalView
              ref={view}
              testID="terminal-view"
              style={{ flex: 1 }}
              shellId={shell.shellId}
              theme={theme}
              fontSize={fontSize}
              minFontSize={terminal.minFontSize}
              maxFontSize={terminal.maxFontSize}
              controlModifier={modifiers.control}
              metaModifier={modifiers.alt}
              onSizeChange={shell.onSizeChange}
              onFontSizeChange={setFontSize}
              onModifiersReset={() => setModifiers({ control: false, alt: false })}
            />
          </View>
          <View style={{ paddingBottom: keyboardShown ? 0 : insets.bottom }}>
            <AccessoryBar
              modifiers={modifiers}
              onModifiers={setModifiers}
              onSend={shell.send}
              onPaste={() => void view.current?.paste()}
              keyboardShown={keyboardShown}
              onToggleKeyboard={() => void (keyboardShown ? view.current?.blur() : view.current?.focus())}
              disabled={shell.phase.kind !== 'open'}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}
