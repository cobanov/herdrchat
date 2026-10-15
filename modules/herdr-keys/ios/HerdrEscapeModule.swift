import ExpoModulesCore
import UIKit

/// Esc on a hardware keyboard, for a floating card that closes on it (a
/// workspace's layout on iPad). A module of its own rather than a second view
/// in `HerdrKeys`, so the composer's view and how JS finds it are untouched.
public class HerdrEscapeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdrEscape")

    View(EscapeKeyView.self) {
      Events("onEscape")

      Prop("active") { (view: EscapeKeyView, active: Bool) in
        view.active = active
      }
    }
  }
}

/// Offers Esc while `active`, by becoming the first responder.
///
/// UIKit looks for key commands from the first responder up to the window,
/// and with nothing focused there is no responder on that path at all, so a
/// command on a plain container is never asked. This view takes first
/// responder while active, which takes focus from a text field (the composer
/// beside the list, on iPad), and hands it back to whatever held it when it
/// stops being active or leaves the window: someone typing who glanced at a
/// layout goes on typing without tapping the field again.
final class EscapeKeyView: ExpoView {
  let onEscape = EventDispatcher()

  var active = false {
    didSet { claimFocus() }
  }

  private lazy var escape: UIKeyCommand = {
    let command = UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(escapePressed))
    command.wantsPriorityOverSystemBehavior = true
    return command
  }()

  override var canBecomeFirstResponder: Bool { active }

  override var keyCommands: [UIKeyCommand]? {
    active ? [escape] : []
  }

  /// What had focus before this view took it, to hand it back.
  private weak var previous: UIResponder?

  override func willMove(toWindow newWindow: UIWindow?) {
    super.willMove(toWindow: newWindow)
    // Closed by unmounting, still active: UIKit would resign it on the way
    // out and hand focus to nobody.
    if newWindow == nil { giveBack() }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    claimFocus()
  }

  private func claimFocus() {
    if active {
      // After this layout pass: a view becomes first responder only once it
      // is in a window, and props arrive before it is.
      DispatchQueue.main.async { [weak self] in
        guard let self, self.active, self.window != nil, !self.isFirstResponder else { return }
        let holder = UIResponder.herdrCurrentFirstResponder()
        if holder !== self { self.previous = holder }
        self.becomeFirstResponder()
      }
    } else {
      giveBack()
    }
  }

  private func giveBack() {
    let holder = previous
    previous = nil
    guard isFirstResponder else { return }
    resignFirstResponder()
    // Only to a view still on screen: a thread that closed meanwhile is gone.
    if let view = holder as? UIView, view.window != nil {
      view.becomeFirstResponder()
    }
  }

  @objc private func escapePressed() {
    onEscape([:])
  }
}

private extension UIResponder {
  private static weak var herdrFound: UIResponder?

  /// The first responder now, if any: the action goes to it when sent to nil.
  static func herdrCurrentFirstResponder() -> UIResponder? {
    herdrFound = nil
    UIApplication.shared.sendAction(#selector(UIResponder.herdrCaptureFirstResponder), to: nil, from: nil, for: nil)
    return herdrFound
  }

  @objc private func herdrCaptureFirstResponder() {
    UIResponder.herdrFound = self
  }
}
