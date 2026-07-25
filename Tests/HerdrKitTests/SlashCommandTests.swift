import Foundation
import XCTest
@testable import HerdrKit

final class SlashCommandTests: XCTestCase {

    private struct NullTransport: HerdrTransport {
        func shell(_ command: String) async throws -> Data { Data() }
        func streamLines(_ command: String) -> AsyncThrowingStream<String, Error> {
            AsyncThrowingStream { $0.finish() }
        }
    }

    private var store: SlashCommandStore { SlashCommandStore(transport: NullTransport()) }

    /// Shaped exactly like the discovery script's real output on a live host,
    /// including a quoted description and one with no description at all.
    func testParsesDiscoveryOutput() {
        let output = """
        @@HERDRCMD userSkill better-ui
        Design engineering principles for making interfaces feel polished.
        @@HERDRCMD userSkill herdr
        "Control herdr from inside it. Manage workspaces and tabs."
        @@HERDRCMD projectSkill swiftui-patterns
        Builds and reviews SwiftUI views with modern MV architecture.
        @@HERDRCMD userCommand deploy
        @@HERDRCMD projectCommand release

        """
        let commands = store.parse(output)

        XCTAssertEqual(commands.count, 5)
        XCTAssertEqual(commands[0].name, "better-ui")
        XCTAssertEqual(commands[0].source, .userSkill)
        // Surrounding quotes come off — they're YAML syntax, not part of the text.
        XCTAssertEqual(commands[1].summary, "Control herdr from inside it. Manage workspaces and tabs.")
        XCTAssertEqual(commands[2].source, .projectSkill)
        XCTAssertEqual(commands[3].name, "deploy")
        XCTAssertNil(commands[3].summary, "a definition with no description must not invent one")
        XCTAssertEqual(commands[4].name, "release")
    }

    /// Junk between blocks (a shell warning, a stray line) must not become a
    /// command — the palette is driven straight off this parse.
    func testIgnoresUnmarkedNoise() {
        let output = """
        sh: /Users/x/.claude/commands: Permission denied
        @@HERDRCMD userSkill valid
        A real one.
        @@HERDRCMD bogusSource nope
        Unknown source, must be dropped.
        """
        let commands = store.parse(output)

        XCTAssertEqual(commands.map(\.name), ["valid"])
    }

    func testBuiltInsAreSaneAndUnique() {
        let names = SlashCommand.builtIns.map(\.name)

        XCTAssertEqual(Set(names).count, names.count, "duplicate built-in command")
        XCTAssertTrue(names.contains("model"), "/model is the command that motivated all this")
        for command in SlashCommand.builtIns {
            XCTAssertFalse(command.name.hasPrefix("/"), "name must not carry the slash: \(command.name)")
            XCTAssertEqual(command.invocation, "/\(command.name)")
            XCTAssertNotNil(command.summary, "a built-in without a summary is a blank palette row")
        }
    }

    /// Palette ordering: what you typed should be reachable without hunting. Note
    /// "memory" matches "mo" too — me·mo·ry — so this also pins down that an
    /// interior match sorts BELOW a prefix match rather than alphabetically.
    func testRankingPutsPrefixMatchesFirst() {
        let commands = [
            SlashCommand(name: "memory", summary: nil, source: .builtIn),
            SlashCommand(name: "compact", summary: nil, source: .builtIn),
            SlashCommand(name: "model", summary: nil, source: .builtIn),
        ]
        let sorted = commands
            .filter { $0.matches("mo") }
            .sorted { $0.rank(for: "mo") == $1.rank(for: "mo")
                ? $0.name < $1.name
                : $0.rank(for: "mo") < $1.rank(for: "mo") }

        // Alphabetically "memory" would win; ranking must put the prefix first.
        XCTAssertEqual(sorted.map(\.name), ["model", "memory"])
        XCTAssertFalse(sorted.contains { $0.name == "compact" }, "no 'mo' in compact")
    }

    /// An exact match outranks a longer command that merely starts with the same
    /// letters, so typing a full name and hitting the first row does what you meant.
    func testExactMatchOutranksLongerPrefix() {
        let model = SlashCommand(name: "model", summary: nil, source: .builtIn)
        let modelish = SlashCommand(name: "model-picker", summary: nil, source: .userCommand)

        XCTAssertLessThan(model.rank(for: "model"), modelish.rank(for: "model"))
    }

    func testEmptyQueryMatchesEverything() {
        XCTAssertTrue(SlashCommand.builtIns.allSatisfy { $0.matches("") })
    }
}
