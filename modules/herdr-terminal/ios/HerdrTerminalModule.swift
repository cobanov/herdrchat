import ExpoModulesCore
import HerdrShellRegistry
import UIKit

/// The terminal's colours, from the app's palette (`src/lib/terminal/theme.ts`).
struct TerminalThemeRecord: Record {
  @Field var background: UIColor? = nil
  @Field var foreground: UIColor? = nil
  @Field var cursor: UIColor? = nil
  @Field var selection: UIColor? = nil
  /// The 16 ANSI colours, normal then bright. Any other count is ignored.
  @Field var ansi: [UIColor] = []
  /// Picks the software keyboard's appearance.
  @Field var dark: Bool = true
}

public class HerdrTerminalModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdrTerminal")

    // The Demo's recorded screens, into the view showing an echo shell. A
    // host's bytes never come this way: they go native to native.
    Function("feed") { (shellId: String, base64: String) -> Bool in
      guard let data = Data(base64Encoded: base64) else { return false }
      ShellRegistry.shared.deliver(shellId, data)
      return true
    }

    View(HerdrTerminalView.self) {
      Events("onTitle", "onBell", "onSizeChange", "onFontSizeChange", "onModifiersReset")

      Prop("shellId") { (view: HerdrTerminalView, shellId: String?) in
        view.bind(shellId)
      }

      Prop("theme") { (view: HerdrTerminalView, theme: TerminalThemeRecord) in
        view.apply(theme)
      }

      Prop("fontSize") { (view: HerdrTerminalView, size: Double) in
        view.setFontSize(CGFloat(size))
      }

      Prop("minFontSize") { (view: HerdrTerminalView, size: Double) in
        view.minFontSize = CGFloat(size)
      }

      Prop("maxFontSize") { (view: HerdrTerminalView, size: Double) in
        view.maxFontSize = CGFloat(size)
      }

      // The accessory bar's sticky Ctrl and Alt, for the next key typed on
      // the software keyboard. The view clears them once used and says so in
      // `onModifiersReset`.
      Prop("controlModifier") { (view: HerdrTerminalView, on: Bool) in
        view.terminal.controlModifier = on
      }

      Prop("metaModifier") { (view: HerdrTerminalView, on: Bool) in
        view.terminal.metaModifier = on
      }

      AsyncFunction("focus") { (view: HerdrTerminalView) in
        _ = view.terminal.becomeFirstResponder()
      }.runOnQueue(.main)

      AsyncFunction("blur") { (view: HerdrTerminalView) in
        _ = view.terminal.resignFirstResponder()
      }.runOnQueue(.main)

      // The pasteboard's text, bracketed when the program asked for that.
      // Reading it may raise the system's "Allow Paste" prompt.
      AsyncFunction("paste") { (view: HerdrTerminalView) in
        view.terminal.paste(nil)
      }.runOnQueue(.main)

      AsyncFunction("clearScrollback") { (view: HerdrTerminalView) in
        view.terminal.clearScrollback()
      }.runOnQueue(.main)
    }
  }
}
