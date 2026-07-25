package dev.herdr.herdrchat.core.commands

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Mirrors `PaneOverlayTests.swift` so the Kotlin and Swift ports of this detector
 * cannot silently drift apart — they parse the same terminal output and must agree
 * on it. The screens are VERBATIM captures from Claude Code v2.1.220 read through
 * `herdr pane read --source visible`.
 */
class PaneOverlayTest {

    private val modelPicker = """
        ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
           Select model
           Switch between Claude models. Your pick becomes the default for new sessions.

           ❯ 1. Default (recommended) ✔  Opus 4.8 with 1M context · Best for everyday, complex tasks
             2. Opus (1M context)        Opus 4.8 with 1M context · Best for everyday, complex tasks
             3. Fable                    Fable 5 · Most capable for your hardest tasks
             4. Sonnet                   Sonnet 4.6 · Efficient for routine tasks
             5. Haiku                    Haiku 4.5 · Fastest for quick answers

           ● High effort (default) ←/→ to adjust

           Enter to set as default · s to use this session only · Esc to cancel
    """.trimIndent()

    /** No numbered rows: a search box over a list, driven by typing and arrows. */
    private val resumePicker = """
        ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
           Resume session
           ╭──────────────────────────────────────────────────────╮
           │ ⌕ Search…                                            │
           ╰──────────────────────────────────────────────────────╯
             probe5
            No conversations found in this project.
             Ctrl+A to show all projects · Ctrl+B to only show current branch · Type to search · Esc to cancel
    """.trimIndent()

    @Test
    fun `detects the model picker as a numbered menu`() {
        val overlay = requireNotNull(PaneOverlayDetector.detect(modelPicker))
        val prompt = requireNotNull(overlay.prompt)

        assertEquals(5, prompt.options.size)
        assertEquals(1, prompt.options.first().number)
        assertTrue(prompt.options[3].label.startsWith("Sonnet"))
        // Picking option 4 means typing "4" then confirming.
        assertEquals(listOf("4", "Enter"), prompt.options[3].keys)
    }

    /**
     * The footer is the contract for which keys exist. Reading it means we never offer
     * a button that does nothing — including the session-only shortcut, which no amount
     * of guessing would have produced.
     */
    @Test
    fun `parses footer affordances and rejects undeliverable ones`() {
        val overlay = requireNotNull(PaneOverlayDetector.detect(modelPicker))
        val byKey = overlay.actions.associateBy { it.key.lowercase() }

        assertEquals("set as default", byKey["enter"]?.detail)
        assertEquals("use this session only", byKey["s"]?.detail)
        assertEquals(listOf("s"), byKey["s"]?.keys)
        assertEquals(listOf("Escape"), byKey["esc"]?.keys)
        // "←/→ to adjust" isn't a discrete key press, so it must not become a button.
        assertNull(byKey["←/→"])
    }

    @Test
    fun `resume picker is raw rather than a dead end`() {
        val overlay = requireNotNull(PaneOverlayDetector.detect(resumePicker))

        assertTrue(overlay.isRaw)
        assertNull(overlay.prompt)
        val kind = overlay.kind as PaneOverlayKind.Raw
        assertEquals("Resume session", kind.title)
        assertTrue(kind.screen.contains("Search"))
        // Its Ctrl chords are deliverable; "Type to search" is not a key press.
        assertTrue(overlay.actions.any { it.keys == listOf("ctrl+a") })
        assertTrue(overlay.actions.any { it.keys == listOf("ctrl+b") })
        assertFalse(overlay.actions.any { it.key.lowercase() == "type" })
    }

    /**
     * The corroboration rule, and the reason it exists: agents answer with numbered
     * lists all the time. Without a keyboard footer a list is prose and must not raise
     * a menu bar over the conversation.
     */
    @Test
    fun `numbered prose is not an overlay`() {
        val answer = """
            Here's what I'd do, in order:

            1. Fix the scroll anchoring first — it's the visible one.
            2. Bound the history window so long transcripts stay cheap.
            3. Then look at the tail fence.

            Want me to start on the first one?
        """.trimIndent()

        assertNull(PaneOverlayDetector.detect(answer))
    }

    @Test
    fun `idle screen has no overlay`() {
        val idle = """
            ❯
            ──────────────────────────────────────────────
              cobanov@macmini …/scratchpad | Opus 4.8 (1M context)
              ⏸ manual mode on · ← for agents
        """.trimIndent()

        assertNull(PaneOverlayDetector.detect(idle))
    }

    /**
     * herdr rejects tmux-style "C-a" with `unsupported key` — verified against a live
     * pane. `ctrl+<letter>` is the accepted form, and getting this wrong would ship
     * buttons that error on tap.
     */
    @Test
    fun `control chords map to herdr's accepted syntax`() {
        assertEquals(listOf("ctrl+a"), PaneOverlayDetector.sendKeys("Ctrl+A"))
        assertEquals(listOf("ctrl+b"), PaneOverlayDetector.sendKeys("ctrl-b"))
        assertEquals(listOf("Escape"), PaneOverlayDetector.sendKeys("Esc"))
        assertEquals(listOf("s"), PaneOverlayDetector.sendKeys("s"))
        assertNull(PaneOverlayDetector.sendKeys("↑/↓"))
        assertNull(PaneOverlayDetector.sendKeys("Type"))
    }

    /** Arrow keys are never advertised by `/resume`, yet they are how it is navigated. */
    @Test
    fun `navigation keys are always available`() {
        assertEquals(
            listOf(listOf("Up"), listOf("Down"), listOf("Enter"), listOf("Escape")),
            PaneOverlayDetector.navigationActions.map { it.keys },
        )
    }

    @Test
    fun `single numbered row falls back to raw rather than being ignored`() {
        val screen = """
            1. Continue

            Enter to confirm · Esc to cancel
        """.trimIndent()
        val overlay = requireNotNull(PaneOverlayDetector.detect(screen))

        assertTrue(overlay.isRaw)
        assertNull(overlay.prompt)
        assertEquals(2, overlay.actions.size)
        assertNotNull(overlay.kind)
    }
}
