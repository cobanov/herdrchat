/**
 * What the JS runtime can tell us about the native architecture it is sitting
 * on. The brief's rule is "verify New Architecture is actually on, do not
 * assume" — a build flag in app.json is a request, these globals are the answer.
 *
 * All four are runtime-injected globals with no type declarations, so each read
 * is narrowed through `globalThis` rather than asserted.
 */
export interface RuntimeReport {
  /** Fabric renderer installed (the New Architecture's UI layer). */
  fabric: boolean;
  /** Bridgeless mode — the legacy JS↔native bridge is gone entirely. */
  bridgeless: boolean;
  /** Hermes engine rather than JSC. */
  hermes: boolean;
  /** TurboModule registry present (the New Architecture's native module layer). */
  turboModules: boolean;
}

export function runtimeReport(): RuntimeReport {
  const g = globalThis as Record<string, unknown>;
  return {
    fabric: g.nativeFabricUIManager != null,
    bridgeless: g.RN$Bridgeless === true,
    hermes: g.HermesInternal != null,
    turboModules: g.__turboModuleProxy != null || g.RN$Bridgeless === true,
  };
}
