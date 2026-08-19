# Security

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Report a vulnerability** on this
repository. That opens a channel only the maintainers can see. Please do not
open a public issue for anything that could be used against someone's machine
before there is a fix.

Say what you found, how to reproduce it, and what an attacker gets. A first
response should come within a few days; this is a small project, not a company
with a rota.

## What is worth reporting

HerdrChat holds SSH credentials for machines people own and administer, and it
is the thing standing between a phone and a shell. The interesting attack
surface is small but it matters:

- **Credential handling.** Secrets live in the iOS keychain, written
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` so they do not travel in encrypted device
  backups. Anything that puts a private key or password somewhere else — a log,
  a crash report, the clipboard, a diagnostics block — is a bug worth reporting.
- **Host key verification.** The app pins a host's key on first contact and
  refuses a later connection presenting a different one. Any path that reaches
  a connection with pinning disabled, silently drops a pin, or accepts a key
  that does not match one is serious. Both platforms report the fingerprint in
  OpenSSH's `SHA256:` form so it can be compared against `ssh-keygen -lf` by
  eye.
- **Command construction.** Everything the app does on the host is a shell
  command built from values it holds — paths, session ids, workspace ids. An
  input that escapes its quoting and executes something else is the highest
  severity thing in this codebase.
- **What leaves the device.** There is no back end, no account and no
  analytics. Anything that contradicts that — a request to a server we do not
  operate, an identifier sent anywhere — is a bug regardless of its impact.

## What is out of scope

- The security of the machine you connect to. HerdrChat is an SSH client; it
  does not harden your host, and an agent you started can do whatever that
  account can do.
- herdr itself. Report those at https://herdr.dev.
- Anything requiring an already-unlocked, already-compromised device.
- The permission mode you choose. Running an agent with
  `--permission-mode bypassPermissions` means it does not ask before acting;
  that is the documented behaviour of the setting, not a flaw in the client.

## Supported versions

The latest release. This is a young project shipping frequently — fixes go to
the current version rather than being backported.
