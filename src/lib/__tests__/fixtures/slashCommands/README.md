# Slash-command fixtures

Synthetic, by design. Claude Code is proprietary and this repo is Apache-2.0,
so nothing here is copied out of its bundle: the commands (`/frobnicate`,
`/tidy`, …), their descriptions and the code around them are made up. What
the files keep is the *shape* the grep and the parser rely on:

- `synthetic-literals.txt`: what the grep prints, one command literal a line.
  Keys in the usual and in other orders, a computed description (a getter, a
  ternary, a template), a computed hint, hidden and disabled ones, an
  interactive and a non-interactive literal of one name, bundled skills, and
  decoys that pass the grep but are not commands.
- `synthetic-bundle.txt`: a stand-in for the binary the script greps, with
  noise around the literals and one literal longer than the line the script
  keeps (`BUILTIN_LINE_BYTES`).

Do not regenerate these from a real `claude` binary. The test that reads the
installed one runs only with `HERDRCHAT_REAL_CLAUDE=1` and checks nothing
into the tree.
