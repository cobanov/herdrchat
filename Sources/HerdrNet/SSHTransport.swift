import Foundation
import Crypto
import Citadel
import HerdrKit
import NIOCore
import NIOSSH

/// A `HerdrTransport` that runs commands on a remote herdr host over SSH. The
/// app points this at a Tailscale address, so there is no public network
/// surface: the phone and the host are peers on the tailnet.
///
/// The connection is opened lazily and reused across commands. A cached client
/// is validated for liveness before use, and a command that fails at the
/// connection level (network change, background suspension, NAT timeout) drops
/// the client, reconnects, and retries once — so a stale connection heals
/// transparently instead of erroring until app restart.
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

    private func resetClient() async {
        if let client { try? await client.close() }
        client = nil
    }

    private func connected() async throws -> SSHClient {
        // Liveness: a dead cached client (dropped TCP) must not be reused.
        if let client {
            if client.isConnected { return client }
            await resetClient()
        }
        // Parse the key up front: the settings closure must be non-throwing.
        // SSHAuthenticationMethod isn't Sendable but is effectively immutable
        // once built, so the capture is safe.
        nonisolated(unsafe) let auth = try Self.authMethod(for: config)
        let mismatch = MismatchBox()
        let settings = SSHClientSettings(
            host: config.host,
            port: config.port,
            authenticationMethod: { auth },
            hostKeyValidator: Self.hostKeyValidator(for: config, mismatch: mismatch)
        )
        do {
            let newClient = try await SSHClient.connect(to: settings)
            client = newClient
            return newClient
        } catch {
            if mismatch.tripped {
                throw HerdrError(
                    code: "host_key_changed",
                    message: "The server's SSH key DIFFERS from the saved one (possible MITM, or the server was reinstalled). If you trust it, edit and save the server to reset the pin."
                )
            }
            throw error
        }
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

    // MARK: - Host key pinning (TOFU)

    /// Single-connect flag: written once on the SSH event loop before the
    /// handshake resolves, read after `connect` returns/throws.
    private final class MismatchBox: @unchecked Sendable {
        var tripped = false
    }

    private static func hostKeyValidator(for config: SSHConfig, mismatch: MismatchBox) -> SSHHostKeyValidator {
        guard let pin = config.hostKeyPin else { return .acceptAnything() }
        return .custom(TOFUHostKeyDelegate(pin: pin, mismatch: mismatch))
    }

    /// Trust-on-first-use: pin the host key's SHA-256 fingerprint on first
    /// contact; refuse any later connection presenting a different key.
    private final class TOFUHostKeyDelegate: NIOSSHClientServerAuthenticationDelegate, @unchecked Sendable {
        private let pin: HostKeyPin
        private let mismatch: MismatchBox

        init(pin: HostKeyPin, mismatch: MismatchBox) {
            self.pin = pin
            self.mismatch = mismatch
        }

        func validateHostKey(hostKey: NIOSSHPublicKey, validationCompletePromise: EventLoopPromise<Void>) {
            var buffer = ByteBuffer()
            _ = hostKey.write(to: &buffer)
            let digest = SHA256.hash(data: Data(buffer.readableBytesView))
            let fingerprint = Data(digest).base64EncodedString()

            if let stored = pin.load() {
                if stored == fingerprint {
                    validationCompletePromise.succeed(())
                } else {
                    mismatch.tripped = true
                    validationCompletePromise.fail(HerdrError(
                        code: "host_key_changed",
                        message: "host key fingerprint mismatch"
                    ))
                }
            } else {
                pin.save(fingerprint)   // first contact: trust and pin
                validationCompletePromise.succeed(())
            }
        }
    }

    // MARK: - Commands

    /// Non-interactive SSH shells don't load the user's profile, so herdr's
    /// install dir (~/.local/bin, Homebrew) usually isn't on PATH and `herdr`
    /// resolves to command-not-found (exit 127). We set a COMPLETE PATH with the
    /// standard system dirs spelled out rather than trusting the inherited
    /// `$PATH`: zsh sources `.zshenv` on every exec (so it has a full PATH), but
    /// a `sh` login shell sources nothing non-interactively and may inherit only
    /// a minimal PATH from sshd — which broke connecting for sh users (even
    /// `ls`/`tail` could be missing). Listing /usr/bin:/bin etc. makes it work
    /// regardless of the account's login shell.
    private static func withPath(_ command: String) -> String {
        #"export PATH="$HOME/.local/bin:$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"; "# + command
    }

    private func execOnce(_ command: String) async throws -> Data {
        let client = try await connected()
        let buffer = try await client.executeCommand(Self.withPath(command))
        return Data(buffer.readableBytesView)
    }

    public func shell(_ command: String) async throws -> Data {
        do {
            return try await execOnce(command)
        } catch let error as SSHClient.CommandFailed {
            // The command ran and exited non-zero: a real result, don't retry.
            throw Self.commandError(exitCode: Int(error.exitCode))
        } catch let error as HerdrError {
            throw error   // host_key_changed etc. — retrying won't change it
        } catch {
            // Connection-level failure (dead socket, handshake, channel):
            // rebuild the connection and retry once, transparently.
            await resetClient()
            do {
                return try await execOnce(command)
            } catch let retryError as SSHClient.CommandFailed {
                throw Self.commandError(exitCode: Int(retryError.exitCode))
            }
        }
    }

    /// Turn a non-zero exit into a helpful message. Exit 127 = "command not
    /// found", which for us almost always means `herdr` isn't installed on this
    /// account (or isn't on PATH) — spell that out instead of a bare code.
    private static func commandError(exitCode: Int) -> HerdrError {
        if exitCode == 127 {
            return HerdrError(
                code: "herdr_not_found",
                message: "herdr wasn't found on this account (exit 127). It's likely not installed for this user, or not on PATH. Install herdr on the host, or set its full path in the connection's Advanced settings."
            )
        }
        return HerdrError(code: "ssh_command_failed", message: "The command failed on the host (exit \(exitCode)).")
    }

    public nonisolated func streamLines(_ command: String) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    // Establish (or heal) the connection with one retry, then stream.
                    var client: SSHClient
                    do {
                        client = try await self.connected()
                    } catch let error as HerdrError {
                        throw error
                    } catch {
                        await self.resetClient()
                        client = try await self.connected()
                    }
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
