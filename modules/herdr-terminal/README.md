# herdr-terminal

The terminal emulator for a herdr pane, as a local Expo module. iOS only for
now; elsewhere `TerminalView` renders an empty view and `isTerminalAvailable`
is false.

## Why SwiftTerm

[SwiftTerm](https://github.com/migueldeicaza/SwiftTerm) (MIT) is the emulator
behind La Terminal and several other iOS terminals: xterm-compatible, true
colour, mouse reporting, the kitty keyboard protocol, synchronized output,
selection and a hardware keyboard's keys on iOS. It is native, so the bytes
never go through JavaScript, and it is maintained (releases monthly).
xterm.js in a WebView would put every byte through the bridge and a web view's
keyboard and selection; Blink Shell is GPL and an app, not a library.

It is pinned to v1.18.0 in the podspec. 1.19 and 1.20 add a build-tool plugin
to the SwiftTerm target, which Xcode will not run from the command line
without `-skipPackagePluginValidation` (the simulator build failed on exactly
that), so `expo run:ios` and CI would break. 1.99 is the 2.0 preview with a
new I/O layer. Move deliberately, not by range.

## How it fits

`modules/herdr-ssh` opens the PTY shell on the host's existing connection and
registers it in `ShellRegistry` (`modules/herdr-shell-registry`, a pod with no
dependencies that both import; this pod cannot import HerdrSsh without
Citadel's C modules on its search paths). This module's `TerminalView` attaches to a
shell by id (`shellId`), is fed its output on the main thread, and sends what
SwiftTerm produces (typing, keys, mouse reports, answers to the program's
queries) straight back. JavaScript sees only the title, the bell, the size in
cells and the font size.

```tsx
import { TerminalView, feed } from '../modules/herdr-terminal/src';

<TerminalView
  ref={terminal}               // focus(), blur(), paste(), clearScrollback()
  shellId={shellId}            // from openShell; a new one keeps the scrollback
  theme={theme}                // src/lib/terminal/theme.ts
  fontSize={13} minFontSize={8} maxFontSize={28}   // from tokens; pinch zooms between
  controlModifier={ctrl}       // the accessory bar's sticky Ctrl for the next typed key
  onSizeChange={({ cols, rows }) => {}}            // first layout: open the shell with it
  onModifiersReset={() => setCtrl(false)}
/>;

feed(shellId, base64);         // the Demo's recorded screens, into an echo shell
```

- SwiftTerm's own keyboard accessory is off; the app draws its own bar and
  writes its keys with `writeShellText`.
- Command-K clears the scrollback. A program's OSC 52 copy goes to the
  pasteboard; a program asking to read the pasteboard is refused.
- Links open only for http(s).

Changing anything under `ios/` needs a native rebuild (`npx expo prebuild
--clean`, then `npx expo run:ios`).
