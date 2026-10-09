import ExpoModulesCore
import UIKit

public class HerdrKeysModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdrKeys")

    View(SubmitShortcutView.self) {
      Events("onSubmitShortcut", "onNewlineShortcut", "onPasteShortcut")

      // Only while Return sends. Otherwise Return is already a newline and
      // the text view's own handling of Shift-Return is the right one.
      Prop("newlineShortcut") { (view: SubmitShortcutView, enabled: Bool) in
        view.newlineShortcutEnabled = enabled
      }

      // Only while the composer can take another picture. Otherwise Command-V
      // is left entirely to the text view.
      Prop("pasteShortcut") { (view: SubmitShortcutView, enabled: Bool) in
        view.pasteShortcutEnabled = enabled
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
///
/// Command-V exists because a plain text view pastes nothing when the
/// pasteboard holds only a picture. A command on this container is found
/// before the system's own Paste key equivalent, so it takes every Command-V;
/// it keeps only the one that is a lone picture (`pasteAction` in
/// `src/lib/composerKeys.ts` is the same rule, and the one that is tested) and
/// hands the rest to the first responder's `paste(_:)`, which is the text
/// view's — RN's override of it marks the text as pasted, so a multi-line paste
/// is not taken for a Return that sends.
final class SubmitShortcutView: ExpoView {
  let onSubmitShortcut = EventDispatcher()
  let onNewlineShortcut = EventDispatcher()
  let onPasteShortcut = EventDispatcher()

  var newlineShortcutEnabled = false
  var pasteShortcutEnabled = false

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

  private lazy var paste: UIKeyCommand = {
    // No title: Paste is already listed under Edit while Command is held.
    let command = UIKeyCommand(input: "v", modifierFlags: .command, action: #selector(pasteShortcut))
    command.wantsPriorityOverSystemBehavior = true
    return command
  }()

  override var keyCommands: [UIKeyCommand]? {
    var commands = [submit]
    if newlineShortcutEnabled { commands.append(newline) }
    if pasteShortcutEnabled { commands.append(paste) }
    return commands
  }

  @objc private func sendShortcut() {
    onSubmitShortcut([:])
  }

  @objc private func newlineShortcut() {
    onNewlineShortcut([:])
  }

  @objc private func pasteShortcut() {
    // `hasImages` and `hasStrings` read the pasteboard's types, not its
    // contents, so asking does not raise the paste-permission prompt.
    let pasteboard = UIPasteboard.general
    let hasImage = pasteboard.hasImages
    let hasText = pasteboard.hasStrings
    if hasImage && !hasText {
      onPasteShortcut(["hasImage": hasImage, "hasText": hasText])
      return
    }
    // Text, or nothing usable: the paste the field would have done anyway.
    UIApplication.shared.sendAction(
      #selector(UIResponderStandardEditActions.paste(_:)),
      to: nil,
      from: self,
      for: nil
    )
  }
}
