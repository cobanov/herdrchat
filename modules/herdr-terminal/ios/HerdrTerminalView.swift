import ExpoModulesCore
import HerdrShellRegistry
import SwiftTerm
import UIKit

/// A herdr pane's terminal: SwiftTerm's emulator, fed by a shell channel.
///
/// The bytes stay native both ways. The view attaches to its shell in
/// `ShellRegistry` by id (the `shellId` prop) and receives output on the main
/// thread; what SwiftTerm sends back (typing, a hardware keyboard's keys,
/// mouse reports, answers to the program's queries) goes straight to the
/// channel. JavaScript sees the title, the bell, the size in cells and the
/// font size, never the stream.
///
/// A new `shellId` (a reconnect) re-attaches without resetting the emulator,
/// so the scrollback stays across it.
///
/// SwiftTerm's own keyboard accessory is turned off: the app draws its own
/// bar, in its own style, and writes the bar's keys with `writeShell`. Its
/// sticky Ctrl and Alt reach the software keyboard through the
/// `controlModifier`/`metaModifier` props.
final class HerdrTerminalView: ExpoView, TerminalViewDelegate, UIGestureRecognizerDelegate {
  let onTitle = EventDispatcher()
  let onBell = EventDispatcher()
  let onSizeChange = EventDispatcher()
  let onFontSizeChange = EventDispatcher()
  let onModifiersReset = EventDispatcher()

  let terminal = PaneTerminalView(frame: .zero)

  var minFontSize: CGFloat = 8
  var maxFontSize: CGFloat = 28
  private var fontSize: CGFloat = 13
  private var pinchStartSize: CGFloat = 13

  private var shellId: String?
  private var token: UUID?
  private var reportedSize: (cols: Int, rows: Int)?

  private lazy var clearCommand: UIKeyCommand = {
    let command = UIKeyCommand(
      title: "Clear Scrollback",
      action: #selector(clearScrollback),
      input: "k",
      modifierFlags: .command
    )
    command.wantsPriorityOverSystemBehavior = true
    return command
  }()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    terminal.terminalDelegate = self
    terminal.inputAccessoryView = nil
    terminal.optionAsMetaKey = true
    terminal.font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
    addSubview(terminal)

    let pinch = UIPinchGestureRecognizer(target: self, action: #selector(pinched(_:)))
    pinch.delegate = self
    addGestureRecognizer(pinch)

    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(modifiersReset), name: .terminalViewControlModifierReset, object: terminal)
    center.addObserver(self, selector: #selector(modifiersReset), name: .terminalViewMetaModifierReset, object: terminal)
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    if let shellId, let token { ShellRegistry.shared.detach(shellId, token: token) }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if terminal.frame != bounds { terminal.frame = bounds }
    reportSize()
  }

  // MARK: - The shell

  func bind(_ newId: String?) {
    guard newId != shellId else { return }
    if let shellId, let token { ShellRegistry.shared.detach(shellId, token: token) }
    shellId = newId
    token = nil
    guard let newId else { return }
    token = ShellRegistry.shared.attach(newId) { [weak self] data in
      self?.terminal.feed(byteArray: [UInt8](data)[...])
    }
    // A shell opened before the last layout, or reopened after a rotation,
    // gets the size the view has now.
    let size = terminal.getTerminal()
    ShellRegistry.shared.resize(newId, cols: size.cols, rows: size.rows)
  }

  private func reportSize() {
    let size = terminal.getTerminal()
    guard bounds.width > 0, bounds.height > 0, size.cols > 0, size.rows > 0 else { return }
    if let reported = reportedSize, reported.cols == size.cols, reported.rows == size.rows { return }
    reportedSize = (size.cols, size.rows)
    onSizeChange(["cols": size.cols, "rows": size.rows])
  }

  // MARK: - Look

  func apply(_ theme: TerminalThemeRecord) {
    if theme.ansi.count == 16 {
      terminal.installColors(theme.ansi.map(Self.terminalColor))
    }
    if let foreground = theme.foreground {
      terminal.nativeForegroundColor = foreground
    }
    if let background = theme.background {
      terminal.nativeBackgroundColor = background
      terminal.backgroundColor = background
      terminal.layer.backgroundColor = background.cgColor
      backgroundColor = background
    }
    if let cursor = theme.cursor {
      terminal.caretColor = cursor
    }
    if let selection = theme.selection {
      terminal.selectedTextBackgroundColor = selection
    }
    terminal.keyboardAppearance = theme.dark ? .dark : .light
    terminal.indicatorStyle = theme.dark ? .white : .black
  }

  func setFontSize(_ size: CGFloat) {
    let clamped = min(max(size, minFontSize), maxFontSize)
    guard clamped != terminal.font.pointSize else { return }
    fontSize = clamped
    terminal.font = UIFont.monospacedSystemFont(ofSize: clamped, weight: .regular)
  }

  private static func terminalColor(_ color: UIColor) -> SwiftTerm.Color {
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    func channel(_ value: CGFloat) -> UInt16 { UInt16(min(max(value, 0), 1) * 65535) }
    return SwiftTerm.Color(red: channel(red), green: channel(green), blue: channel(blue))
  }

  // MARK: - Gestures and keys

  @objc private func pinched(_ gesture: UIPinchGestureRecognizer) {
    switch gesture.state {
    case .began:
      pinchStartSize = fontSize
    case .changed:
      setFontSize((pinchStartSize * gesture.scale).rounded())
    case .ended:
      onFontSizeChange(["fontSize": Double(fontSize)])
    default:
      break
    }
  }

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool {
    // Scrolling the scrollback stays the terminal's own, alongside a pinch.
    // Not the wheel (a swipe while the program has the mouse): a pinch that
    // also scrolled herdr would move what is being zoomed.
    !(other is UIPinchGestureRecognizer) && other !== terminal.wheelGesture
  }

  override var keyCommands: [UIKeyCommand]? {
    [clearCommand]
  }

  @objc private func clearScrollback() {
    terminal.clearScrollback()
  }

  @objc private func modifiersReset() {
    onModifiersReset([
      "control": terminal.controlModifier,
      "meta": terminal.metaModifier,
    ])
  }

  // MARK: - TerminalViewDelegate

  func send(source: SwiftTerm.TerminalView, data: ArraySlice<UInt8>) {
    guard let shellId else { return }
    ShellRegistry.shared.send(shellId, Data(data))
  }

  func sizeChanged(source: SwiftTerm.TerminalView, newCols: Int, newRows: Int) {
    if let shellId { ShellRegistry.shared.resize(shellId, cols: newCols, rows: newRows) }
    reportSize()
  }

  func setTerminalTitle(source: SwiftTerm.TerminalView, title: String) {
    onTitle(["title": title])
  }

  func bell(source: SwiftTerm.TerminalView) {
    onBell([:])
  }

  func hostCurrentDirectoryUpdate(source: SwiftTerm.TerminalView, directory: String?) {}

  func scrolled(source: SwiftTerm.TerminalView, position: Double) {}

  func requestOpenLink(source: SwiftTerm.TerminalView, link: String, params: [String: String]) {
    guard let url = URL(string: link), let scheme = url.scheme?.lowercased(),
          scheme == "http" || scheme == "https" else { return }
    UIApplication.shared.open(url)
  }

  /// OSC 52 from the program (a copy in herdr, vim, tmux): onto the pasteboard.
  func clipboardCopy(source: SwiftTerm.TerminalView, content: Data) {
    if let text = String(data: content, encoding: .utf8) {
      UIPasteboard.general.string = text
    }
  }

  /// A program asking to read the pasteboard is refused: it would read
  /// whatever the person last copied, anywhere, without their knowing.
  func clipboardRead(source: SwiftTerm.TerminalView) -> Data? { nil }

  func iTermContent(source: SwiftTerm.TerminalView, content: ArraySlice<UInt8>) {}

  func rangeChanged(source: SwiftTerm.TerminalView, startY: Int, endY: Int) {}
}
