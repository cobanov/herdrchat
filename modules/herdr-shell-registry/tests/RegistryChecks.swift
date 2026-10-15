import Foundation

@main struct RegistryChecks {
  static func main() async throws {
    precondition(EchoShell.cooked(Data([0x61, 0x0D, 0x7F])) == Data([0x61, 0x0D, 0x0A, 0x08, 0x20, 0x08]))

    let registry = ShellRegistry()
    EchoShell.open("echo-1", registry: registry)
    registry.deliver("echo-1", Data("prompt$ ".utf8))
    precondition(registry.send("echo-1", Data("ls\r".utf8)))
    let (received, token) = await MainActor.run { () -> (Data, UUID) in
      var got = Data()
      let token = registry.attach("echo-1") { got.append($0) }
      return (got, token)
    }
    precondition(String(decoding: received, as: UTF8.self) == "prompt$ ls\r\n",
                 "output before attach is handed over in order, got \(received)")
    registry.detach("echo-1", token: UUID())
    registry.unregister("echo-1")
    precondition(!registry.send("echo-1", Data("x".utf8)) && !registry.isOpen("echo-1"))
    registry.detach("echo-1", token: token)

    // Output that arrives after the app forgot a shell is not held for a view
    // that will never come.
    EchoShell.open("echo-2", registry: registry)
    registry.forget("echo-2")
    registry.deliver("echo-2", Data("late".utf8))
    let late = await MainActor.run { () -> Data in
      var got = Data()
      let token = registry.attach("echo-2") { got.append($0) }
      registry.detach("echo-2", token: token)
      return got
    }
    precondition(late.isEmpty, "output after forget is dropped, got \(late)")
    print("PASS echo shell, and the registry hands early output to a late view, and drops it once forgotten")
  }
}
