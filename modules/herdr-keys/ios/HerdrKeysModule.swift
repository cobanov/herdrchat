import ExpoModulesCore
import UIKit

public class HerdrKeysModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdrKeys")

    View(SubmitShortcutView.self) {
      Events("onSubmitShortcut")
    }
  }
}

/// Offers Command-Return while anything inside it has keyboard focus.
///
/// UIKit collects `keyCommands` from every responder between the first
/// responder and the window, and a view's next responder is its superview. So
/// with the composer's text view focused, this container is on that path and
/// its command is live, without swizzling the text view or touching the app
/// delegate. It also shows in the list iPadOS draws while Command is held.
final class SubmitShortcutView: ExpoView {
  let onSubmitShortcut = EventDispatcher()

  private lazy var submit: UIKeyCommand = {
    let command = UIKeyCommand(
      title: "Send",
      action: #selector(sendShortcut),
      input: "\r",
      modifierFlags: .command
    )
    // A multiline text view would otherwise get first refusal on Return.
    command.wantsPriorityOverSystemBehavior = true
    return command
  }()

  override var keyCommands: [UIKeyCommand]? {
    [submit]
  }

  @objc private func sendShortcut() {
    onSubmitShortcut([:])
  }
}
