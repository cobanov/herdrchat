import SwiftUI

/// Add or edit a herdr host. Secret (private key or password) is written to the
/// Keychain on save; it is never shown pre-filled when editing.
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
            Section("Sunucu") {
                TextField("Ad (örn. nuc)", text: $name)
                TextField("Host / Tailscale adresi", text: $host)
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                TextField("Port", text: $port)
                TextField("Kullanıcı adı", text: $username)
                    .autocorrectionDisabled()
            }
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
            Section("Gelişmiş") {
                TextField("herdr yolu", text: $herdrPath).autocorrectionDisabled()
            }
        }
        .navigationTitle(existing == nil ? "Yeni sunucu" : "Düzenle")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Kaydet") { save() }.disabled(!isValid)
            }
            ToolbarItem(placement: .cancellationAction) {
                Button("İptal") { dismiss() }
            }
        }
    }

    private var isValid: Bool {
        !name.isEmpty && !host.isEmpty && !username.isEmpty && Int(port) != nil
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
