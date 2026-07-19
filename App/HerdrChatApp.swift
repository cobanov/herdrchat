import SwiftUI
import HerdrChatUI

/// Thin iOS entry point. All UI lives in the HerdrChatUI package library so it
/// can be built and type-checked without a full Xcode install.
@main
struct HerdrChatApp: App {
    @Environment(\.scenePhase) private var scenePhase

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
            case .background:
                // Arm the server-free notification check (blocked/done diffs).
                BackgroundRefresh.schedule()
            default:
                break
            }
        }
    }
}
