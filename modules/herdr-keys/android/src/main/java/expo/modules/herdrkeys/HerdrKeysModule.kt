package expo.modules.herdrkeys

import android.content.ClipboardManager
import android.content.Context
import android.view.KeyEvent
import android.view.inputmethod.BaseInputConnection
import android.widget.EditText
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class HerdrKeysModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HerdrKeys")

    View(SubmitShortcutView::class) {
      Events("onSubmitShortcut", "onReturnShortcut", "onNewlineShortcut", "onPasteShortcut")
      Prop("returnShortcut") { view: SubmitShortcutView, on: Boolean -> view.returnShortcutEnabled = on }
      Prop("newlineShortcut") { view: SubmitShortcutView, on: Boolean -> view.newlineShortcutEnabled = on }
      Prop("pasteShortcut") { view: SubmitShortcutView, on: Boolean -> view.pasteShortcutEnabled = on }
    }
  }
}

/**
 * The composer's hardware-keyboard shortcuts on Android, the twin of iOS's
 * key commands: Ctrl-Return (or Meta-Return) sends, and optionally Return
 * sends, Shift- or Alt-Return is a newline, and Ctrl-V with a lone picture
 * attaches it.
 *
 * Key events reach the focused text field through its parents, so this
 * container sees them first and takes the ones it answers, down and up both.
 * A software keyboard's keys are never taken: an IME marks its events
 * FLAG_SOFT_KEYBOARD, and its Return stays the field's newline, as on iOS.
 */
class SubmitShortcutView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onSubmitShortcut by EventDispatcher()
  private val onReturnShortcut by EventDispatcher()
  private val onNewlineShortcut by EventDispatcher()
  private val onPasteShortcut by EventDispatcher()

  var returnShortcutEnabled = false
  var newlineShortcutEnabled = false
  var pasteShortcutEnabled = false

  override fun dispatchKeyEvent(event: KeyEvent): Boolean =
    take(event) || super.dispatchKeyEvent(event)

  private fun take(event: KeyEvent): Boolean {
    if ((event.flags and KeyEvent.FLAG_SOFT_KEYBOARD) != 0) return false
    // Mid-composition (a Japanese candidate underlined), Return is the input method's.
    val field = findFocus() as? EditText
    if (field != null && BaseInputConnection.getComposingSpanStart(field.text) >= 0) return false
    val command = event.isCtrlPressed || event.isMetaPressed
    val press = event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0
    when (event.keyCode) {
      KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
        val shift = event.isShiftPressed
        val alt = event.isAltPressed
        when {
          command -> if (press) onSubmitShortcut(mapOf())
          (shift || alt) && newlineShortcutEnabled -> if (press) onNewlineShortcut(mapOf("shift" to shift, "option" to alt))
          !shift && !alt && returnShortcutEnabled -> if (press) onReturnShortcut(mapOf())
          else -> return false
        }
        return true
      }
      KeyEvent.KEYCODE_V -> {
        if (!command || !pasteShortcutEnabled) return false
        val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClipDescription
        val hasImage = clip?.hasMimeType("image/*") == true
        val hasText = clip?.hasMimeType("text/*") == true
        // Any paste with text in it is still the field's own.
        if (!hasImage || hasText) return false
        if (press) onPasteShortcut(mapOf("hasImage" to hasImage, "hasText" to hasText))
        return true
      }
    }
    return false
  }
}
