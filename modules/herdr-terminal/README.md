# herdr-terminal

The terminal emulator for a herdr pane, as a local Expo module: SwiftTerm on
iOS, Termux's emulator on Android (see "Android" below). Where the native side
is missing (Jest, an older build), `TerminalView` renders an empty view and
`isTerminalAvailable` is false.

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

SwiftTerm compiles a Metal shader (`Sources/SwiftTerm/Apple/Metal/Shaders.metal`),
so the iOS build needs Xcode's Metal toolchain, which Xcode 26 downloads
separately. Without it the build fails in `SwiftTerm_SwiftTerm` with "cannot
execute tool 'metal' due to missing Metal Toolchain".
`scripts/ensure-metal-toolchain.sh` installs it when missing (`xcodebuild
-downloadComponent MetalToolchain`); `testflight.sh` runs it before building.
The E2E workflow's GitHub runner needs it too; the workflow does not run it
yet.

## How it fits

`modules/herdr-ssh` opens the PTY shell on the host's existing connection and
registers it in `ShellRegistry` (`modules/herdr-shell-registry`, a pod with no
dependencies that both import; this pod cannot import HerdrSsh without
Citadel's C modules on its search paths). This module's `TerminalView` attaches to a
shell by id (`shellId`), is fed its output on the main thread, and sends what
SwiftTerm produces (typing, keys, mouse reports, answers to the program's
queries) straight back. JavaScript sees only the title, the bell, the size in
cells and the font size.

The view sizes a shell when it binds to one; after that it only REPORTS its
size (`onSizeChange`), and `useTerminalShell` resizes the host's pane with
`resizeShell` once the size holds still. The keyboard sliding in or out is a
new size every frame, and each resize redraws the pane on the desktop too.

```tsx
import { TerminalView, feed } from '../modules/herdr-terminal/src';

<TerminalView
  ref={terminal}               // focus(), blur(), paste(), clearScrollback()
  shellId={shellId}            // from openShell; a new one keeps the scrollback
  theme={theme}                // src/lib/terminal/theme.ts
  fontSize={13} minFontSize={8} maxFontSize={28}   // from tokens; pinch zooms between
  controlModifier={ctrl}       // the accessory bar's sticky Ctrl for the next typed key
  onSizeChange={({ cols, rows }) => {}}            // first layout: open the shell with it; later: resizeShell
  onModifiersReset={() => setCtrl(false)}
/>;

feed(shellId, base64);         // the Demo's recorded screens, into an echo shell
```

- SwiftTerm's own keyboard accessory is off; the app draws its own bar and
  writes its keys with `writeShellText`.
- Command-K clears the scrollback. A program's OSC 52 copy goes to the
  pasteboard; a program asking to read the pasteboard is refused.
- Links open only for http(s).
- A swipe scrolls herdr, not the emulator. Both attaches draw herdr's own
  client, on the alternate screen with the mouse on, so SwiftTerm's
  scrollback stays empty and its stock pan would send herdr a drag.
  `PaneTerminalView` drops that pan and, while a program has the mouse, turns
  a vertical one-finger swipe into wheel events (one per row of travel), which
  herdr scrolls the pane's history with. Taps are still clicks. With the mouse
  off, the swipe scrolls SwiftTerm's own scrollback.
- herdr's prefix (Ctrl-B by default) is herdr's: typed in the terminal, it
  never reaches the pane's program (prefix then `q` detaches). Both attaches
  (`agent attach`, `terminal attach`) draw the one pane alone, with no herdr
  sidebar or header.

## A shell rc that starts tmux or herdr

The attach is TYPED into the host's login shell: Citadel, the SSH library,
opens a PTY only together with an interactive login shell, so the app writes
` exec /bin/sh -c '…'` into it once its rc files have run. An rc that starts
tmux, screen or herdr itself on an SSH TTY takes over the terminal first, and
the typed line lands in that program instead of the shell: the screen shows
a tmux or herdr session of its own rather than the pane.

The app cannot mark its shell for the rc to skip. It sends no environment
variables (Citadel makes no `env` request, and sshd's `AcceptEnv` would drop
one by default), and the shell it gets is an ordinary interactive login shell
on a TTY with `TERM=xterm-256color`: `$SSH_TTY` is set and `case $- in *i*)`
matches, exactly as for a person's own `ssh`. So a guard has to come from the
other side, marking the sessions that SHOULD auto-start rather than the app's:

```sh
# ~/.zshrc or ~/.bashrc: auto-start only when the desktop asked for it
if [ -n "$SSH_TTY" ] && [ -n "$AUTO_TMUX" ] && [ -z "$TMUX" ]; then
  exec tmux new-session -A -s main
fi
```

with `SetEnv AUTO_TMUX=1` in the desktop's `~/.ssh/config` for that host
(OpenSSH 7.8 or later, and `AcceptEnv AUTO_TMUX` in the host's
`sshd_config`), or simpler, `RemoteCommand tmux new -A -s main` plus
`RequestTTY yes` in the desktop's ssh config instead of anything in the rc.

What to check by hand on a device is listed in `.maestro/README.md`
("Terminal, by hand on a device").

## Android

`android/` draws the emulator of [Termux](https://github.com/termux/termux-app)
(`terminal-emulator` and `terminal-view`, v0.118.0, from JitPack, which the
app's root `build.gradle` already lists). Those two libraries are Apache 2.0,
an exception to the rest of Termux, which is GPLv3; nothing else of Termux is
used. Pinned, like SwiftTerm: move it deliberately.

Termux's own `TerminalView` is final and drives a `TerminalSession`, which
forks a local process through JNI, so it cannot show a remote shell.
`HerdrTerminalView` therefore owns a `TerminalEmulator` (it writes to any
`TerminalOutput`), draws it with Termux's `TerminalRenderer`, and does the
keyboard and touch itself, following Termux's input code: `TYPE_NULL` input,
Return as `\r`, Ctrl and Alt applied to the next character. The props,
events and ref calls are the iOS ones. `herdr-ssh` on Android opens the shell
with an exec request on the PTY (sshj can; Citadel cannot), so there is no
login shell, MOTD or marker in front of the attach, and the rc-file caveat
above is iOS only.

A long press starts a selection and dragging moves its end; lifting offers
Copy. Termux's renderer draws a selection in reverse video, so `selection` in
the theme is unused on Android. Meta-K (the Windows or Command key on a
hardware keyboard) clears the scrollback, as Command-K does on iOS; a mouse
wheel or trackpad scrolls as a swipe does.

Changing anything under `ios/` or `android/` needs a native rebuild (`npx expo
prebuild --clean`, then `npx expo run:ios` or `npx expo run:android`).
