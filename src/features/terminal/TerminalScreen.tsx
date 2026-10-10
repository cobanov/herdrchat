import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isTerminalAvailable, TerminalView, type TerminalViewHandle } from '../../../modules/herdr-terminal/src';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import type { TerminalPaneKind } from '@/lib/terminal/command';
import { terminalTheme } from '@/lib/terminal/theme';
import { clientFor, isMachineConnection, useConnectionFor, useConnections } from '@/state/connections';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, terminal } from '@/theme/tokens';
import { AccessoryBar, type StickyModifiers } from './AccessoryBar';
import { useTerminalFont } from './fontSize';
import { TerminalHeader } from './TerminalHeader';
import { useTerminalShell } from './useTerminalShell';

/**
 * A herdr pane's own terminal: whatever runs in it, live, in colour, typed
 * into. SwiftTerm draws it, fed natively by a PTY channel on the host's SSH
 * connection (`modules/herdr-terminal`, `modules/herdr-ssh`); none of the
 * pane's bytes cross into JavaScript.
 *
 * For a pane no chat can show (a shell, a build, `vim`), and for an agent's
 * own screen when the chat cannot show what it is asking.
 */
export default function TerminalScreen({ connectionId, paneId, kind, title, onBack }: {
  /** The chat's connection: a host, or one of its machines. */
  connectionId: string;
  paneId: string;
  kind: TerminalPaneKind;
  title: string;
  onBack: () => void;
}) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const connection = useConnectionFor(connectionId);
  const hydrated = useConnections((state) => state.hydrated);
  const client = useMemo(() => (connection === null ? null : clientFor(connection)), [connection]);
  const view = useRef<TerminalViewHandle>(null);
  // An iPad's hardware keyboard reaches the pane only once the terminal is
  // first responder: without this, Ctrl-C and the arrows went nowhere until a
  // tap. Not on a phone, where focusing means the software keyboard covering
  // half of what was just opened.
  const onOpened = useCallback(() => {
    if (Platform.OS === 'ios' && Platform.isPad) void view.current?.focus();
  }, []);
  const shell = useTerminalShell({ connection, client, paneId, kind, onOpened });
  const theme = useMemo(() => terminalTheme(colors, scheme === 'dark'), [colors, scheme]);
  const fontSize = useTerminalFont((state) => state.size);
  const setFontSize = useTerminalFont((state) => state.set);
  const [modifiers, setModifiers] = useState<StickyModifiers>({ control: false, alt: false });
  const keyboardShown = useKeyboardState((state) => state.isVisible);
  const place = connection !== null && isMachineConnection(connection) ? connection.name : null;

  const header = (
    <TerminalHeader title={title} place={place} phase={shell.phase} onBack={onBack} onReconnect={shell.reconnect} />
  );

  if (!isTerminalAvailable || (hydrated && connection === null)) {
    return (
      <Screen>
        {header}
        {!isTerminalAvailable ? (
          <EmptyState
            symbol="terminal"
            title="No terminal here"
            body={Platform.OS === 'ios'
              ? 'This build of the app has no terminal in it. Install a newer one.'
              : 'The terminal is on iPhone and iPad only for now.'}
          />
        ) : (
          <EmptyState symbol="server.rack" title="Host not found" body="The host this pane is on is no longer saved in the app." />
        )}
      </Screen>
    );
  }

  // Edge to edge: an iPad's terminal takes the whole width, not the
  // readable column the other screens keep to. The insets are its own.
  return (
    <Screen presentation="edge-to-edge">
      <View style={{ flex: 1, paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
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
      </View>
    </Screen>
  );
}
