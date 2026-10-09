import ExpoModulesCore
import UIKit

public class HerdrKeysModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdrKeys")

    View(SubmitShortcutView.self) {
      Events("onSubmitShortcut", "onNewlineShortcut")

      // Only while Return sends. Otherwise Return is already a newline and
      // the text view's own handling of Shift-Return is the right one.
      Prop("newlineShortcut") { (view: SubmitShortcutView, enabled: Bool) in
        view.newlineShortcutEnabled = enabled
      }
    }
  }
}

/// Offers Command-Return, and Shift-Return when asked, while anything inside
/// it has keyboard focus.
///
/// UIKit collects `keyCommands` from every responder between the first
/// responder and the window, and a view's next responder is its superview. So
/// with the composer's text view focused, this container is on that path and
/// its commands are live, without swizzling the text view or touching the app
/// delegate. Command-Return also shows in the list iPadOS draws while Command
/// is held.
///
/// Shift-Return exists because React Native cannot tell it from Return. With
/// `submitBehavior="submit"`, RN's `textView(_:shouldChangeTextIn:replacementText:)`
/// sees "\n" for both, fires `onSubmitEditing` and refuses the insertion. So the
/// command takes Shift-Return before the text view does and only reports it;
/// the newline is spliced into the draft in JS (`insertNewline`). Inserting it
/// here would go through that same delegate and be swallowed as a submit.
final class SubmitShortcutView: ExpoView {
  let onSubmitShortcut = EventDispatcher()
  let onNewlineShortcut = EventDispatcher()

  var newlineShortcutEnabled = false

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

  private lazy var newline: UIKeyCommand = {
    // No title: it is a plain typing key, not a shortcut worth listing.
    let command = UIKeyCommand(input: "\r", modifierFlags: .shift, action: #selector(newlineShortcut))
    command.wantsPriorityOverSystemBehavior = true
    return command
  }()

  override var keyCommands: [UIKeyCommand]? {
    newlineShortcutEnabled ? [submit, newline] : [submit]
  }

  @objc private func sendShortcut() {
    onSubmitShortcut([:])
  }

  @objc private func newlineShortcut() {
    onNewlineShortcut([:])
  }
}
