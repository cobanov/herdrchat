import Foundation
import XCTest
@testable import HerdrKit

/// The launch command is the whole feature: a wrong flag value doesn't error, it
/// silently starts the agent in a different permission mode than the one the user
/// picked. These strings were checked against `claude --help` on Claude Code
/// v2.1.220, whose accepted choices are acceptEdits, auto, bypassPermissions,
/// manual, dontAsk and plan.
final class PermissionModeTests: XCTestCase {

    func testFlagValuesMatchTheCLIsAcceptedChoices() {
        // Anything not in this set makes `claude` exit with a usage error.
        let accepted: Set<String> = ["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"]

        for mode in PermissionMode.allCases {
            XCTAssertTrue(
                accepted.contains(mode.flagValue),
                "\(mode) emits '\(mode.flagValue)', which the CLI would reject"
            )
        }
    }

    func testLaunchCommandIsTheFullInvocation() {
        XCTAssertEqual(
            PermissionMode.bypass.launchCommand(),
            "claude --permission-mode bypassPermissions"
        )
        XCTAssertEqual(
            PermissionMode.plan.launchCommand(executable: "/opt/bin/claude"),
            "/opt/bin/claude --permission-mode plan"
        )
    }

    /// `manual` must be passed explicitly rather than omitted: the host's own
    /// settings can set a different default, so a chat started as "Ask every time"
    /// would otherwise silently inherit something more permissive.
    func testManualIsExplicitNotImplied() {
        XCTAssertTrue(PermissionMode.manual.launchCommand().contains("--permission-mode manual"))
    }

    /// Phone-first default. If this ever flips, every new chat starts asking for
    /// confirmation on each tool call, which is the complaint that created this type.
    func testDefaultIsFullAccess() {
        XCTAssertEqual(PermissionMode.allCases.first, .bypass)
        XCTAssertEqual(PermissionMode(rawValue: "bypassPermissions"), .bypass)
    }

    func testEveryModeIsPresentableInAPicker() {
        for mode in PermissionMode.allCases {
            XCTAssertFalse(mode.title.isEmpty)
            XCTAssertFalse(mode.detail.isEmpty)
            XCTAssertFalse(mode.symbol.isEmpty)
        }
        XCTAssertEqual(Set(PermissionMode.allCases.map(\.title)).count, PermissionMode.allCases.count)
    }
}
