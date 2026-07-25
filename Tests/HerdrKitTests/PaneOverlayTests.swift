import Foundation
import XCTest
@testable import HerdrKit

/// Covers detection of interactive menus drawn over an agent pane.
///
/// The screens below are VERBATIM captures from Claude Code v2.1.220 taken through
/// `herdr pane read --source visible`, not invented shapes — the detector's whole
/// job is to cope with what that program actually prints.
final class PaneOverlayTests: XCTestCase {

    /// `/model`, the case that motivated the feature. Note what makes it hard:
    /// herdr reports the agent as `idle` while this is up, so nothing but the
    /// screen itself says a menu is waiting.
    private let modelPicker = """
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
    """

    /// The folder-trust prompt shown when Claude Code starts somewhere new.
    private let trustPrompt = """
     Quick safety check: Is this a project you created or one you trust?

     ❯ 1. Yes, I trust this folder
       2. No, exit

     Enter to confirm · Esc to cancel
    """

    /// The strongest check available: an UNEDITED `herdr pane read --source
    /// visible` capture of `/model`, box drawing, padding and all. The inline
    /// fixtures above are transcriptions, which can quietly drift from what the
    /// terminal really emits; this one cannot. It is also the regression alarm for
    /// a future Claude Code redesign.
    func testDetectsRealCapturedModelPicker() throws {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "model-picker-screen", withExtension: "txt", subdirectory: "Fixtures"),
            "missing captured screen fixture"
        )
        let screen = try String(contentsOf: url, encoding: .utf8)
        let overlay = try XCTUnwrap(
            PaneOverlayDetector.detect(screen),
            "the real /model screen must be recognised as an overlay"
        )

        XCTAssertEqual(overlay.prompt!.options.count, 5)
        XCTAssertTrue(overlay.prompt!.options[0].label.contains("Default"))
        XCTAssertTrue(
            overlay.actions.contains { $0.keys == ["s"] },
            "the session-only shortcut is only knowable from the footer"
        )
        XCTAssertTrue(overlay.actions.contains { $0.keys == ["Escape"] })
    }

    /// `/resume` is the case the numbered-menu path cannot serve: a search box over
    /// a list, with no rows to turn into buttons. It must come back as `.raw` so the
    /// UI can show the screen and drive it — otherwise the command is a dead end.
    /// Also an UNEDITED capture from a live pane.
    func testResumePickerIsRawNotAMenu() throws {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "resume-picker-screen", withExtension: "txt", subdirectory: "Fixtures"),
            "missing captured screen fixture"
        )
        let screen = try String(contentsOf: url, encoding: .utf8)
        let overlay = try XCTUnwrap(
            PaneOverlayDetector.detect(screen),
            "the real /resume screen must still be recognised as an overlay"
        )

        XCTAssertTrue(overlay.isRaw, "no numbered rows here — must not be reported as a menu")
        XCTAssertNil(overlay.prompt)
        guard case .raw(let body, let title) = overlay.kind else {
            return XCTFail("expected a raw overlay")
        }
        XCTAssertEqual(title, "Resume session")
        XCTAssertTrue(body.contains("Search"), "the search box is the point of this overlay")
        // The `▔▔▔` rule bounds the region, so the welcome banner above it is out.
        XCTAssertFalse(body.contains("Welcome back"), "conversation chrome leaked into the card")

        // Its Ctrl chords are deliverable; "Type to search" is not a key press.
        XCTAssertTrue(overlay.actions.contains { $0.keys == ["ctrl+a"] })
        XCTAssertTrue(overlay.actions.contains { $0.keys == ["ctrl+b"] })
        XCTAssertFalse(overlay.actions.contains { $0.key.lowercased() == "type" })
    }

    /// Arrow keys are never advertised by `/resume`, yet they are how it is
    /// navigated — so they are supplied unconditionally.
    func testNavigationKeysAreAlwaysAvailable() {
        let keys = PaneOverlayDetector.navigationActions.map(\.keys)

        XCTAssertEqual(keys, [["Up"], ["Down"], ["Enter"], ["Escape"]])
    }

    func testControlChordMapping() {
        // herdr rejects tmux-style "C-a" with `unsupported key` — verified on a live
        // pane. `ctrl+<letter>` is the accepted form.
        XCTAssertEqual(PaneOverlayDetector.sendKeys(for: "Ctrl+A"), ["ctrl+a"])
        XCTAssertEqual(PaneOverlayDetector.sendKeys(for: "ctrl-b"), ["ctrl+b"])
        XCTAssertEqual(PaneOverlayDetector.sendKeys(for: "Esc"), ["Escape"])
        XCTAssertEqual(PaneOverlayDetector.sendKeys(for: "s"), ["s"])
        // Not a discrete key press — must not become a button.
        XCTAssertNil(PaneOverlayDetector.sendKeys(for: "↑/↓"))
        XCTAssertNil(PaneOverlayDetector.sendKeys(for: "Type"))
    }

    func testDetectsModelPicker() throws {
        let overlay = try XCTUnwrap(PaneOverlayDetector.detect(modelPicker))

        XCTAssertEqual(overlay.prompt!.options.count, 5)
        XCTAssertEqual(overlay.prompt!.options.first?.number, 1)
        XCTAssertTrue(
            overlay.prompt!.options[3].label.hasPrefix("Sonnet"),
            "unexpected label: \(overlay.prompt!.options[3].label)"
        )
        // Picking option 4 means typing "4" then confirming.
        XCTAssertEqual(overlay.prompt!.options[3].keys, ["4", "Enter"])
    }

    /// The footer is the contract for which keys exist. Reading it means we never
    /// offer a button that does nothing — including the session-only shortcut,
    /// which no amount of guessing would have produced.
    func testParsesFooterAffordances() throws {
        let overlay = try XCTUnwrap(PaneOverlayDetector.detect(modelPicker))
        let byKey = Dictionary(uniqueKeysWithValues: overlay.actions.map { ($0.key.lowercased(), $0) })

        XCTAssertEqual(byKey["enter"]?.detail, "set as default")
        XCTAssertEqual(byKey["s"]?.detail, "use this session only")
        XCTAssertEqual(byKey["s"]?.keys, ["s"])
        XCTAssertEqual(byKey["esc"]?.keys, ["Escape"])
        // "←/→ to adjust" can't be delivered as a discrete key press, so it must
        // not become a button.
        XCTAssertNil(byKey["←/→"])
    }

    func testDetectsTrustPrompt() throws {
        let overlay = try XCTUnwrap(PaneOverlayDetector.detect(trustPrompt))

        XCTAssertEqual(overlay.prompt!.options.count, 2)
        XCTAssertEqual(overlay.prompt!.options[1].label, "No, exit")
        XCTAssertEqual(overlay.actions.count, 2)
    }

    /// The corroboration rule, and the reason it exists: agents answer with
    /// numbered lists all the time. Without a keyboard footer, a list is prose and
    /// must not raise a menu bar over the conversation.
    func testNumberedProseIsNotAMenu() {
        let answer = """
        Here's what I'd do, in order:

        1. Fix the scroll anchoring first — it's the visible one.
        2. Bound the history window so long transcripts stay cheap.
        3. Then look at the tail fence.

        Want me to start on the first one?
        """
        XCTAssertNil(PaneOverlayDetector.detect(answer))
    }

    /// One numbered line is too weak a signal to render as a row-per-option menu.
    /// It is NOT ignored though: the footer says the screen is waiting for a key,
    /// so it falls through to the raw path where it can still be driven. Silently
    /// dropping it would strand whatever asked the question.
    func testSingleOptionFallsBackToRawRatherThanBeingIgnored() throws {
        let screen = """
        1. Continue

        Enter to confirm · Esc to cancel
        """
        let overlay = try XCTUnwrap(PaneOverlayDetector.detect(screen))

        XCTAssertTrue(overlay.isRaw)
        XCTAssertNil(overlay.prompt, "one row is not a menu")
        XCTAssertEqual(overlay.actions.count, 2)
    }

    func testIdleScreenHasNoOverlay() {
        let idle = """
        ❯
        ──────────────────────────────────────────────
          cobanov@macmini …/scratchpad | Opus 4.8 (1M context)
          ⏸ manual mode on · ← for agents
        """
        XCTAssertNil(PaneOverlayDetector.detect(idle))
    }
}
