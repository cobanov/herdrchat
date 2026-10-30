import ExpoModulesCore

/// The hardware model identifier, such as `iPhone19,4` for the iPhone Duo.
///
/// Not `expo-device`: its `modelId` is `uname`'s machine, which on a simulator
/// is the Mac's `arm64`, so the Duo simulator could never be told from any
/// other iPhone and its layout never checked there. A simulator names the
/// device it plays in `SIMULATOR_MODEL_IDENTIFIER`.
public class HerdrDeviceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdrDevice")

    Constant("modelId") { HerdrDeviceModule.modelId }
  }

  static let modelId: String = {
    #if targetEnvironment(simulator)
    if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
      return simulated
    }
    #endif
    var info = utsname()
    uname(&info)
    return Mirror(reflecting: info.machine).children.reduce(into: "") { identifier, element in
      guard let value = element.value as? Int8, value != 0 else { return }
      identifier.append(Character(UnicodeScalar(UInt8(value))))
    }
  }()
}
