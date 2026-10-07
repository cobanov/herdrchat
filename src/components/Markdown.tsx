import { Fragment, useState } from 'react';
import { Alert, Linking, ScrollView, View, type LayoutChangeEvent } from 'react-native';

import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, size, spacing, typography } from '@/theme/tokens';
import {
  parseInline,
  parseMarkdown,
  type InlineSpan,
  type MarkdownBlock,
  type TableAlign,
} from '@/lib/markdown';

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
            <ListRow key={index} marker={`${block.start + index}.`} text={item} onTint={onTint} />
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
          <View style={{ flexShrink: 1 }}>
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
      return <Table table={block} onTint={onTint} fill={fill} />;

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
      {/* Keep the text's intrinsic width inside a content-sized chat bubble. */}
      <View style={{ flexShrink: 1 }}>
        <Inline text={text} onTint={onTint} />
      </View>
    </View>
  );
}

/**
 * A table, built column by column.
 *
 * It used to be built row by row, each cell as wide as its own text, so every
 * row put its column boundaries somewhere different and the table came out
 * skewed. React Native has no grid, but a column of cells is as wide as its
 * widest cell, so a table made of columns lines up across rows in one pass.
 *
 * What a column cannot see is its neighbours: a cell that wraps makes its row
 * taller in its own column only. Each cell therefore reports its natural
 * height, and every cell in a row is held to the tallest. The height is
 * measured on a view nothing is forced onto, so holding a row up never feeds
 * back into the measurement, and a table whose cells do not wrap unevenly
 * never needs a second pass.
 */
function Table({
  table,
  onTint,
  fill,
}: {
  table: Extract<MarkdownBlock, { kind: 'table' }>;
  onTint: boolean;
  fill: string;
}) {
  const { colors } = useTheme();
  const line = onTint ? 'rgba(255,255,255,0.22)' : colors.separator;
  const grid = [table.headers, ...table.rows];

  // Natural cell heights by `row:column`, the header being row 0.
  const [heights, setHeights] = useState<Readonly<Record<string, number>>>({});
  const rowHeights = grid.map((cells, row) =>
    Math.max(0, ...cells.map((_, column) => heights[`${row}:${column}`] ?? 0))
  );
  const measure = (key: string) => (event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    setHeights((current) => (current[key] === height ? current : { ...current, [key]: height }));
  };

  // Wide tables scroll inside their own container rather than squeezing the
  // bubble — the page itself must never scroll horizontally.
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ backgroundColor: fill, borderRadius: radius.xs }}>
      {/* Read as one element, row by row: built as columns, VoiceOver would
          otherwise read the table down each column in turn. */}
      <View
        accessible
        accessibilityLabel={tableLabel(table)}
        style={{ flexDirection: 'row', padding: spacing.sm }}>
        {table.headers.map((_, column) => (
          <Fragment key={column}>
            {column > 0 && <View style={{ width: 1, backgroundColor: line, opacity: 0.6 }} />}
            <View
              testID={`table-column-${column}`}
              style={{ minWidth: size.tableColumnMin, maxWidth: size.tableColumnMax }}>
              {grid.map((cells, row) => (
                <Fragment key={row}>
                  {row > 0 && (
                    <View style={{ height: 1, backgroundColor: line, opacity: row === 1 ? 1 : 0.5 }} />
                  )}
                  <View testID={`table-cell-${row}-${column}`} style={{ minHeight: rowHeights[row] }}>
                    <View
                      onLayout={measure(`${row}:${column}`)}
                      style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                      <Inline
                        text={cells[column] ?? ''}
                        onTint={onTint}
                        variant="footnote"
                        weight={row === 0 ? '600' : undefined}
                        align={table.align[column] ?? null}
                      />
                    </View>
                  </View>
                </Fragment>
              ))}
            </View>
          </Fragment>
        ))}
      </View>
    </ScrollView>
  );
}

/** The table as a screen reader should hear it: each row, with its headers. */
function tableLabel({ headers, rows }: { headers: string[]; rows: string[][] }): string {
  const plain = (cell: string) => parseInline(cell).map((span) => span.text).join('');
  if (rows.length === 0) return headers.map(plain).join(', ');
  return rows
    .map((row) => row.map((cell, column) => `${plain(headers[column] ?? '')}: ${plain(cell)}`).join(', '))
    .join('. ');
}

function Inline({
  text,
  onTint,
  variant = 'body',
  weight,
  italic = false,
  align = null,
}: {
  text: string;
  onTint: boolean;
  variant?: keyof typeof typography;
  weight?: '400' | '600' | '700';
  italic?: boolean;
  align?: TableAlign;
}) {
  const { colors } = useTheme();
  const spans = parseInline(text);

  return (
    <Text
      variant={variant}
      color={onTint ? 'onTint' : 'label'}
      weight={weight}
      selectable
      style={{ fontStyle: italic ? 'italic' : undefined, textAlign: align ?? undefined }}>
      {spans.map((span, index) => (
        <Span key={index} span={span} onTint={onTint} colors={colors} variant={variant} weight={weight} />
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
 *
 * Weight is the same: `Text` writes the variant's own weight, so a table's
 * header row, or a `###` heading, set in semibold came out regular.
 */
function Span({
  span,
  onTint,
  colors,
  variant,
  weight,
}: {
  span: InlineSpan;
  onTint: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  variant: keyof typeof typography;
  weight: '400' | '600' | '700' | undefined;
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
        <Text color={ink} variant={variant} weight={weight} style={{ fontStyle: 'italic' }}>
          {span.text}
        </Text>
      );
    case 'code':
      return (
        <Text
          mono
          color={ink}
          variant={variant}
          weight={weight}
          style={{ backgroundColor: onTint ? 'rgba(255,255,255,0.22)' : colors.fillSubtle }}>
          {span.text}
        </Text>
      );
    case 'link':
      return (
        <Text
          variant={variant}
          weight={weight}
          // On the tint, lavender measured 2.81:1 — a link you have to hunt for
          // inside your own message. White clears 4.60:1 there, and the underline
          // is what carries "this is a link" once the colour no longer can.
          style={
            onTint
              ? { color: colors.onTint, textDecorationLine: 'underline' }
              : { color: colors.tint }
          }
          accessibilityRole="link"
          accessibilityHint={span.href}
          onPress={() => {
            void Linking.openURL(span.href).catch(() => {
              Alert.alert("Couldn't open link", 'No browser could open this address. Please try again.');
            });
          }}>
          {span.text}
        </Text>
      );
    case 'text':
      return (
        <Text color={ink} variant={variant} weight={weight}>
          {span.text}
        </Text>
      );
  }
}
