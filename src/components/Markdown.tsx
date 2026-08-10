import { Linking, ScrollView, View } from 'react-native';

import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, typography } from '@/theme/tokens';
import { parseInline, parseMarkdown, type InlineSpan, type MarkdownBlock } from '@/lib/markdown';

/**
 * Renders the Markdown Claude actually emits, inside a chat bubble.
 *
 * Block layout is done here rather than with one styled string because a single
 * string cannot lay out code blocks, lists or tables on their own rows. Parsing
 * lives in `src/lib/markdown.ts` so the fiddly rules stay testable.
 */
export function Markdown({ text, onTint = false }: { text: string; onTint?: boolean }) {
  const blocks = parseMarkdown(text);
  return (
    <View style={{ gap: spacing.sm }}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} onTint={onTint} />
      ))}
    </View>
  );
}

function Block({ block, onTint }: { block: MarkdownBlock; onTint: boolean }) {
  const { colors } = useTheme();
  const fill = onTint ? 'rgba(255,255,255,0.18)' : colors.fillSubtle;

  switch (block.kind) {
    case 'paragraph':
      return <Inline text={block.text} onTint={onTint} />;

    case 'heading':
      return (
        <Inline
          text={block.text}
          onTint={onTint}
          variant={block.level === 1 ? 'title3' : block.level === 2 ? 'headline' : 'subhead'}
          weight="600"
        />
      );

    case 'bullet':
      return (
        <View style={{ gap: spacing.xs }}>
          {block.items.map((item, index) => (
            <ListRow key={index} marker="•" text={item} onTint={onTint} />
          ))}
        </View>
      );

    case 'numbered':
      return (
        <View style={{ gap: spacing.xs }}>
          {block.items.map((item, index) => (
            <ListRow key={index} marker={`${index + 1}.`} text={item} onTint={onTint} />
          ))}
        </View>
      );

    case 'quote':
      return (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View
            style={{
              width: 3,
              borderRadius: 1.5,
              backgroundColor: onTint ? 'rgba(255,255,255,0.4)' : colors.tertiaryLabel,
            }}
          />
          <View style={{ flex: 1 }}>
            <Inline text={block.text} onTint={onTint} italic />
          </View>
        </View>
      );

    case 'code':
      return (
        <View style={{ backgroundColor: fill, borderRadius: radius.xs, padding: spacing.sm }}>
          {block.language !== null && (
            <Text variant="caption2" color={onTint ? 'onTint' : 'secondary'} mono>
              {block.language.toLowerCase()}
            </Text>
          )}
          {/* Code must scroll rather than wrap: a wrapped command line is a
              different command line, and this is a surface people copy from. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text variant="footnote" color={onTint ? 'onTint' : 'label'} mono selectable>
              {block.content}
            </Text>
          </ScrollView>
        </View>
      );

    case 'table':
      return <Table headers={block.headers} rows={block.rows} onTint={onTint} fill={fill} />;

    case 'rule':
      return (
        <View
          style={{
            height: 1,
            backgroundColor: onTint ? 'rgba(255,255,255,0.25)' : colors.separator,
            marginVertical: spacing.xxs,
          }}
        />
      );
  }
}

function ListRow({
  marker,
  text,
  onTint,
}: {
  marker: string;
  text: string;
  onTint: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      <Text
        variant="body"
        color={onTint ? 'onTint' : 'secondary'}
        style={{ fontVariant: ['tabular-nums'] }}>
        {marker}
      </Text>
      <View style={{ flex: 1 }}>
        <Inline text={text} onTint={onTint} />
      </View>
    </View>
  );
}

function Table({
  headers,
  rows,
  onTint,
  fill,
}: {
  headers: string[];
  rows: string[][];
  onTint: boolean;
  fill: string;
}) {
  const { colors } = useTheme();
  const columns = Math.max(headers.length, ...rows.map((row) => row.length), 0);
  const line = onTint ? 'rgba(255,255,255,0.22)' : colors.separator;

  // Wide tables scroll inside their own container rather than squeezing the
  // bubble — the page itself must never scroll horizontally.
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ backgroundColor: fill, borderRadius: radius.xs }}>
      <View style={{ padding: spacing.sm }}>
        <TableRow cells={headers} columns={columns} header onTint={onTint} line={line} />
        <View style={{ height: 1, backgroundColor: line }} />
        {rows.map((row, index) => (
          <View key={index}>
            <TableRow cells={row} columns={columns} onTint={onTint} line={line} />
            {index < rows.length - 1 && (
              <View style={{ height: 1, backgroundColor: line, opacity: 0.5 }} />
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function TableRow({
  cells,
  columns,
  header = false,
  onTint,
  line,
}: {
  cells: string[];
  columns: number;
  header?: boolean;
  onTint: boolean;
  line: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {Array.from({ length: columns }, (_, index) => (
        <View key={index} style={{ flexDirection: 'row' }}>
          <View
            style={{
              minWidth: 56,
              maxWidth: 220,
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.xs,
            }}>
            <Text
              variant="footnote"
              color={onTint ? 'onTint' : 'label'}
              weight={header ? '600' : '400'}>
              {cells[index] ?? ''}
            </Text>
          </View>
          {index < columns - 1 && <View style={{ width: 1, backgroundColor: line, opacity: 0.6 }} />}
        </View>
      ))}
    </View>
  );
}

function Inline({
  text,
  onTint,
  variant = 'body',
  weight,
  italic = false,
}: {
  text: string;
  onTint: boolean;
  variant?: keyof typeof typography;
  weight?: '400' | '600' | '700';
  italic?: boolean;
}) {
  const { colors } = useTheme();
  const spans = parseInline(text);

  return (
    <Text
      variant={variant}
      color={onTint ? 'onTint' : 'label'}
      weight={weight}
      selectable
      style={italic ? { fontStyle: 'italic' } : undefined}>
      {spans.map((span, index) => (
        <Span key={index} span={span} onTint={onTint} colors={colors} variant={variant} />
      ))}
    </Text>
  );
}

/**
 * One run of inline text.
 *
 * Every branch names its colour and its size, and that is not redundancy.
 * `Text` always WRITES a colour and a font size — its defaults are `label` and
 * `body` — so a nested span does not inherit what the surrounding `Text` set,
 * it overrides it. Two consequences, both of which were live:
 *
 * A message on the tint rendered in the label colour. Invisible in dark, where
 * label and onTint are both white; in light it was near-black text inside a
 * periwinkle bubble.
 *
 * And a heading containing bold or code dropped to body size at exactly that
 * span, so `## Some **bold** word` changed size mid-line.
 */
function Span({
  span,
  onTint,
  colors,
  variant,
}: {
  span: InlineSpan;
  onTint: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  variant: keyof typeof typography;
}) {
  const ink = onTint ? 'onTint' : 'label';
  switch (span.kind) {
    case 'bold':
      return (
        <Text color={ink} variant={variant} weight="700">
          {span.text}
        </Text>
      );
    case 'italic':
      return (
        <Text color={ink} variant={variant} style={{ fontStyle: 'italic' }}>
          {span.text}
        </Text>
      );
    case 'code':
      return (
        <Text
          mono
          color={ink}
          variant={variant}
          style={{ backgroundColor: onTint ? 'rgba(255,255,255,0.22)' : colors.fillSubtle }}>
          {span.text}
        </Text>
      );
    case 'link':
      return (
        <Text
          // On the tint, lavender measured 2.81:1 — a link you have to hunt for
          // inside your own message. White clears 4.60:1 there, and the underline
          // is what carries "this is a link" once the colour no longer can.
          style={
            onTint
              ? { color: colors.onTint, textDecorationLine: 'underline' }
              : { color: colors.tint }
          }
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL(span.href);
          }}>
          {span.text}
        </Text>
      );
    case 'text':
      return (
        <Text color={ink} variant={variant}>
          {span.text}
        </Text>
      );
  }
}
