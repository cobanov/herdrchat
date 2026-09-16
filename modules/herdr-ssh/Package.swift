// swift-tools-version: 5.9
import PackageDescription

// Local macOS security checks compile the same connection code as the iOS pod.
let package = Package(
  name: "HerdrSshChecks",
  platforms: [.macOS("15.0")],
  dependencies: [.package(url: "https://github.com/orlandos-nl/Citadel.git", exact: "0.12.1")],
  targets: [.executableTarget(
    name: "NativeChecks",
    dependencies: [.product(name: "Citadel", package: "Citadel")],
    path: ".",
    exclude: ["android", "src", "README.md", "expo-module.config.json", "ios/HerdrSshModule.swift", "ios/HerdrSsh.podspec"],
    sources: ["ios/SshConnection.swift", "ios/HostKeyPin.swift", "tests/NativeChecks.swift"]
  )]
)
