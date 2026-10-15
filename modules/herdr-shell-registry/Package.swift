// swift-tools-version: 5.9
import PackageDescription

// `swift run --package-path modules/herdr-shell-registry RegistryChecks`: the
// registry and the echo shell on macOS, the same source the pod compiles.
let package = Package(
  name: "HerdrShellRegistryChecks",
  platforms: [.macOS("15.0")],
  targets: [.executableTarget(
    name: "RegistryChecks",
    path: ".",
    exclude: ["expo-module.config.json", "ios/HerdrShellRegistry.podspec", "README.md"],
    sources: ["ios/ShellRegistry.swift", "tests/RegistryChecks.swift"]
  )]
)
