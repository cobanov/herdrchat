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
/// responder while active (which takes focus from a text field, as a sheet
/// would) and gives it back when it stops being active or leaves the window.
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
        self.becomeFirstResponder()
      }
    } else if isFirstResponder {
      resignFirstResponder()
    }
  }

  @objc private func escapePressed() {
    onEscape([:])
  }
}
