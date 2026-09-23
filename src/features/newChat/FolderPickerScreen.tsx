import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Icon } from '@/components/Icon';
import { HerdrError } from '@/lib/herdr/protocol';
import { clientFor, useSelectedConnection } from '@/state/connections';
import { useNewChatDraft } from '@/state/newChatDraft';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, screenPadding, spacing } from '@/theme/tokens';

/**
 * Browse the host's filesystem to pick a working directory, instead of typing an
 * absolute path from memory.
 *
 * One shell round-trip per level, over the same connection the rest of the app
 * uses. An empty directory and one that could not be read are two different
 * answers and are shown as two different screens: "No subfolders here" claims
 * the listing succeeded, and saying it about a folder we never opened sent
 * people looking for a folder the picker had simply hidden.
 */
export default function FolderPickerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const connection = useSelectedConnection();
  const params = useLocalSearchParams<{ start?: string }>();
  const pick = useNewChatDraft((state) => state.pick);

  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const navigate = useCallback(
    async (target: string) => {
      if (connection === null) return;
      setLoading(true);
      setPath(target);
      setError(null);
      try {
        const client = await clientFor(connection);
        setEntries(await client.listDirectories(target));
      } catch (thrown) {
        setEntries([]);
        setError(describe(thrown));
      } finally {
        setLoading(false);
      }
    },
    [connection]
  );

  /**
   * Where browsing starts: the deep-linked path, or the host's home directory.
   *
   * This had no catch at all, so a host that answered nothing left the spinner
   * turning for as long as the sheet stayed open. It is also what Retry re-runs
   * while no path has been reached yet.
   */
  const openStart = useCallback(async () => {
    if (connection === null) return;
    const start = (params.start ?? '').trim();
    if (start.length > 0) {
      await navigate(start);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const client = await clientFor(connection);
      await navigate(await client.homeDirectory());
    } catch (thrown) {
      setError(describe(thrown));
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, navigate]);

  useEffect(() => {
    // openStart updates state before its first await, so calling it directly here
    // would be a synchronous setState in an effect body. A microtask also gives the
    // cleanup somewhere to land when the sheet closes mid-flight.
    let cancelled = false;
    void Promise.resolve().then(() => (cancelled ? undefined : openStart()));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  const retry = useCallback(() => {
    void (path.length > 0 ? navigate(path) : openStart());
  }, [navigate, openStart, path]);

  const parent = path === '/' ? '/' : path.slice(0, path.lastIndexOf('/')) || '/';
  const child = (name: string) => (path === '/' ? `/${name}` : `${path}/${name}`);

  return (
    <Screen presentation="sheet">
      <Header title="Choose folder" onClose={() => router.back()} />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: screenPadding,
          paddingBottom: spacing.sm,
        }}>
        <Pressable
          onPress={() => void navigate(parent)}
          disabled={path === '/' || path.length === 0 || loading}
          accessibilityRole="button"
          accessibilityLabel="Parent folder"
          testID="folder-up"
          style={{
            padding: spacing.sm,
            borderRadius: radius.sm,
            backgroundColor: colors.secondarySystemBackground,
            opacity: path === '/' || loading ? 0.4 : 1,
          }}>
          <Icon
            name="chevron.up"
            size={14}
            tintColor={colors.tint}
            fallback={<Text color="tint">↑</Text>}
          />
        </Pressable>
        <Text variant="footnote" color="secondary" mono numberOfLines={1} style={{ flex: 1 }}>
          {path}
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.tint} />
        </View>
      ) : error !== null ? (
        // An error is not an empty folder. Saying "No subfolders here" for a
        // path we never opened is the bug this state exists to end.
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ErrorBanner message={error} actionLabel="Retry" onAction={retry} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: screenPadding }}>
          {entries.length === 0 ? (
            <Text variant="callout" color="secondary" style={{ padding: spacing.lg }}>
              No subfolders here.
            </Text>
          ) : (
            entries.map((name) => (
              <Pressable
                key={name}
                onPress={() => void navigate(child(name))}
                accessibilityRole="button"
                accessibilityLabel={`Open ${name}`}
                testID={`folder-${name}`}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  paddingVertical: spacing.md,
                  opacity: pressed ? 0.5 : 1,
                })}>
                <Icon
                  name="folder.fill"
                  size={18}
                  tintColor={colors.tint}
                  fallback={<Text color="tint">▸</Text>}
                />
                <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
                  {name}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      <View style={{ padding: screenPadding, gap: spacing.sm }}>
        <Button
          title="Use this folder"
          onPress={() => {
            pick(path);
            router.back();
          }}
          disabled={path.length === 0 || loading || error !== null}
          testID="folder-select"
        />
      </View>
    </Screen>
  );
}

/** The host's own words when it gave any, rather than a shrug. */
function describe(thrown: unknown): string {
  return thrown instanceof HerdrError
    ? thrown.message
    : "Couldn't read that folder on the host.";
}
