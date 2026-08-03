import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/Button';
import { Header } from '@/components/Header';
import { Text } from '@/components/Text';
import { clientFor, useSelectedConnection } from '@/state/connections';
import { useNewChatDraft } from '@/state/newChatDraft';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

/**
 * Browse the host's filesystem to pick a working directory, instead of typing an
 * absolute path from memory.
 *
 * One shell round-trip per level, over the same connection the rest of the app
 * uses. Listing is best-effort: an unreadable directory yields an empty list
 * rather than an error, because "you can't go in there" is adequately expressed
 * by there being nothing to go into.
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

  const navigate = useCallback(
    async (target: string) => {
      if (connection === null) return;
      setLoading(true);
      setPath(target);
      try {
        const client = await clientFor(connection);
        setEntries(await client.listDirectories(target));
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [connection]
  );

  useEffect(() => {
    void (async () => {
      if (connection === null) return;
      const start = (params.start ?? '').trim();
      if (start.length > 0) {
        await navigate(start);
        return;
      }
      const client = await clientFor(connection);
      await navigate(await client.homeDirectory());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection]);

  const parent = path === '/' ? '/' : path.slice(0, path.lastIndexOf('/')) || '/';
  const child = (name: string) => (path === '/' ? `/${name}` : `${path}/${name}`);

  return (
    <View style={{ flex: 1, backgroundColor: colors.systemBackground }}>
      <Header title="Choose folder" onClose={() => router.back()} />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
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
            borderRadius: radius.card,
            backgroundColor: colors.secondarySystemBackground,
            opacity: path === '/' || loading ? 0.4 : 1,
          }}>
          <SymbolView
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
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.md }}>
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
                <SymbolView
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

      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <Button
          title="Use this folder"
          onPress={() => {
            pick(path);
            router.back();
          }}
          disabled={path.length === 0 || loading}
          testID="folder-select"
        />
      </View>
    </View>
  );
}
