import SwiftUI
import HerdrChatUI

/// Thin iOS entry point. All UI lives in the HerdrChatUI package library so it
/// can be built and type-checked without a full Xcode install.
@main
struct HerdrChatApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
