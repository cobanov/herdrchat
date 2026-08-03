import SwiftUI
import HerdrKit

/// Add or edit a herdr host. Secret (private key or password) is written to the
/// Keychain on save; it is never shown pre-filled when editing. A connection must
/// pass a live test before it can be saved.
struct ConnectionEditView: View {
    let store: ConnectionStore
    let existing: ServerConnection?
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var host: String
    @State private var port: String
    @State private var username: String
    @State private var authKind: ServerConnection.AuthKind
    @State private var secret: String
    @State private var herdrPath: String
    @State private var testState: TestState = .idle
    @State private var testHerdrMissing = false
    @State private var installing = false

    enum TestState: Equatable {
        case idle, testing, ok, fail(String)
    }

    init(store: ConnectionStore, existing: ServerConnection?) {
        self.store = store
        self.existing = existing
        _name = State(initialValue: existing?.name ?? "")
        _host = State(initialValue: existing?.host ?? "")
        _port = State(initialValue: String(existing?.port ?? 22))
        _username = State(initialValue: existing?.username ?? "")
        _authKind = State(initialValue: existing?.authKind ?? .privateKey)
        _secret = State(initialValue: "")
        _herdrPath = State(initialValue: existing?.herdrPath ?? "herdr")
    }

    var body: some View {
        Form {
            serverSection
            authSection
            advancedSection
            testSection
        }
        .navigationTitle(existing == nil ? "New server" : "Edit")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }.disabled(!isValid || testState != .ok)
            }
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
        }
        // Any change to connection-relevant fields invalidates a prior test.
        .onChange(of: host) { testState = .idle }
        .onChange(of: port) { testState = .idle }
        .onChange(of: username) { testState = .idle }
        .onChange(of: authKind) { testState = .idle }
        .onChange(of: secret) { testState = .idle }
        .onChange(of: herdrPath) { testState = .idle }
    }

    @ViewBuilder private var serverSection: some View {
        Section("Server") {
            TextField("Name (e.g. nuc)", text: $name)
            TextField("Host / Tailscale address", text: $host)
                .textContentType(.URL)
                .autocorrectionDisabled()
            TextField("Port", text: $port)
            TextField("Username", text: $username)
                .autocorrectionDisabled()
        }
    }

    @ViewBuilder private var authSection: some View {
        Section("Authentication") {
            Picker("Method", selection: $authKind) {
                Text("Private key").tag(ServerConnection.AuthKind.privateKey)
                Text("Password").tag(ServerConnection.AuthKind.password)
            }
            .pickerStyle(.segmented)

            if authKind == .privateKey {
                Text("Paste your OpenSSH private key (id_ed25519):")
                    .font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $secret)
                    .frame(minHeight: 120)
                    .font(.system(.footnote, design: .monospaced))
                    .autocorrectionDisabled()
            } else {
                SecureField("Password", text: $secret)
            }
            if existing != nil {
                Text("Leave empty to keep the current secret.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private var advancedSection: some View {
        Section("Advanced") {
            TextField("herdr path", text: $herdrPath)
                .autocorrectionDisabled()
        }
    }

    @ViewBuilder private var testSection: some View {
        Section {
            Button(action: test) {
                if testState == .testing {
                    HStack { ProgressView().controlSize(.small); Text("Testing…") }
                } else {
                    Label("Test connection", systemImage: "bolt.horizontal.circle")
                }
            }
            .disabled(!isValid || testState == .testing)

            testResultRow
        } footer: {
            Text("Verify the connection works before saving.")
        }
    }

    @ViewBuilder private var testResultRow: some View {
        switch testState {
        case .ok:
            Label("Connection successful", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.subheadline)
        case .fail(let message):
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Connection failed").font(.subheadline.weight(.semibold))
                    Text(message).font(.caption).foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
            }
            if testHerdrMissing {
                Button(action: installHerdr) {
                    HStack(spacing: 6) {
                        if installing {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "arrow.down.circle")
                        }
                        Text(installing ? "Installing herdr…" : "Install herdr on the host")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(installing)
            }
        case .idle, .testing:
            EmptyView()
        }
    }

    private var isValid: Bool {
        !name.isEmpty && !host.isEmpty && !username.isEmpty && Int(port) != nil
    }

    private func makeClient() -> HerdrClient {
        store.makeTestClient(
            host: host,
            port: Int(port) ?? 22,
            username: username,
            authKind: authKind,
            secret: secret,
            herdrPath: herdrPath,
            fallbackId: existing?.id
        )
    }

    private func test() {
        testState = .testing
        testHerdrMissing = false
        let client = makeClient()
        Task {
            do {
                try await client.ping()
                testState = .ok
            } catch {
                let herdrError = error as? HerdrError
                testHerdrMissing = herdrError?.code == "herdr_not_found"
                testState = .fail(herdrError?.message ?? error.localizedDescription)
            }
        }
    }

    /// Install herdr on the host, then re-test so the connection can be saved.
    private func installHerdr() {
        installing = true
        let client = makeClient()
        Task {
            do {
                try await client.installHerdr()
                installing = false
                test()
            } catch {
                installing = false
                testState = .fail((error as? HerdrError)?.message ?? error.localizedDescription)
            }
        }
    }

    private func save() {
        let connection = ServerConnection(
            id: existing?.id ?? UUID(),
            name: name,
            host: host,
            port: Int(port) ?? 22,
            username: username,
            authKind: authKind,
            herdrPath: herdrPath.isEmpty ? "herdr" : herdrPath
        )
        // Keep the existing secret if the field was left blank while editing.
        let secretToSave = secret.isEmpty ? nil : secret
        store.save(connection, secret: secretToSave)
        dismiss()
    }
}
