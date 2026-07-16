import Foundation
import HerdrKit

// Lightweight assertion harness so the core logic is verifiable with just the
// Swift toolchain (no XCTest). Mirrors HerdrKitTests. Exits non-zero on failure.

/// Fixtures live next to the XCTest target; locate them relative to this source.
func fixtureURL(_ file: String) -> URL {
    let here = URL(fileURLWithPath: #filePath)          // .../Sources/HerdrSmoke/main.swift
    let root = here.deletingLastPathComponent()          // HerdrSmoke
        .deletingLastPathComponent()                     // Sources
        .deletingLastPathComponent()                     // package root
    return root
        .appendingPathComponent("Tests/HerdrKitTests/Fixtures")
        .appendingPathComponent(file)
}

func fixture(_ name: String) throws -> Data {
    try Data(contentsOf: fixtureURL("\(name).json"))
}

func runSmoke() -> Int {
    var failures = 0
    func check(_ condition: Bool, _ message: String) {
        if condition {
            print("  ok  \(message)")
        } else {
            failures += 1
            print("FAIL  \(message)")
        }
    }

    print("HerdrKit smoke checks")
    do {
        let snap = try HerdrJSON.decode(SnapshotResult.self, from: try fixture("snapshot")).snapshot
        check(snap.agents.count == 3, "snapshot has 3 agents")
        check(snap.focusedWorkspaceId == "w7", "focused workspace is w7")

        let working = snap.agents.first { $0.paneId == "w7:p1" }
        check(working?.agent == "claude", "w7:p1 agent is claude")
        check(working?.agentStatus == .working, "w7:p1 is working")

        let blocked = snap.agents.first { $0.paneId == "w8:p1" }
        check(blocked?.agentStatus == .blocked, "w8:p1 is blocked")
        check(blocked?.agentStatus.needsAttention == true, "blocked needs attention")

        let future = snap.agents.first { $0.paneId == "wA:p1" }
        check(future?.agentStatus == .unknown, "unknown status falls back to .unknown")

        check(snap.layouts?.first?.splits.first?.direction == .right, "layout split direction decodes")

        let wsList = try HerdrJSON.decode(WorkspaceListResult.self, from: try fixture("workspace-list"))
        check(wsList.workspaces.count == 2, "workspace list has 2 workspaces")
        check(wsList.workspaces.filter { $0.agentStatus.needsAttention }.map(\.label) == ["other"],
              "only 'other' workspace needs attention")

        let errData = Data(#"{"id":"x","error":{"code":"boom","message":"nope"}}"#.utf8)
        var threw = false
        do { _ = try HerdrJSON.decode(AgentListResult.self, from: errData) }
        catch is HerdrError { threw = true }
        check(threw, "error envelope throws HerdrError")

        // Transcript parsing -> chat bubbles
        let transcript = String(decoding: try Data(contentsOf: fixtureURL("transcript.jsonl")), as: UTF8.self)
        let messages = TranscriptParser.parse(transcript, agentLabel: "claude")
        check(messages.count == 5, "5 bubbles parsed (mode/attachment skipped), got \(messages.count)")

        let first = messages.first
        check(first?.role == .user, "first bubble is from user")
        check(first?.displayText == "testleri calistir", "first bubble text preserved")
        check(first?.agentLabel == "claude", "agent label stamped")

        let asst = messages.first { $0.id == "a1" }
        check(asst?.role == .assistant, "a1 is assistant")
        check(asst?.segments.contains { if case .thinking = $0 { return true }; return false } == true,
              "a1 keeps a thinking segment")
        check(asst?.segments.contains { if case .toolUse(let name, _) = $0 { return name == "Bash" }; return false } == true,
              "a1 has a Bash tool_use segment")
        check(asst?.displayText == "Tamam, testleri calistiriyorum.", "a1 display text is the text block only")

        let toolResult = messages.first { $0.id == "u2" }
        check(toolResult?.isToolOnly == true, "tool_result-only user turn is tool-only (hideable)")

        let sidechain = messages.first { $0.id == "sc1" }
        check(sidechain?.isSidechain == true, "sidechain turn flagged")

        check(TranscriptParser.projectDirName(forCwd: "/Users/cobanov/Developer/capsarsiv")
              == "-Users-cobanov-Developer-capsarsiv", "cwd escapes to project dir name")
    } catch {
        print("FAIL  unexpected throw: \(error)")
        failures += 1
    }

    if failures == 0 {
        print("\nAll HerdrKit smoke checks passed.")
    } else {
        print("\n\(failures) check(s) failed.")
    }
    return failures
}

// Optional: `swift run HerdrSmoke <transcript.jsonl>` parses a real file and
// prints a summary, to sanity-check against live Claude Code transcripts.
if CommandLine.arguments.count > 1 {
    let path = CommandLine.arguments[1]
    guard let contents = try? String(contentsOfFile: path, encoding: .utf8) else {
        print("could not read \(path)"); exit(1)
    }
    let messages = TranscriptParser.parse(contents, agentLabel: "claude")
    let users = messages.filter { $0.role == .user && !$0.isToolOnly }.count
    let asst = messages.filter { $0.role == .assistant }.count
    print("Parsed \(messages.count) bubbles from \(path)")
    print("  user turns (text): \(users), assistant turns: \(asst)")
    print("  last text bubble:")
    if let last = messages.last(where: { !$0.isToolOnly }) {
        print("    [\(last.role.rawValue)] \(last.displayText.prefix(160))")
    }
    exit(0)
}

exit(runSmoke() == 0 ? 0 : 1)
