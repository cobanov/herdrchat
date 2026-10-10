import Foundation

/// The meeting point between a shell channel and the terminal view showing it.
///
/// A terminal's bytes never cross the JavaScript bridge. The SSH side
/// (`herdr-ssh`) registers each open shell's input here, and `deliver`s its
/// output; the terminal view (`herdr-terminal`) attaches a sink for the output
/// and sends keystrokes and size changes back. JavaScript only names which
/// shell a view shows, by its id.
///
/// A pod of its own, with no dependencies, because the two modules cannot
/// import each other cheaply: importing HerdrSsh needs Citadel's C modules
/// (`_AtomicsShims`, the NIO shims) on the importer's search paths, and only a
/// target that links the package has them.
///
/// The two sides arrive in either order. Output that comes before a view has
/// attached (the first screen of a fast host, or the error of a command that
/// failed at once) is kept and handed over on attach, so nothing is lost
/// between `openShell` resolving and the view getting its `shellId` prop.
///
/// Sinks are called on the main thread, in the order the bytes arrived: a
/// terminal emulator is fed from the thread that draws it.
public final class ShellRegistry: @unchecked Sendable {
  public static let shared = ShellRegistry()

  /// What a shell accepts from its view.
  public struct Input {
    public let write: (Data) -> Void
    public let resize: (_ cols: Int, _ rows: Int) -> Void

    public init(write: @escaping (Data) -> Void, resize: @escaping (_ cols: Int, _ rows: Int) -> Void) {
      self.write = write
      self.resize = resize
    }
  }

  private struct Sink {
    let token: UUID
    let receive: (Data) -> Void
  }

  /// Output held for a view that has not attached yet. Bounded: past this the
  /// oldest bytes go, since a view that never comes must not grow memory
  /// without end.
  static let maxBacklogBytes = 2 * 1024 * 1024

  private let lock = NSLock()
  private var inputs: [String: Input] = [:]
  private var sinks: [String: Sink] = [:]
  private var backlogs: [String: Data] = [:]

  public init() {}

  // MARK: - The shell's side

  public func register(_ shellId: String, input: Input) {
    lock.lock()
    inputs[shellId] = input
    lock.unlock()
  }

  /// The shell ended. Its view stays attached (it keeps its scrollback), and
  /// any held output stays for a view still to come, until `forget`.
  public func unregister(_ shellId: String) {
    lock.lock()
    inputs[shellId] = nil
    lock.unlock()
  }

  /// Drop everything about a shell: the app closed it.
  public func forget(_ shellId: String) {
    lock.lock()
    inputs[shellId] = nil
    backlogs[shellId] = nil
    lock.unlock()
  }

  /// Output for the view. Callable from any thread. Public so the Demo's
  /// recorded screens can be fed to a view the same way a host's bytes are.
  ///
  /// With no view attached, it is held only for a shell that is still
  /// registered: a channel delivers its last chunks after `forget` (closing
  /// is not instant), and holding those under an id nobody will attach to
  /// again kept up to `maxBacklogBytes` per terminal opened for good.
  public func deliver(_ shellId: String, _ data: Data) {
    guard !data.isEmpty else { return }
    lock.lock()
    if let sink = sinks[shellId] {
      lock.unlock()
      DispatchQueue.main.async { sink.receive(data) }
      return
    }
    guard inputs[shellId] != nil else {
      lock.unlock()
      return
    }
    var backlog = backlogs[shellId] ?? Data()
    backlog.append(data)
    if backlog.count > Self.maxBacklogBytes {
      backlog = Data(backlog.suffix(Self.maxBacklogBytes))
    }
    backlogs[shellId] = backlog
    lock.unlock()
  }

  // MARK: - The view's side

  /// Start receiving a shell's output. Call on the main thread; output held
  /// so far is passed to `receive` before this returns. Keep the token to
  /// detach with.
  public func attach(_ shellId: String, receive: @escaping (Data) -> Void) -> UUID {
    dispatchPrecondition(condition: .onQueue(.main))
    let token = UUID()
    lock.lock()
    sinks[shellId] = Sink(token: token, receive: receive)
    let held = backlogs.removeValue(forKey: shellId)
    lock.unlock()
    if let held { receive(held) }
    return token
  }

  /// Stop receiving. A token from an older attach is ignored, so a view being
  /// replaced cannot detach its successor.
  public func detach(_ shellId: String, token: UUID) {
    lock.lock()
    if sinks[shellId]?.token == token { sinks[shellId] = nil }
    lock.unlock()
  }

  /// Keystrokes from the view. False when the shell is no longer open.
  @discardableResult
  public func send(_ shellId: String, _ data: Data) -> Bool {
    lock.lock()
    let input = inputs[shellId]
    lock.unlock()
    guard let input else { return false }
    input.write(data)
    return true
  }

  /// The view's size in cells changed.
  @discardableResult
  public func resize(_ shellId: String, cols: Int, rows: Int) -> Bool {
    guard cols > 0, rows > 0 else { return false }
    lock.lock()
    let input = inputs[shellId]
    lock.unlock()
    guard let input else { return false }
    input.resize(cols, rows)
    return true
  }

  public func isOpen(_ shellId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return inputs[shellId] != nil
  }
}

/// The Demo's shell: no host, no channel. What is typed comes straight back,
/// the way a terminal in cooked mode echoes it, so the Demo's terminal can be
/// typed into; the Demo feeds its recorded screens with `deliver`.
public enum EchoShell {
  public static func open(_ shellId: String, registry: ShellRegistry = .shared) {
    registry.register(shellId, input: ShellRegistry.Input(
      write: { data in registry.deliver(shellId, cooked(data)) },
      resize: { _, _ in }
    ))
  }

  /// Return as a new line, Delete as erase-one-back; everything else as typed.
  public static func cooked(_ data: Data) -> Data {
    var out = Data()
    for byte in data {
      switch byte {
      case 0x0D: out.append(contentsOf: [0x0D, 0x0A])
      case 0x7F, 0x08: out.append(contentsOf: [0x08, 0x20, 0x08])
      default: out.append(byte)
      }
    }
    return out
  }
}
