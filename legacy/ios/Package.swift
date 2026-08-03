// swift-tools-version: 6.0
import PackageDescription

// HerdrKit holds the pure logic (models, protocol envelope, transcript parsing).
// It stays dependency-free so it builds and tests with the `swift` CLI on this
// machine, without a full Xcode install. The SSH transport (Citadel) lands in a
// separate target so this core keeps building offline.
let package = Package(
    name: "HerdrKit",
    platforms: [
        .macOS(.v14),
        .iOS(.v17),
    ],
    products: [
        .library(name: "HerdrKit", targets: ["HerdrKit"]),
        .library(name: "HerdrNet", targets: ["HerdrNet"]),
        .library(name: "HerdrChatUI", targets: ["HerdrChatUI"]),
    ],
    dependencies: [
        // Pure-Swift SSH client (SwiftNIO SSH). Builds for iOS; used only by the
        // HerdrNet transport so the HerdrKit core stays dependency-free.
        .package(url: "https://github.com/orlandos-nl/Citadel.git", from: "0.8.0"),
    ],
    targets: [
        .target(name: "HerdrKit"),
        // SSH-over-Tailscale transport for herdr, kept separate so HerdrKit builds
        // offline and without a crypto stack.
        .target(
            name: "HerdrNet",
            dependencies: [
                "HerdrKit",
                .product(name: "Citadel", package: "Citadel"),
            ],
            // Citadel's SSHClient predates strict-concurrency auditing (it is
            // internally NIO-serialised but not marked Sendable). Build this thin
            // wrapper in Swift 5 language mode; the HerdrKit core stays on Swift 6.
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        // SwiftUI layer: views + view models. A library (not the app target) so
        // the bulk of the UI type-checks with `swift build` on macOS; the iOS app
        // is a thin @main shell that imports this.
        .target(name: "HerdrChatUI", dependencies: ["HerdrKit", "HerdrNet"]),
        // Runnable checks for machines with only Command Line Tools (no XCTest).
        // `swift run herdr-smoke` exercises the same decoding paths as the tests.
        .executableTarget(name: "HerdrSmoke", dependencies: ["HerdrKit"]),
        .testTarget(
            name: "HerdrKitTests",
            dependencies: ["HerdrKit"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
