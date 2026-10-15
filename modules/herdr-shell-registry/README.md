# herdr-shell-registry

Where a terminal shell's bytes change hands, natively: `herdr-ssh` registers a
shell's input and delivers its output here; `herdr-terminal`'s view attaches
to it by id. Output that arrives before the view is kept (bounded) and handed
over on attach. Also the Demo's echo shell.

No dependencies, on purpose: importing `HerdrSsh` from the terminal pod would
need Citadel's C modules on its search paths, which only a target linking the
package has (the simulator build failed with "missing required module
'_AtomicsShims'").

`swift run --package-path modules/herdr-shell-registry RegistryChecks` runs its
checks on macOS. Not a JavaScript module: it has no `src/`.
