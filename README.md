<p align="center">
  <img src="assets/icon.png" alt="HerdrChat icon" width="88">
</p>

<h1 align="center">HerdrChat</h1>

<p align="center">
  <strong>Claude Code, Codex and OMP, in your pocket.</strong><br>
  Check a reply. Unblock an agent. Get back to your coffee.
</p>

<p align="center">
  <a href="https://apps.apple.com/app/herdrchat/id6791874615"><strong>Download on the App Store</strong></a> ·
  <a href="https://herdrchat.cobanov.dev">Website</a> ·
  <a href="docs/getting-started.md">Get started</a> ·
  <a href="https://github.com/cobanov/herdrchat/issues">Issues</a>
</p>

Your agents keep running on your computer. HerdrChat turns their
[herdr](https://herdr.dev) workspaces into readable conversations on your iPhone or iPad,
connected directly over SSH. No HerdrChat account. No relay server.

<p align="center">
  <a href="docs/screenshots/chats-dark.png"><img src="docs/screenshots/chats-dark.png" alt="Dark-mode agent cards grouped by status, with chat search" width="280"></a>
  <a href="docs/screenshots/thread-blocked-dark.png"><img src="docs/screenshots/thread-blocked-dark.png" alt="Dark-mode conversation with a tool call and tappable approval choices" width="280"></a>
  <br>
  <sub>Demo conversations, captured in the iOS simulator. Tap a screenshot to zoom.</sub>
</p>

## Less terminal. More conversation.

- **Pick up where you left off.** Read Claude Code, Codex and OMP history, including replies started at your desk.
- **See what needs you.** Search chats grouped by Needs you, Working and Idle. On iPad, keep the list beside your conversation.
- **Keep things readable.** Message bubbles, code blocks, tables and compact tool activity.
- **Give an agent a nudge.** Send a follow-up or tap a supported approval choice.
- **Show it, don't describe it.** Add a screenshot or photo to a message; it goes to your machine over SSH and the agent opens it there.
- **Type like on a Mac.** With an iPad keyboard, Return sends, Shift-Return starts a new line, Command-Return sends either way, and Command-V attaches a copied picture. Settings > Conversations > Return sends turns Return back into a new line.
- **Keep your machine yours.** Connect over SSH, usually through Tailscale. Credentials stay in the iOS Keychain; host keys are pinned.

## Try it

Just curious? Open the built-in **Demo** host. No server setup needed.

For your own agents:

1. Install HerdrChat from the [App Store](https://apps.apple.com/app/herdrchat/id6791874615) (free), or [build it locally](docs/getting-started.md#build-the-ios-app).
2. Set up herdr and the [Claude, Codex or OMP integration](docs/getting-started.md#prepare-your-computer) on your computer.
3. Add that computer in **Hosts** (in the **…** menu on Chats), test the SSH connection, and open a chat.

**On the App Store** for iPhone and iPad, iOS 17+. Android is experimental.
Push notifications need extra setup on your host. See
[setup and limitations](docs/getting-started.md).

## Machines

If herdr on your host has other computers saved as machines
(`herdr machine add <ssh-target>`), their chats show up in that host's chat
list too, each row starting with the machine's name. There is nothing to set
up on the phone: the app reaches each machine through the host, with the
host's own `ssh` and its `~/.ssh/config`, so the machine never has to be
reachable from the phone. Opening, following and sending work as they do for
the host's own chats. Disabled machines are left out. Push notifications
cover only the host's own chats for now, and a machine uses its host's theme.

The host's `ssh` runs without a terminal (`BatchMode=yes`), inside the SSH
session the app opened, so it has to reach the machine on its own: with a key
file that the host's `~/.ssh/config` names for the machine (`IdentityFile`),
not an agent that asks for approval on the host's screen or one only its
desktop login has, and with the machine already in the host's
`~/.ssh/known_hosts`. An interactive `ssh klaw` on the host can pass where this
fails, so check it from another computer:
`ssh <host> 'ssh -o BatchMode=yes klaw true'`. If that fails, add the key to the
host's config, or run `ssh klaw` once on the host to accept its host key. The
list says which of the two it is under the chats. herdr must also be where a
non-interactive SSH session on the machine looks (`~/.local/bin`, `~/bin`,
`/opt/homebrew/bin` or `/usr/local/bin`); one in `~/.cargo/bin` needs a link
into `~/.local/bin`.

## Theming

Each host can restyle the app with a file of its own, `~/.herdrchat/theme.json`,
so the easiest way to change how HerdrChat looks is to ask an agent on that
machine. **Settings → Appearance → Copy prompt for an agent** puts the request
on your clipboard; paste it into a chat and add what you would like ("warmer",
"green, like my terminal"). The phone picks the change up the next time the
chat list is on screen (it checks about every 10 seconds there), or at once
from **Reload theme**, and the theme follows whichever host is selected. See
[the file's shape](docs/getting-started.md#theming).

## Want to tinker?

Expo + React Native + TypeScript, with a native SSH module. The agents run on
your computer, not on the phone.

[Build & test](docs/getting-started.md#build-the-ios-app) ·
[Contributing](CONTRIBUTING.md) ·
[Conventions](CLAUDE.md) ·
[Releasing](RELEASING.md) ·
[Security](SECURITY.md)

---

[Apache-2.0](LICENSE) · [Third-party notices](NOTICE)
