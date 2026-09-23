import { loadSecret } from '../connections';

/**
 * A keychain that behaves like expo-secure-store on iOS: adding an item sets
 * its accessibility, and saving over an existing item only replaces its data.
 */
const mockItems = new Map<string, { value: string; accessible: string | undefined }>();
/** Fail the nth add from now (1-based), to interrupt a migration midway. */
let mockFailAdd: number | null = null;
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: async (key: string) => mockItems.get(key)?.value ?? null,
  setItemAsync: async (key: string, value: string, options?: { keychainAccessible?: string }) => {
    const existing = mockItems.get(key);
    if (existing !== undefined) {
      existing.value = value; // SecItemUpdate with kSecValueData only
      return;
    }
    if (mockFailAdd !== null && (mockFailAdd -= 1) === 0) {
      mockFailAdd = null;
      throw new Error('keychain busy');
    }
    mockItems.set(key, { value, accessible: options?.keychainAccessible });
  },
  deleteItemAsync: async (key: string) => {
    mockItems.delete(key);
  },
}));
jest.mock('@/lib/herdr/sshTransport', () => ({ SshHerdrTransport: class {}, MissingCredentialsError: class extends Error {} }));

beforeEach(() => {
  mockItems.clear();
  mockFailAdd = null;
});

// #102: the old migration re-saved the value, which never changes accessibility.
it('moves an old secret onto the device-only accessibility', async () => {
  mockItems.set('herdrchat.secret.a', { value: 'hunter2', accessible: undefined });
  await expect(loadSecret('a')).resolves.toBe('hunter2');
  expect(mockItems.get('herdrchat.secret.a')).toEqual({ value: 'hunter2', accessible: 'whenUnlockedThisDeviceOnly' });
  expect(mockItems.has('herdrchat.secret.a.migrating')).toBe(false);
});

it('never loses the secret when the move is interrupted, and finishes it on the next read', async () => {
  mockItems.set('herdrchat.secret.b', { value: 's3cret', accessible: undefined });
  // The spare copy is added, the old item deleted, then re-adding it fails.
  mockFailAdd = 2;
  await expect(loadSecret('b')).resolves.toBe('s3cret');
  expect(mockItems.has('herdrchat.secret.b')).toBe(false);
  expect(mockItems.get('herdrchat.secret.b.migrating')?.value).toBe('s3cret');

  await expect(loadSecret('b')).resolves.toBe('s3cret');
  expect(mockItems.get('herdrchat.secret.b')).toEqual({ value: 's3cret', accessible: 'whenUnlockedThisDeviceOnly' });
  expect(mockItems.has('herdrchat.secret.b.migrating')).toBe(false);
});

it('returns nothing when there is nothing stored', async () => {
  await expect(loadSecret('none')).resolves.toBeNull();
});
