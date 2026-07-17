import Foundation
import Crypto
import Citadel
import HerdrKit
import NIOCore

/// A `HerdrTransport` that runs commands on a remote herdr host over SSH. The
/// app points this at a Tailscale address, so there is no public network
/// surface: the phone and the host are peers on the tailnet.
///
/// The connection is opened lazily and reused across commands (SSH handshakes
/// are expensive relative to the short `herdr` invocations we make).
public actor SSHTransport: HerdrTransport {
    private let config: SSHConfig
    private var client: SSHClient?

    public init(config: SSHConfig) {
        self.config = config
    }

    public func disconnect() async {
        if let client { try? await client.close() }
        client = nil
    }

    private func connected() async throws -> SSHClient {
        if let client { return client }
        // Parse the key up front: the settings closure must be non-throwing.
        // SSHAuthenticationMethod isn't Sendable but is effectively immutable
        // once built, so the capture is safe.
        nonisolated(unsafe) let auth = try Self.authMethod(for: config)
        let settings = SSHClientSettings(
            host: config.host,
            port: config.port,
            authenticationMethod: { auth },
            hostKeyValidator: .acceptAnything()
        )
        let newClient = try await SSHClient.connect(to: settings)
        client = newClient
        return newClient
    }

    private static func authMethod(for config: SSHConfig) throws -> SSHAuthenticationMethod {
        switch config.auth {
        case .password(let password):
            return .passwordBased(username: config.username, password: password)
        case .privateKey(let pem, let passphrase):
            let decryptionKey = passphrase?.data(using: .utf8)
            // ed25519 is the modern default; fall back to RSA for older keys.
            if let key = try? Curve25519.Signing.PrivateKey(sshEd25519: pem, decryptionKey: decryptionKey) {
                return .ed25519(username: config.username, privateKey: key)
            }
            let rsa = try Insecure.RSA.PrivateKey(sshRsa: pem, decryptionKey: decryptionKey)
            return .rsa(username: config.username, privateKey: rsa)
        }
    }

    /// Non-interactive SSH shells don't load the user's profile, so herdr's
    /// install dir (~/.local/bin, Homebrew) usually isn't on PATH and `herdr`
    /// resolves to command-not-found (exit 127). Prepend the common bin dirs so
    /// the default `herdr` just works without the user hard-coding a path.
    private static func withPath(_ command: String) -> String {
        #"export PATH="$HOME/.local/bin:$HOME/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; "# + command
    }

    public func shell(_ command: String) async throws -> Data {
        let client = try await connected()
        do {
            let buffer = try await client.executeCommand(Self.withPath(command))
            return Data(buffer.readableBytesView)
        } catch let error as SSHClient.CommandFailed {
            throw HerdrError(code: "ssh_command_failed", message: "exit status \(error.exitCode)")
        }
    }

    public nonisolated func streamLines(_ command: String) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let client = try await self.connected()
                    let events = try await client.executeCommandStream(Self.withPath(command))
                    var buffer = Data()
                    for try await event in events {
                        guard case .stdout(let chunk) = event else { continue }
                        buffer.append(contentsOf: chunk.readableBytesView)
                        while let newline = buffer.firstIndex(of: 0x0A) {
                            let lineData = buffer[buffer.startIndex..<newline]
                            continuation.yield(String(decoding: lineData, as: UTF8.self))
                            buffer.removeSubrange(buffer.startIndex...newline)
                        }
                    }
                    if !buffer.isEmpty {
                        continuation.yield(String(decoding: buffer, as: UTF8.self))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

public extension HerdrClient {
    /// Convenience: a client wired to a remote herdr host over SSH.
    static func ssh(_ config: SSHConfig) -> HerdrClient {
        HerdrClient(transport: SSHTransport(config: config), herdrPath: config.herdrPath)
    }
}
