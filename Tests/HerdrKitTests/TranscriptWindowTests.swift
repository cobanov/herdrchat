import Foundation
import XCTest
@testable import HerdrKit

/// Covers `TranscriptStore.recent` — the bounded history window a chat thread
/// opens with. Its invariants are easy to break and expensive to notice: get the
/// byte accounting wrong and the live tail either re-reads history or skips
/// messages outright.
final class TranscriptWindowTests: XCTestCase {

    /// Serves a canned transcript, answering the `wc -c` size probe and the
    /// `tail -c +N` window read the store issues.
    private struct FakeTransport: HerdrTransport {
        let file: Data

        func shell(_ command: String) async throws -> Data {
            if command.hasPrefix("wc -c") {
                return Data("\(file.count)\n".utf8)
            }
            if let range = command.range(of: "tail -c +") {
                let rest = command[range.upperBound...]
                let digits = rest.prefix { $0.isNumber }
                let oneBased = Int(digits) ?? 1
                return file.suffix(from: max(0, oneBased - 1))
            }
            return Data()
        }

        func streamLines(_ command: String) -> AsyncThrowingStream<String, Error> {
            AsyncThrowingStream { $0.finish() }
        }
    }

    /// One user turn per line, so bubble count is predictable.
    private func transcript(turns: Int) -> Data {
        let lines = (0..<turns).map { index in
            #"{"type":"user","uuid":"u\#(index)","message":{"role":"user","content":"turn \#(index)"}}"#
        }
        return Data((lines.joined(separator: "\n") + "\n").utf8)
    }

    private func store(_ file: Data) -> TranscriptStore {
        TranscriptStore(transport: FakeTransport(file: file))
    }

    /// The whole point of the window: a dense transcript must not hand the chat
    /// surface thousands of bubbles to lay out.
    func testMessageCapKeepsOnlyTheNewestTurns() async throws {
        let file = transcript(turns: 500)
        let result = try await store(file).recent(
            atPath: "/t.jsonl", agentLabel: nil, maxBytes: 10_000_000, maxMessages: 20
        )

        XCTAssertEqual(result.messages.count, 20)
        // Newest kept, oldest dropped — a chat opens on recency.
        XCTAssertEqual(result.messages.last?.displayText, "turn 499")
        XCTAssertEqual(result.messages.first?.displayText, "turn 480")
    }

    /// Trimming is a display concern and must NOT move the tail cursor: the tail
    /// has to resume at the real end of file, or every trimmed message would be
    /// re-read and re-appended as if it were new.
    func testConsumedBytesIsTheWholeWindowNotTheKeptSlice() async throws {
        let file = transcript(turns: 500)
        let result = try await store(file).recent(
            atPath: "/t.jsonl", agentLabel: nil, maxBytes: 10_000_000, maxMessages: 5
        )

        XCTAssertEqual(result.messages.count, 5)
        XCTAssertEqual(result.consumedBytes, file.count)
    }

    /// A byte window that starts mid-file lands mid-line. That fragment must be
    /// dropped rather than parsed into a half-formed bubble.
    func testPartialFirstLineIsDropped() async throws {
        let file = transcript(turns: 40)
        // Start the window inside the first line, so the read begins on a fragment.
        let maxBytes = file.count - 30
        let result = try await store(file).recent(
            atPath: "/t.jsonl", agentLabel: nil, maxBytes: maxBytes
        )

        XCTAssertFalse(result.messages.isEmpty)
        // Every surviving bubble is a whole turn, not a truncated one.
        for message in result.messages {
            XCTAssertTrue(
                message.displayText.hasPrefix("turn "),
                "unexpected fragment bubble: \(message.displayText)"
            )
        }
        XCTAssertEqual(result.consumedBytes, file.count)
    }

    /// A file smaller than the window is read whole, with nothing dropped —
    /// the common case for a young session.
    func testShortTranscriptIsReadWhole() async throws {
        let file = transcript(turns: 6)
        let result = try await store(file).recent(
            atPath: "/t.jsonl", agentLabel: nil, maxBytes: 10_000_000, maxMessages: 150
        )

        XCTAssertEqual(result.messages.count, 6)
        XCTAssertEqual(result.messages.first?.displayText, "turn 0")
        XCTAssertEqual(result.consumedBytes, file.count)
    }
}
