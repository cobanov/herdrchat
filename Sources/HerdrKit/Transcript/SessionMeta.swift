import Foundation

/// Lightweight session facts for the chat header: which Claude model is answering
/// and how full the context window is. Sourced from the newest assistant turn in
/// the transcript.
public struct SessionMeta: Sendable, Equatable {
    /// Raw model id, e.g. "claude-opus-4-8".
    public let model: String?
    /// Tokens currently in the context window (last request's prompt size).
    public let contextTokens: Int?

    public init(model: String?, contextTokens: Int?) {
        self.model = model
        self.contextTokens = contextTokens
    }

    /// Friendly model name, e.g. "claude-opus-4-8" → "Opus 4.8", "claude-fable-5"
    /// → "Fable 5". Falls back to the raw id if it doesn't fit the pattern.
    public var modelDisplayName: String? {
        guard let model else { return nil }
        let base = model.split(separator: "[").first.map(String.init) ?? model   // drop "[1m]"
        let noPrefix = base.hasPrefix("claude-") ? String(base.dropFirst("claude-".count)) : base
        let tokens = noPrefix.split(separator: "-")
        guard let family = tokens.first else { return model }
        let familyName = family.prefix(1).uppercased() + family.dropFirst()
        // Version = the short numeric tokens (skip long date suffixes like 20251001).
        let version = tokens.dropFirst()
            .filter { $0.allSatisfy(\.isNumber) && $0.count <= 2 }
            .joined(separator: ".")
        return version.isEmpty ? String(familyName) : "\(familyName) \(version)"
    }

    /// Compact context label, e.g. "ctx 33k". Shown as a token count — NOT a
    /// percentage — because the context window size (200K vs a 1M variant) isn't
    /// recorded in the transcript, so a percentage would be unreliable.
    public var contextLabel: String? {
        guard let contextTokens else { return nil }
        return contextTokens >= 1000 ? "ctx \((contextTokens + 500) / 1000)k" : "ctx \(contextTokens)"
    }
}
