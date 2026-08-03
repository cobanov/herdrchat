# Maestro flows

Run against a booted simulator with the app installed and Metro running:

```bash
maestro test .maestro/
```

## Credentials

`add-server.yaml` needs a real host, because the whole point of that flow is
that the connection test actually connects. It reads them from the environment
rather than the file, so no key is ever committed:

```bash
maestro test .maestro/add-server.yaml \
  -e HOST=100.x.y.z \
  -e USERNAME=you \
  -e SSH_KEY="$(awk '{printf "%s\\n", $0}' ~/.ssh/id_ed25519)"
```

The key must be a single line with escaped newlines — `inputText` cannot type a
multi-line value.

## Notes for writing flows here

- **Don't use `clearState`.** On a development build it also wipes the dev
  client's saved bundler URL, so the app launches into the launcher's server
  picker instead of the app.
- **Scroll before tapping anything below the fold.** `tapOn` does not scroll,
  and on a form it will silently leave focus where it was — a key typed into the
  username field looks like a flaky test but is actually a typo you wrote.
- **Chat rows are matched by `testID`, not by their label.** Each row is one
  accessibility element with a composed label (title, state, preview), which is
  correct for VoiceOver and means the title is not separately matchable.
