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
        .navigationTitle(existing == nil ? "Yeni sunucu" : "Düzenle")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Kaydet") { save() }.disabled(!isValid || testState != .ok)
            }
            ToolbarItem(placement: .cancellationAction) {
                Button("İptal") { dismiss() }
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
        Section("Sunucu") {
            TextField("Ad (örn. nuc)", text: $name)
            TextField("Host / Tailscale adresi", text: $host)
                .textContentType(.URL)
                .autocorrectionDisabled()
            TextField("Port", text: $port)
            TextField("Kullanıcı adı", text: $username)
                .autocorrectionDisabled()
        }
    }

    @ViewBuilder private var authSection: some View {
        Section("Kimlik doğrulama") {
            Picker("Yöntem", selection: $authKind) {
                Text("Özel anahtar").tag(ServerConnection.AuthKind.privateKey)
                Text("Parola").tag(ServerConnection.AuthKind.password)
            }
            .pickerStyle(.segmented)

            if authKind == .privateKey {
                Text("OpenSSH özel anahtarını yapıştır (id_ed25519):")
                    .font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $secret)
                    .frame(minHeight: 120)
                    .font(.system(.footnote, design: .monospaced))
                    .autocorrectionDisabled()
            } else {
                SecureField("Parola", text: $secret)
            }
            if existing != nil {
                Text("Boş bırakılırsa mevcut sır korunur.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private var advancedSection: some View {
        Section("Gelişmiş") {
            TextField("herdr yolu", text: $herdrPath)
                .autocorrectionDisabled()
        }
    }

    @ViewBuilder private var testSection: some View {
        Section {
            Button(action: test) {
                if testState == .testing {
                    HStack { ProgressView().controlSize(.small); Text("Test ediliyor…") }
                } else {
                    Label("Bağlantıyı test et", systemImage: "bolt.horizontal.circle")
                }
            }
            .disabled(!isValid || testState == .testing)

            testResultRow
        } footer: {
            Text("Kaydetmeden önce bağlantının çalıştığını doğrula.")
        }
    }

    @ViewBuilder private var testResultRow: some View {
        switch testState {
        case .ok:
            Label("Bağlantı başarılı", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.subheadline)
        case .fail(let message):
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Bağlantı başarısız").font(.subheadline.weight(.semibold))
                    Text(message).font(.caption).foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
            }
        case .idle, .testing:
            EmptyView()
        }
    }

    private var isValid: Bool {
        !name.isEmpty && !host.isEmpty && !username.isEmpty && Int(port) != nil
    }

    private func test() {
        testState = .testing
        let client = store.makeTestClient(
            host: host,
            port: Int(port) ?? 22,
            username: username,
            authKind: authKind,
            secret: secret,
            herdrPath: herdrPath,
            fallbackId: existing?.id
        )
        Task {
            do {
                try await client.ping()
                testState = .ok
            } catch {
                testState = .fail((error as? HerdrError)?.description ?? error.localizedDescription)
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
