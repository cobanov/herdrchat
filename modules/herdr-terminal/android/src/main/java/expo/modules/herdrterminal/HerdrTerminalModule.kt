package expo.modules.herdrterminal

import android.util.Base64
import expo.modules.herdrshellregistry.ShellRegistry
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** The terminal's colours, `#RRGGBB` strings from the app's palette (`src/lib/terminal/theme.ts`). */
class TerminalThemeRecord : Record {
  @Field var background: String? = null
  @Field var foreground: String? = null
  @Field var cursor: String? = null
  @Field var selection: String? = null
  /** The 16 ANSI colours, normal then bright. Any other count is ignored. */
  @Field var ansi: List<String> = emptyList()
  @Field var dark: Boolean = true
}

class HerdrTerminalModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HerdrTerminal")

    // The Demo's recorded screens, into the view showing an echo shell. A
    // host's bytes never come this way: they go native to native.
    Function("feed") { shellId: String, base64: String ->
      val data = try {
        Base64.decode(base64, Base64.DEFAULT)
      } catch (error: IllegalArgumentException) {
        return@Function false
      }
      ShellRegistry.shared.deliver(shellId, data)
      true
    }

    View(HerdrTerminalView::class) {
      Events("onTitle", "onBell", "onSizeChange", "onFontSizeChange", "onModifiersReset")

      Prop("shellId") { view: HerdrTerminalView, shellId: String? -> view.bind(shellId) }
      Prop("theme") { view: HerdrTerminalView, theme: TerminalThemeRecord -> view.applyTheme(theme) }
      Prop("fontSize") { view: HerdrTerminalView, size: Double -> view.setFontSize(size.toFloat()) }
      Prop("minFontSize") { view: HerdrTerminalView, size: Double -> view.minFontSize = size.toFloat() }
      Prop("maxFontSize") { view: HerdrTerminalView, size: Double -> view.maxFontSize = size.toFloat() }
      // The accessory bar's sticky Ctrl and Alt, for the next typed key. The
      // view clears them once used and says so in `onModifiersReset`.
      Prop("controlModifier") { view: HerdrTerminalView, on: Boolean -> view.controlModifier = on }
      Prop("metaModifier") { view: HerdrTerminalView, on: Boolean -> view.metaModifier = on }

      AsyncFunction("focus") { view: HerdrTerminalView -> view.showKeyboard() }.runOnQueue(Queues.MAIN)
      AsyncFunction("blur") { view: HerdrTerminalView -> view.hideKeyboard() }.runOnQueue(Queues.MAIN)
      AsyncFunction("paste") { view: HerdrTerminalView -> view.paste() }.runOnQueue(Queues.MAIN)
      AsyncFunction("clearScrollback") { view: HerdrTerminalView -> view.clearScrollback() }.runOnQueue(Queues.MAIN)
    }
  }
}
