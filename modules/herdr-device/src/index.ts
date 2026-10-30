import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// iOS only, and only in a build that contains the module. Elsewhere (Jest,
// Android, an older dev client) there is no model, and nothing unfolds.
const Native = Platform.OS === 'ios' ? requireOptionalNativeModule<{ modelId: string }>('HerdrDevice') : null;

/** The hardware model identifier (`iPhone19,4`), the simulated one on a simulator; null without the module. */
export function deviceModelId(): string | null {
  return Native?.modelId ?? null;
}
