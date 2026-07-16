import Foundation

/// The herdr socket API is newline-delimited JSON. Every response is either a
/// `{id, result}` success or a `{id, error}` failure. The CLI (`herdr api ...`,
/// `herdr agent ...`) wraps its output in the same envelope, so this decodes
/// both the raw socket stream and CLI stdout.
///
/// Wire protocol pinned during development: protocol 16, schema_version 1.
public struct HerdrEnvelope<Result: Decodable & Sendable>: Decodable, Sendable {
    public let id: String?
    public let result: Result?
    public let error: HerdrError?

    /// Returns the result or throws the transported error.
    public func value() throws -> Result {
        if let error { throw error }
        guard let result else {
            throw HerdrError(code: "empty_response", message: "response had neither result nor error")
        }
        return result
    }
}

public struct HerdrError: Error, Decodable, Sendable, CustomStringConvertible {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }

    public var description: String { "herdr error [\(code)]: \(message)" }
}

public enum SplitDirection: String, Codable, Sendable {
    case right
    case down
}

/// Shared JSON coding for herdr payloads. herdr uses snake_case on the wire.
public enum HerdrJSON {
    public static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    /// Decodes one CLI/socket response line into its result type.
    public static func decode<Result: Decodable & Sendable>(
        _ type: Result.Type,
        from data: Data
    ) throws -> Result {
        try makeDecoder().decode(HerdrEnvelope<Result>.self, from: data).value()
    }
}
