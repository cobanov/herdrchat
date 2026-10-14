import ExpoModulesCore
import UIKit

public class HerdrKeysModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdrKeys")

    View(SubmitShortcutView.self) {
      Events("onSubmitShortcut", "onReturnShortcut", "onNewlineShortcut", "onPasteShortcut")

      // Only while Return sends: plain Return from a hardware keyboard. The
      // software keyboard's Return is never a key command, so it stays the
      // text view's own newline.
      Prop("returnShortcut") { (view: SubmitShortcutView, enabled: Bool) in
        view.returnShortcutEnabled = enabled
      }

      // Shift-Return and Option-Return, also only while Return sends.
      // Otherwise Return is already a newline and the text view's own handling
      // of them is the right one.
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

/// Offers Command-Return, and Return, Shift-Return and Option-Return when
/// asked, while anything inside it has keyboard focus.
///
/// UIKit collects `keyCommands` from every responder between the first
/// responder and the window, and a view's next responder is its superview. So
/// with the composer's text view focused, this container is on that path and
/// its commands are live, without swizzling the text view or touching the app
/// delegate. Command-Return also shows in the list iPadOS draws while Command
/// is held.
///
/// Plain Return is a key command so that only a hardware keyboard sends with
/// it (#155). UIKit fires key commands for hardware keys only; the software
/// keyboard's Return goes straight to the text view, which keeps
/// `submitBehavior="newline"` and types a newline, so a phone can always write
/// a second line and never sends a half-written prompt on a stray Return.
///
/// Shift-Return and Option-Return are commands too while Return sends, so the
/// one table in `src/lib/composerKeys.ts` (`returnAction`) decides every
/// Return; they report which modifier was held and JS splices the newline into
/// the draft (`insertNewline`).
///
/// None of the Return commands is offered while the focused field has marked
/// text — a Chinese or Japanese candidate mid-composition. Key commands run
/// before the text system, so without that check Return would send instead of
/// committing the candidate, and Shift-Return would break the line under it.
///
/// Command-V exists because a plain text view pastes nothing when the
/// pasteboard holds only a picture. A command on this container is found
/// before the system's own Paste key equivalent, so it is offered only while
/// the pasteboard is a lone picture (`pasteAction` in `src/lib/composerKeys.ts`
/// is the same rule, and the one that is tested). With text on it, Command-V
/// never reaches this view and stays the system's own paste, prompt rules and
/// all. If the pasteboard changes between UIKit asking for `keyCommands` and
/// the key landing, the action hands anything but a lone picture to the first
/// responder's `paste(_:)`, which is the text view's — RN's override of it
/// marks the text as pasted, so a multi-line paste is not taken for a Return
/// that sends.
///
/// Checking the pasteboard here reads only its types (`hasImages`,
/// `hasStrings`), which raises no paste prompt. Attaching the picture does
/// not: JS reads it with expo-clipboard's `getImageAsync`, a programmatic read,
/// so iOS shows "Allow Paste" unless Settings > HerdrChat > Paste from Other
/// Apps is Allow — the same prompt the attach menu's "Paste Picture" raises.
final class SubmitShortcutView: ExpoView {
  let onSubmitShortcut = EventDispatcher()
  let onReturnShortcut = EventDispatcher()
  let onNewlineShortcut = EventDispatcher()
  let onPasteShortcut = EventDispatcher()

  var returnShortcutEnabled = false
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

  private lazy var plainReturn: UIKeyCommand = {
    // No title: it is a plain typing key, not a shortcut worth listing.
    let command = UIKeyCommand(input: "\r", modifierFlags: [], action: #selector(returnShortcut))
    command.wantsPriorityOverSystemBehavior = true
    return command
  }()

  private lazy var shiftReturn: UIKeyCommand = {
    let command = UIKeyCommand(input: "\r", modifierFlags: .shift, action: #selector(shiftNewlineShortcut))
    command.wantsPriorityOverSystemBehavior = true
    return command
  }()

  private lazy var optionReturn: UIKeyCommand = {
    let command = UIKeyCommand(input: "\r", modifierFlags: .alternate, action: #selector(optionNewlineShortcut))
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
    var commands: [UIKeyCommand] = []
    if !isComposing {
      commands.append(submit)
      if returnShortcutEnabled { commands.append(plainReturn) }
      if newlineShortcutEnabled { commands.append(contentsOf: [shiftReturn, optionReturn]) }
    }
    if pasteShortcutEnabled && Self.pasteboardIsLonePicture { commands.append(paste) }
    return commands
  }

  @objc private func sendShortcut() {
    onSubmitShortcut([:])
  }

  @objc private func returnShortcut() {
    onReturnShortcut([:])
  }

  @objc private func shiftNewlineShortcut() {
    onNewlineShortcut(["shift": true, "option": false])
  }

  @objc private func optionNewlineShortcut() {
    onNewlineShortcut(["shift": false, "option": true])
  }

  /// The focused field inside this view is mid-composition (marked text).
  private var isComposing: Bool {
    guard let field = Self.firstResponder(in: self) as? UITextInput else { return false }
    return field.markedTextRange != nil
  }

  private static func firstResponder(in view: UIView) -> UIView? {
    if view.isFirstResponder { return view }
    for subview in view.subviews {
      if let found = firstResponder(in: subview) { return found }
    }
    return nil
  }

  /// Types only, not contents: asking raises no paste prompt.
  private static var pasteboardIsLonePicture: Bool {
    let pasteboard = UIPasteboard.general
    return pasteboard.hasImages && !pasteboard.hasStrings
  }

  @objc private func pasteShortcut() {
    // Types only, as above. The attach that follows reads the picture itself
    // in JS, and that read may raise the system's "Allow Paste" prompt.
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
