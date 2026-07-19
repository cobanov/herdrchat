package dev.herdr.herdrchat.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp

/**
 * Lightweight, native block-level Markdown renderer for chat bubbles. Handles
 * what Claude actually emits — fenced code blocks, headings, bullet/numbered
 * lists, blockquotes, rules, and inline bold/italic/code/links. Assistant
 * replies render as formatted text instead of raw Markdown.
 */
@Composable
fun MarkdownText(markdown: String, color: Color, onTint: Boolean) {
    val codeBg = if (onTint) Color.White.copy(alpha = 0.18f)
    else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f)
    val blocks = remember(markdown) { Markdown.parse(markdown) }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        blocks.forEach { block -> MdBlockView(block, color, codeBg) }
    }
}

@Composable
private fun MdBlockView(block: MdBlock, color: Color, codeBg: Color) {
    when (block) {
        is MdBlock.Paragraph ->
            Text(inlineMarkdown(block.text, color, codeBg))

        is MdBlock.Heading ->
            Text(
                inlineMarkdown(block.text, color, codeBg),
                style = when (block.level) {
                    1 -> MaterialTheme.typography.titleMedium
                    2 -> MaterialTheme.typography.titleSmall
                    else -> MaterialTheme.typography.bodyLarge
                },
                fontWeight = FontWeight.SemiBold,
            )

        is MdBlock.Bullet -> Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            block.items.forEach { MdListRow("•", it, color, codeBg) }
        }

        is MdBlock.Numbered -> Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            block.items.forEachIndexed { i, item -> MdListRow("${i + 1}.", item, color, codeBg) }
        }

        is MdBlock.Quote -> Row(
            modifier = Modifier.height(IntrinsicSize.Min),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                Modifier
                    .fillMaxHeight()
                    .width(3.dp)
                    .clip(RoundedCornerShape(1.5.dp))
                    .background(color.copy(alpha = 0.35f)),
            )
            Text(inlineMarkdown(block.text, color.copy(alpha = 0.9f), codeBg), fontStyle = FontStyle.Italic)
        }

        is MdBlock.Code -> Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(9.dp))
                .background(codeBg)
                .padding(9.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (!block.language.isNullOrEmpty()) {
                Text(
                    block.language.lowercase(),
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = FontFamily.Monospace,
                    color = color.copy(alpha = 0.6f),
                )
            }
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                Text(
                    block.content,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = color,
                )
            }
        }

        MdBlock.Rule -> HorizontalDivider(color = color.copy(alpha = 0.18f))
    }
}

@Composable
private fun MdListRow(marker: String, text: String, color: Color, codeBg: Color) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
        Text(marker, color = color.copy(alpha = 0.7f), style = LocalTextStyle.current)
        Text(inlineMarkdown(text, color, codeBg))
    }
}

// Inline markdown -> AnnotatedString: bold, italic, code spans, and [label](url)
// links. Single-level (no nested spans) — enough for chat text.
private fun inlineMarkdown(text: String, color: Color, codeBg: Color): AnnotatedString = buildAnnotatedString {
    pushStyle(SpanStyle(color = color))
    var i = 0
    while (i < text.length) {
        val c = text[i]
        when {
            c == '`' -> {
                val end = text.indexOf('`', i + 1)
                if (end > i) {
                    withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBg)) {
                        append(text.substring(i + 1, end))
                    }
                    i = end + 1
                } else { append(c); i++ }
            }
            c == '*' && i + 1 < text.length && text[i + 1] == '*' -> {
                val end = text.indexOf("**", i + 2)
                if (end > i) {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(text.substring(i + 2, end)) }
                    i = end + 2
                } else { append(c); i++ }
            }
            (c == '*' || c == '_') && i + 1 < text.length && text[i + 1] != ' ' -> {
                val end = text.indexOf(c, i + 1)
                if (end > i + 1) {
                    withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(text.substring(i + 1, end)) }
                    i = end + 1
                } else { append(c); i++ }
            }
            c == '[' -> {
                val close = text.indexOf(']', i + 1)
                if (close > i && close + 1 < text.length && text[close + 1] == '(') {
                    val urlEnd = text.indexOf(')', close + 2)
                    if (urlEnd > close) {
                        withStyle(SpanStyle(textDecoration = TextDecoration.Underline)) {
                            append(text.substring(i + 1, close))
                        }
                        i = urlEnd + 1
                    } else { append(c); i++ }
                } else { append(c); i++ }
            }
            else -> { append(c); i++ }
        }
    }
    pop()
}

// Block model + parser (mirrors the tested iOS renderer)

sealed interface MdBlock {
    data class Paragraph(val text: String) : MdBlock
    data class Heading(val level: Int, val text: String) : MdBlock
    data class Bullet(val items: List<String>) : MdBlock
    data class Numbered(val items: List<String>) : MdBlock
    data class Quote(val text: String) : MdBlock
    data class Code(val language: String?, val content: String) : MdBlock
    data object Rule : MdBlock
}

object Markdown {
    fun parse(text: String): List<MdBlock> {
        val blocks = mutableListOf<MdBlock>()
        val lines = text.split("\n")
        val para = mutableListOf<String>()

        fun flush() {
            if (para.isNotEmpty()) {
                blocks.add(MdBlock.Paragraph(para.joinToString("\n")))
                para.clear()
            }
        }

        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val trimmed = line.trim()

            if (trimmed.startsWith("```")) {
                flush()
                val lang = trimmed.drop(3).trim()
                val code = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trim().startsWith("```")) { code.add(lines[i]); i++ }
                i++   // skip closing fence
                blocks.add(MdBlock.Code(lang.ifEmpty { null }, code.joinToString("\n")))
                continue
            }
            if (isRule(trimmed)) { flush(); blocks.add(MdBlock.Rule); i++; continue }

            val h = heading(trimmed)
            if (h != null) { flush(); blocks.add(MdBlock.Heading(h.first, h.second)); i++; continue }

            val b = bulletItem(line)
            if (b != null) {
                flush()
                val items = mutableListOf(b); i++
                while (i < lines.size) { val next = bulletItem(lines[i]) ?: break; items.add(next); i++ }
                blocks.add(MdBlock.Bullet(items)); continue
            }

            val n = numberedItem(line)
            if (n != null) {
                flush()
                val items = mutableListOf(n); i++
                while (i < lines.size) { val next = numberedItem(lines[i]) ?: break; items.add(next); i++ }
                blocks.add(MdBlock.Numbered(items)); continue
            }

            if (trimmed.startsWith(">")) {
                flush()
                val quote = mutableListOf<String>()
                while (i < lines.size && lines[i].trim().startsWith(">")) {
                    quote.add(lines[i].trim().drop(1).trim()); i++
                }
                blocks.add(MdBlock.Quote(quote.joinToString("\n"))); continue
            }

            if (trimmed.isEmpty()) { flush(); i++; continue }

            para.add(line); i++
        }
        flush()
        return blocks
    }

    private fun isRule(s: String): Boolean {
        if (s.length < 3) return false
        val chars = s.toSet()
        return chars == setOf('-') || chars == setOf('*') || chars == setOf('_')
    }

    private fun heading(s: String): Pair<Int, String>? {
        if (!s.startsWith("#")) return null
        val level = s.takeWhile { it == '#' }.length
        if (level > 6) return null
        val rest = s.drop(level)
        if (rest.firstOrNull() != ' ') return null
        return level to rest.dropWhile { it == ' ' }
    }

    private fun bulletItem(line: String): String? {
        val t = line.dropWhile { it == ' ' }
        val first = t.firstOrNull() ?: return null
        if (first != '-' && first != '*' && first != '+') return null
        val after = t.drop(1)
        if (after.firstOrNull() != ' ') return null
        return after.drop(1)
    }

    private fun numberedItem(line: String): String? {
        val t = line.dropWhile { it == ' ' }
        val digits = t.takeWhile { it.isDigit() }
        if (digits.isEmpty()) return null
        val after = t.drop(digits.length)
        val punct = after.firstOrNull()
        if (punct != '.' && punct != ')') return null
        val rest = after.drop(1)
        if (rest.firstOrNull() != ' ') return null
        return rest.drop(1)
    }
}
