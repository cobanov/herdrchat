import Foundation
import HerdrKit
#if canImport(UIKit)
import UIKit
#endif

/// iOS remote-push registration. The app registers with APNs, receives a device
/// token, and writes it to the connected herdr host (~/.config/herdrchat/
/// apns-tokens/<id>.json). The host's `herdr-apns-notifier.py` watcher reads
/// those tokens and pushes to the phone when an agent blocks/finishes — so
/// notifications arrive even when HerdrChat is closed or backgrounded (which
/// the SSH-only foreground path can't do on iOS).
@MainActor
public enum PushRegistration {
    public private(set) static var deviceTokenHex: String?

    /// Called from the app delegate's didRegister callback.
    public static func setDeviceToken(_ data: Data) {
        deviceTokenHex = data.map { String(format: "%02x", $0) }.joined()
    }

    /// Stable per-install id, used as the token filename on the host.
    public static var deviceId: String {
        #if canImport(UIKit)
        let raw = UIDevice.current.identifierForVendor?.uuidString ?? "unknown"
        #else
        let raw = "unknown"
        #endif
        return String(raw.map { $0.isLetter || $0.isNumber || $0 == "-" ? $0 : "-" })
    }

    /// Ask iOS for an APNs device token (needs the aps-environment entitlement).
    public static func register() {
        #if os(iOS)
        UIApplication.shared.registerForRemoteNotifications()
        #endif
    }

    /// Write this device's APNs token to the host so its watcher can push to it.
    /// Best-effort and idempotent — safe to call on every connect.
    public static func upload(using transport: any HerdrTransport) async {
        guard let token = deviceTokenHex else { return }
        let payload = "{\"token\":\"\(token)\",\"bundleId\":\"dev.herdr.HerdrChat\",\"env\":\"production\"}"
        let dir = "\"$HOME/.config/herdrchat/apns-tokens\""
        let cmd = "mkdir -p \(dir) && printf '%s' \(ShellQuoting.quote(payload)) > \(dir)/\(deviceId).json"
        _ = try? await transport.shell(cmd)
    }
}
