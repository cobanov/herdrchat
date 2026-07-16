// swift-tools-version: 6.0
import PackageDescription

// HerdrKit holds the pure logic (models, protocol envelope, transcript parsing).
// It stays dependency-free so it builds and tests with the `swift` CLI on this
// machine, without a full Xcode install. The SSH transport (Citadel) lands in a
// separate target so this core keeps building offline.
let package = Package(
    name: "HerdrKit",
    platforms: [
        .macOS(.v13),
        .iOS(.v17),
    ],
    products: [
        .library(name: "HerdrKit", targets: ["HerdrKit"]),
    ],
    targets: [
        .target(name: "HerdrKit"),
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
