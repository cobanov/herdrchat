import SwiftUI
import HerdrChatUI
#if os(iOS)
import UIKit

/// Catches the APNs device-token callbacks (SwiftUI has no native hook for them)
/// and hands the token to `PushRegistration`, which uploads it to the herdr host.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in PushRegistration.setDeviceToken(deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // No token this launch; the app just falls back to foreground-only notifications.
    }
}
#endif

/// Thin iOS entry point. All UI lives in the HerdrChatUI package library so it
/// can be built and type-checked without a full Xcode install.
@main
struct HerdrChatApp: App {
    @Environment(\.scenePhase) private var scenePhase
    #if os(iOS)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif

    init() {
        // Must register before the app finishes launching.
        BackgroundRefresh.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                AgentNotifier.requestAuthorizationIfNeeded()
                AgentNotifier.configureForegroundPresentation()
                // Ask APNs for a device token; delivered to AppDelegate, then
                // uploaded to the host by the chat-list view model.
                PushRegistration.register()
            case .background:
                // Arm the server-free notification check (blocked/done diffs).
                BackgroundRefresh.schedule()
            default:
                break
            }
        }
    }
}
