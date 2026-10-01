import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';
import { SETUP_GUIDE_URL } from '@/lib/welcome';
import { newConnection } from '@/state/connections';
import { saveSetting } from '@/state/saveSetting';
import { useTheme } from '@/theme/ThemeProvider';
import { monoFamily, radius, screenPadding, size, spacing, welcome } from '@/theme/tokens';

import { Backdrop } from './Backdrop';
import { StarCard } from './StarCard';

/**
 * The first-launch welcome: what the app is, what it needs on the other end,
 * how it works, and two ways in (the Demo, or your own computer).
 *
 * It exists because the app is only useful with a machine set up for it, and
 * nothing said so until a connection failed. It is shown once, to someone
 * with no host saved (`shouldShowWelcome`), and again from Settings on
 * request. Drawn in the App Store pictures' manner so the first screen looks
 * like the listing that brought the person here.
 */
export function WelcomeScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const last = PAGES.length - 1;

  const finish = (then?: () => void) => {
    saveSetting(db, 'welcomeSeen', true);
    router.back();
    then?.();
  };
  const goTo = (next: number) => {
    haptics.selection();
    pager.current?.scrollTo({ x: next * width, animated: true });
    setPage(next);
  };
  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  const pages: ReactNode[] = [
    <Intro key="intro" />,
    <Requirements key="needs" />,
    <Steps key="steps" />,
    <Ready
      key="ready"
      onDemo={() => finish()}
      onAddHost={() =>
        finish(() => router.push({ pathname: '/server/[id]', params: { id: newConnection().id, mode: 'new' } }))
      }
    />,
  ];

  return (
    <View testID="welcome" style={{ flex: 1, backgroundColor: colors.systemBackground }}>
      <Backdrop glow={GLOWS[page] ?? GLOWS[0]!} color={page === 1 ? colors.attention : colors.tint} />
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={{ flex: 1 }}>
        {pages.map((content, index) => (
          <ScrollView
            key={index}
            style={{ width }}
            contentContainerStyle={{
              paddingTop: insets.top + spacing.xxxl,
              paddingHorizontal: screenPadding + spacing.sm,
              paddingBottom: spacing.xxl,
              gap: spacing.xl,
              maxWidth: size.contentMaxWidth,
              width: '100%',
              alignSelf: 'center',
            }}>
            {content}
          </ScrollView>
        ))}
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: screenPadding + spacing.sm,
          paddingTop: spacing.md,
          paddingBottom: Math.max(insets.bottom, spacing.lg),
        }}>
        <Pressable
          onPress={() => finish()}
          accessibilityRole="button"
          accessibilityLabel="Skip the welcome"
          testID="welcome-skip"
          hitSlop={spacing.sm}
          style={{ opacity: page === last ? 0 : 1 }}
          disabled={page === last}>
          <Text variant="body" color="secondary">
            Skip
          </Text>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: spacing.xs }} accessibilityLabel={`Page ${page + 1} of ${PAGES.length}`}>
          {PAGES.map((_, index) => (
            <View
              key={index}
              style={{
                width: index === page ? welcome.dotActive : welcome.dot,
                height: welcome.dot,
                borderRadius: radius.full,
                backgroundColor: index === page ? colors.tint : colors.separator,
              }}
            />
          ))}
        </View>
        <Pressable
          onPress={() => (page === last ? finish() : goTo(page + 1))}
          accessibilityRole="button"
          accessibilityLabel={page === last ? 'Done' : 'Next'}
          testID="welcome-next"
          hitSlop={spacing.sm}>
          <Text variant="headline" color="tint">
            {page === last ? 'Done' : 'Next'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Where each page's glow sits, as fractions of the screen. */
const GLOWS = [
  { x: 0.1, y: 0.75 },
  { x: 0.95, y: 0.6 },
  { x: 0.05, y: 0.55 },
  { x: 0.9, y: 0.85 },
] as const;
const PAGES = GLOWS;

// MARK: - Pages

function Heading({ eyebrow, accent, children, tone = 'tint' }: { eyebrow: string; accent?: ReactNode; children: ReactNode; tone?: 'tint' | 'attention' }) {
  const { colors } = useTheme();
  const ink = tone === 'tint' ? colors.tint : colors.attention;
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ width: welcome.dot, height: welcome.dot, borderRadius: radius.full, backgroundColor: ink }} />
        <Text variant="footnote" mono style={{ color: ink }}>
          {eyebrow}
        </Text>
      </View>
      <Text variant="largeTitle" accessibilityRole="header">
        {children}
        {accent}
      </Text>
    </View>
  );
}

function Intro() {
  const { colors } = useTheme();
  return (
    <>
      <Heading eyebrow="Claude Code · Codex · OMP" accent={<Text variant="largeTitle">{'\n'}More conversation.</Text>}>
        <Text variant="largeTitle" style={{ fontFamily: monoFamily, color: colors.tint }}>
          Less terminal.
        </Text>
      </Heading>
      <Text variant="body" color="secondary">
        The coding agents running on your computer, as chats on your phone. Read what they did, answer what they ask,
        and send the next task from anywhere.
      </Text>
      <Terminal />
    </>
  );
}

/** A terminal's worth of an agent asking something, which the app turns into a chat. */
function Terminal() {
  const { colors } = useTheme();
  const line = (text: string, color: string) => (
    <Text variant="footnote" mono style={{ color }}>
      {text}
    </Text>
  );
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        padding: spacing.lg,
        gap: spacing.xxs,
        borderRadius: radius.md,
        backgroundColor: colors.secondarySystemBackground,
        borderWidth: 1,
        borderColor: colors.separator,
        transform: [{ rotate: welcome.terminalTilt }],
      }}>
      {line('~/code/herdrchat: claude', colors.tertiaryLabel)}
      {line('● Read(src/lib/herdr/client.ts)', colors.positive)}
      {line('● Found it: a failed read', colors.label)}
      {line('  looks like an empty folder.', colors.label)}
      <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.xs, borderWidth: 1, borderColor: colors.attentionBorder }}>
        {line('Before I write to client.ts…', colors.attention)}
        {line('❯ 1. Yes, go ahead', colors.attention)}
        {line('  2. No, tell me more first', colors.secondaryLabel)}
      </View>
    </View>
  );
}

function Row({ icon, title, detail, mono }: { icon: IconName; title: string; detail: string; mono?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
      <View
        style={{
          width: welcome.badge,
          height: welcome.badge,
          borderRadius: radius.xs,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.tintMuted,
        }}>
        <Icon name={icon} size={welcome.badgeGlyph} tintColor={colors.tint} />
      </View>
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <Text variant="headline">{title}</Text>
        <Text variant="subhead" color="secondary">
          {detail}
          {mono !== undefined && (
            <Text variant="subhead" mono color="tint">
              {` ${mono}`}
            </Text>
          )}
        </Text>
      </View>
    </View>
  );
}

function Requirements() {
  const { colors } = useTheme();
  return (
    <>
      <Heading eyebrow="Before you start" tone="attention" accent={<Text variant="largeTitle">{'\n'}on the other end.</Text>}>
        What you need
      </Heading>
      <Text variant="body" color="secondary">
        HerdrChat talks straight to your own computer. There is no account and no server in between, so that computer
        needs a little setup first.
      </Text>
      <View style={{ gap: spacing.lg }}>
        <Row icon="desktopcomputer" title="Your computer" detail="A Mac or Linux machine you can reach over SSH, with a password or a key." />
        <Row icon="terminal" title="herdr, running" detail="It turns each agent into a workspace the app can read. Install it from" mono="herdr.dev" />
        <Row icon="sparkles" title="An agent" detail="Claude Code, Codex or OMP, installed and signed in on that computer." />
        <Row icon="network" title="Tailscale, recommended" detail="Reach the computer from anywhere, privately, without opening a port." />
      </View>
      <Pressable
        onPress={() => void Linking.openURL(SETUP_GUIDE_URL)}
        accessibilityRole="link"
        accessibilityLabel="Read the setup guide"
        testID="welcome-setup-guide"
        hitSlop={spacing.sm}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Text variant="subhead" weight="600" color="tint">
          Read the setup guide
        </Text>
        <Icon name="arrow.up.right" size={12} tintColor={colors.tint} />
      </Pressable>
    </>
  );
}

function Step({ number, title, detail }: { number: number; title: string; detail: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
      <View
        style={{
          width: welcome.badge,
          height: welcome.badge,
          borderRadius: radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.tint,
        }}>
        <Text variant="headline" mono color="tint">
          {number}
        </Text>
      </View>
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <Text variant="headline">{title}</Text>
        <Text variant="subhead" color="secondary">
          {detail}
        </Text>
      </View>
    </View>
  );
}

function Steps() {
  return (
    <>
      <Heading eyebrow="How it works" accent={<Text variant="largeTitle">{'\n'}Then it just works.</Text>}>
        Three steps.
      </Heading>
      <View style={{ gap: spacing.xl }}>
        <Step number={1} title="Add your computer" detail="Its address and your SSH password or key. The app tests the connection before it saves anything." />
        <Step number={2} title="Your workspaces become chats" detail="Every herdr workspace shows up as a chat, grouped by what its agent is doing: waiting for you, working or idle." />
        <Step number={3} title="Answer from anywhere" detail="Reply, pick an option, send a picture or a /command, and get a notification the moment an agent needs you." />
      </View>
    </>
  );
}

function Ready({ onDemo, onAddHost }: { onDemo: () => void; onAddHost: () => void }) {
  return (
    <>
      <Heading eyebrow="Ready" accent={<Text variant="largeTitle">{'\n'}then make it yours.</Text>}>
        Try it first,
      </Heading>
      <Text variant="body" color="secondary">
        The Demo shows the whole app with sample chats, nothing to set up and nothing sent anywhere. Add your own
        computer whenever you are ready.
      </Text>
      <View style={{ gap: spacing.sm }}>
        <Button title="Add your computer" onPress={onAddHost} testID="welcome-add-host" />
        <Button title="Explore the Demo first" variant="tinted" onPress={onDemo} testID="welcome-demo" />
      </View>
      <StarCard testID="welcome-star" />
    </>
  );
}
