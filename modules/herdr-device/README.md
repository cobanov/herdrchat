# herdr-device

The device's model identifier (`iPhone19,4`), which is how the app knows an
iPhone unfolds: the iPhone Duo is the `phone` idiom, so `Platform.isPad` is
false on it folded or open, and its open screen (669 × 951 pt) is narrower
than an iPad's.

On a simulator the identifier is the simulated device's
(`SIMULATOR_MODEL_IDENTIFIER`), not the Mac's `arm64`, so the Duo simulator
is a Duo. iOS only; `deviceModelId()` is null elsewhere. Which models unfold
is decided in `src/lib/splitView.ts`, where a test pins it.
