import Foundation
import XCTest
@testable import HerdrKit

final class ModelDecodingTests: XCTestCase {

    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"),
            "missing fixture \(name).json"
        )
        return try Data(contentsOf: url)
    }

    func testDecodeSnapshot() throws {
        let data = try fixture("snapshot")
        let snap = try HerdrJSON.decode(SnapshotResult.self, from: data).snapshot

        XCTAssertEqual(snap.agents.count, 3)
        XCTAssertEqual(snap.focusedWorkspaceId, "w7")

        let working = try XCTUnwrap(snap.agents.first { $0.paneId == "w7:p1" })
        XCTAssertEqual(working.agent, "claude")
        XCTAssertEqual(working.agentStatus, .working)
        XCTAssertTrue(working.focused)

        let blocked = try XCTUnwrap(snap.agents.first { $0.paneId == "w8:p1" })
        XCTAssertEqual(blocked.agentStatus, .blocked)
        XCTAssertTrue(blocked.agentStatus.needsAttention)

        // An agent_status herdr adds later must fall back to .unknown, not throw.
        let future = try XCTUnwrap(snap.agents.first { $0.paneId == "wA:p1" })
        XCTAssertEqual(future.agentStatus, .unknown)

        // Layout geometry survives the round-trip.
        let layout = try XCTUnwrap(snap.layouts?.first)
        XCTAssertEqual(layout.workspaceId, "w7")
        XCTAssertEqual(layout.splits.first?.direction, .right)
    }

    func testDecodeWorkspaceList() throws {
        let data = try fixture("workspace-list")
        let result = try HerdrJSON.decode(WorkspaceListResult.self, from: data)

        XCTAssertEqual(result.workspaces.count, 2)
        let attention = result.workspaces.filter { $0.agentStatus.needsAttention }
        XCTAssertEqual(attention.map(\.label), ["other"])
    }

    func testDecodeErrorEnvelope() throws {
        let data = Data(#"{"id":"x","error":{"code":"agent_target_ambiguous","message":"nope"}}"#.utf8)
        XCTAssertThrowsError(try HerdrJSON.decode(AgentListResult.self, from: data)) { error in
            XCTAssertTrue(error is HerdrError)
        }
    }
}
