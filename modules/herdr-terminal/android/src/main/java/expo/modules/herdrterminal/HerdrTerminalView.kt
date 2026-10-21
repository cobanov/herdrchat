package expo.modules.herdrterminal

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import android.text.InputType
import android.view.ActionMode
import android.view.GestureDetector
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import com.termux.terminal.KeyHandler
import com.termux.terminal.TerminalColors
import com.termux.terminal.TerminalEmulator
import com.termux.terminal.TerminalOutput
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import com.termux.terminal.TextStyle
import com.termux.view.TerminalRenderer
import expo.modules.herdrshellregistry.ShellRegistry
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.UUID
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.roundToInt

/**
 * A herdr pane's terminal on Android: Termux's emulator and renderer, fed by
 * a shell in `ShellRegistry`, the twin of `ios/HerdrTerminalView.swift`.
 *
 * Termux's own `TerminalView` is not used: it is final and drives a
 * `TerminalSession`, which forks a local process. The emulator takes any
 * `TerminalOutput`, so this view owns one, draws it with `TerminalRenderer`,
 * and does the input itself. The bytes stay native both ways; JavaScript sees
 * the title, the bell, the size in cells and the font size.
 *
 * A swipe scrolls the program when it has the mouse (wheel events, one per
 * row, as on iOS: herdr's attach always has it), and the emulator's own
 * scrollback otherwise. The first tap shows the keyboard; later ones are
 * clicks while the program has the mouse. A long press starts a selection,
 * dragging moves its end, and lifting offers Copy.
 */
class HerdrTerminalView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onTitle by EventDispatcher()
  private val onBell by EventDispatcher()
  private val onSizeChange by EventDispatcher()
  private val onFontSizeChange by EventDispatcher()
  private val onModifiersReset by EventDispatcher()

  var minFontSize = 8f
  var maxFontSize = 28f
  var controlModifier = false
  var metaModifier = false

  private var fontSize = 13f
  private var renderer = TerminalRenderer(pixels(fontSize), Typeface.MONOSPACE)
  /** Termux's renderer keeps this private; the last row needs it to fit. */
  private var lineSpacingAndAscent = lineSpacingAndAscent()
  private var background = Color.BLACK

  private var shellId: String? = null
  private var token: UUID? = null
  private var reportedSize: Pair<Int, Int>? = null
  /** Rows scrolled back into the scrollback: 0 at the end, negative above it. */
  private var topRow = 0
  /** Swipe travel not yet sent as a whole row. */
  private var pendingTravel = 0f
  /** A hardware keyboard's dead key (an accent) waiting for its letter. */
  private var combiningAccent = 0
  /** The selection's ends as (column, row), rows counted as the renderer does (scrollback negative); null when none. */
  private var selectionStart: Pair<Int, Int>? = null
  private var selectionEnd: Pair<Int, Int>? = null
  private var copyMenu: ActionMode? = null

  private val output = object : TerminalOutput() {
    override fun write(data: ByteArray, offset: Int, count: Int) {
      val id = shellId ?: return
      ShellRegistry.shared.send(id, data.copyOfRange(offset, offset + count))
    }

    override fun titleChanged(oldTitle: String?, newTitle: String?) {
      onTitle(mapOf("title" to (newTitle ?: "")))
    }

    /** OSC 52 from the program (a copy in herdr, vim, tmux): onto the clipboard. */
    override fun onCopyTextToClipboard(text: String) {
      clipboard().setPrimaryClip(ClipData.newPlainText("Terminal", text))
    }

    /** Refused: it would read whatever the person last copied, anywhere, without their knowing. */
    override fun onPasteTextFromClipboard() {}

    override fun onBell() {
      this@HerdrTerminalView.onBell(mapOf())
    }

    override fun onColorsChanged() = invalidate()
  }

  private val emulator = TerminalEmulator(output, 80, 24, null, QuietClient)

  init {
    setWillNotDraw(false)
    isFocusable = true
    isFocusableInTouchMode = true
  }

  // The shell

  fun bind(newId: String?) {
    if (newId == shellId) return
    detachShell()
    shellId = newId
    if (isAttachedToWindow) attachShell()
    // A shell opened before the last layout gets the size the view has now.
    val size = reportedSize
    if (newId != null && size != null) ShellRegistry.shared.resize(newId, size.first, size.second)
  }

  private fun attachShell() {
    val id = shellId ?: return
    if (token != null) return
    token = ShellRegistry.shared.attach(id) { data ->
      emulator.append(data, data.size)
      screenUpdated()
    }
  }

  private fun detachShell() {
    val id = shellId ?: return
    token?.let { ShellRegistry.shared.detach(id, it) }
    token = null
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attachShell()
  }

  override fun onDetachedFromWindow() {
    detachShell()
    super.onDetachedFromWindow()
  }

  /** New output: back to the end, as a terminal does, unless a selection is open; then it stays on its text. */
  private fun screenUpdated() {
    val scrolled = emulator.scrollCounter
    if (selectionStart != null) {
      selectionStart = selectionStart?.let { it.first to it.second - scrolled }
      selectionEnd = selectionEnd?.let { it.first to it.second - scrolled }
      topRow = (topRow - scrolled).coerceAtLeast(-emulator.screen.activeTranscriptRows)
    } else {
      topRow = 0
    }
    emulator.clearScrollCounter()
    invalidate()
  }

  // Size and look

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    updateSize()
  }

  /**
   * Reported, not sent: the host's pane is resized from JS once the size holds
   * still (`useTerminalShell`), so the keyboard's animation sends one resize
   * rather than one a frame. A shell bound later is sized in `bind`.
   */
  private fun updateSize() {
    if (width <= 0 || height <= 0) return
    val cols = maxOf(4, (width / renderer.fontWidth).toInt())
    val rows = maxOf(4, (height - lineSpacingAndAscent) / renderer.fontLineSpacing)
    if (cols != emulator.mColumns || rows != emulator.mRows) {
      emulator.resize(cols, rows)
      topRow = 0
      invalidate()
    }
    if (reportedSize != cols to rows) {
      reportedSize = cols to rows
      onSizeChange(mapOf("cols" to cols, "rows" to rows))
    }
  }

  fun setFontSize(size: Float) {
    val clamped = size.coerceIn(minFontSize, maxFontSize)
    if (clamped == fontSize) return
    fontSize = clamped
    renderer = TerminalRenderer(pixels(clamped), Typeface.MONOSPACE)
    lineSpacingAndAscent = lineSpacingAndAscent()
    updateSize()
    invalidate()
  }

  /**
   * The palette goes into Termux's default scheme, which the emulator returns
   * to on a reset (a program's `ESC c`), not only into the live colours.
   * Shared by every terminal, and every terminal shows the app's one theme.
   */
  fun applyTheme(theme: TerminalThemeRecord) {
    val colors = TerminalColors.COLOR_SCHEME.mDefaultColors
    if (theme.ansi.size == 16) theme.ansi.forEachIndexed { index, value -> parse(value)?.let { colors[index] = it } }
    parse(theme.foreground)?.let { colors[TextStyle.COLOR_INDEX_FOREGROUND] = it }
    parse(theme.background)?.let {
      colors[TextStyle.COLOR_INDEX_BACKGROUND] = it
      background = it
    }
    parse(theme.cursor)?.let { colors[TextStyle.COLOR_INDEX_CURSOR] = it }
    emulator.mColors.reset()
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    // React Native's views do not clip their children, so without this the
    // background filled the parent too and covered the screen's header.
    canvas.clipRect(0, 0, width, height)
    canvas.drawColor(background)
    val (from, to) = orderedSelection() ?: ((-1 to -1) to (-1 to -1))
    // Termux's renderer draws a selection in reverse video, so the theme's `selection` colour is not used.
    renderer.render(emulator, canvas, topRow, from.second, to.second, from.first, to.first)
  }

  // Selection

  private fun orderedSelection(): Pair<Pair<Int, Int>, Pair<Int, Int>>? {
    val start = selectionStart ?: return null
    val end = selectionEnd ?: return null
    val startFirst = start.second < end.second || (start.second == end.second && start.first <= end.first)
    return if (startFirst) start to end else end to start
  }

  private fun startSelection(event: MotionEvent) {
    val cell = cellAt(event, scrolled = true)
    selectionStart = cell
    selectionEnd = cell
    performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
    invalidate()
  }

  private fun showCopyMenu() {
    copyMenu?.finish()
    copyMenu = startActionMode(object : ActionMode.Callback2() {
      override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
        menu.add(Menu.NONE, android.R.id.copy, 0, android.R.string.copy)
        return true
      }

      override fun onPrepareActionMode(mode: ActionMode, menu: Menu) = false

      override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
        val (from, to) = orderedSelection() ?: return false
        val text = emulator.getSelectedText(from.first, from.second, to.first, to.second)
        clipboard().setPrimaryClip(ClipData.newPlainText("Terminal", text))
        mode.finish()
        return true
      }

      override fun onDestroyActionMode(mode: ActionMode) {
        copyMenu = null
        clearSelection()
      }

      override fun onGetContentRect(mode: ActionMode, view: android.view.View, outRect: Rect) {
        val (from, to) = orderedSelection() ?: return
        val spacing = renderer.fontLineSpacing
        outRect.set(0, (from.second - topRow) * spacing, width, (to.second - topRow + 1) * spacing + lineSpacingAndAscent)
      }
    }, ActionMode.TYPE_FLOATING)
  }

  private fun clearSelection() {
    if (selectionStart == null) return
    selectionStart = null
    selectionEnd = null
    invalidate()
  }

  // Calls from JavaScript

  fun showKeyboard() {
    requestFocus()
    inputMethods().showSoftInput(this, InputMethodManager.SHOW_IMPLICIT)
  }

  fun hideKeyboard() {
    inputMethods().hideSoftInputFromWindow(windowToken, 0)
    clearFocus()
  }

  /** The clipboard's text, bracketed when the program asked for that. */
  fun paste() {
    val text = clipboard().primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)
    if (text.isNullOrEmpty()) return
    topRow = 0
    emulator.paste(text.toString())
  }

  fun clearScrollback() {
    clearSelection()
    emulator.screen.clearTranscript()
    topRow = 0
    invalidate()
  }

  // Typing

  override fun onCheckIsTextEditor() = true

  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection {
    // TYPE_NULL: keys, not words. No suggestions, no autocorrect rewriting
    // what was already sent, and most keyboards send key events for it.
    outAttrs.inputType = InputType.TYPE_NULL
    outAttrs.imeOptions = EditorInfo.IME_FLAG_NO_FULLSCREEN
    return object : BaseInputConnection(this, true) {
      override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
        super.commitText(text, newCursorPosition)
        flush()
        return true
      }

      override fun finishComposingText(): Boolean {
        super.finishComposingText()
        flush()
        return true
      }

      override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
        // Some keyboards (Samsung's, with spell check) delete more than one.
        repeat(beforeLength) { sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DEL)) }
        return super.deleteSurroundingText(beforeLength, afterLength)
      }

      private fun flush() {
        val content = editable ?: return
        sendText(content)
        content.clear()
      }
    }
  }

  /** Text from the keyboard, as Termux reads it: a newline is Return, a control character is Ctrl and its letter. */
  private fun sendText(text: CharSequence) {
    var index = 0
    while (index < text.length) {
      var codePoint = Character.codePointAt(text, index)
      index += Character.charCount(codePoint)
      var control = false
      if (codePoint <= 31 && codePoint != 27) {
        if (codePoint == '\n'.code) codePoint = '\r'.code
        control = true
        codePoint = when (codePoint) {
          31 -> '_'.code
          30 -> '^'.code
          29 -> ']'.code
          28 -> '\\'.code
          else -> codePoint + 96
        }
      }
      inputCodePoint(codePoint, control, false)
    }
  }

  private fun inputCodePoint(codePoint: Int, controlFromEvent: Boolean, altFromEvent: Boolean) {
    val control = controlFromEvent || controlModifier
    val alt = altFromEvent || metaModifier
    var code = codePoint
    if (control) {
      code = when (code) {
        in 'a'.code..'z'.code -> code - 'a'.code + 1
        in 'A'.code..'Z'.code -> code - 'A'.code + 1
        ' '.code, '2'.code -> 0
        '['.code, '3'.code -> 27
        '\\'.code, '4'.code -> 28
        ']'.code, '5'.code -> 29
        '^'.code, '6'.code -> 30
        '_'.code, '7'.code, '/'.code -> 31
        '8'.code -> 127
        else -> code
      }
    }
    resetModifiers()
    topRow = 0
    // Alt as Meta: Esc before the character, for readline's Alt-B and Alt-F.
    output.write((if (alt) "\u001b" else "") + String(Character.toChars(code)))
  }

  private fun resetModifiers() {
    if (!controlModifier && !metaModifier) return
    controlModifier = false
    metaModifier = false
    onModifiersReset(mapOf("control" to false, "meta" to false))
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    // Back, volume and the like stay the system's.
    if (event.isSystem) return super.onKeyDown(keyCode, event)
    copyMenu?.finish()
    // Meta-K clears the scrollback, as Command-K does on iOS.
    if (keyCode == KeyEvent.KEYCODE_K && event.isMetaPressed) {
      clearScrollback()
      return true
    }
    if (event.action == KeyEvent.ACTION_MULTIPLE && keyCode == KeyEvent.KEYCODE_UNKNOWN) {
      output.write(event.characters)
      return true
    }
    val meta = event.metaState
    val control = event.isCtrlPressed || controlModifier
    val leftAlt = (meta and KeyEvent.META_ALT_LEFT_ON) != 0 || metaModifier
    var keyMod = 0
    if (control) keyMod = keyMod or KeyHandler.KEYMOD_CTRL
    if (event.isAltPressed || leftAlt) keyMod = keyMod or KeyHandler.KEYMOD_ALT
    if (event.isShiftPressed) keyMod = keyMod or KeyHandler.KEYMOD_SHIFT
    if (event.isNumLockOn) keyMod = keyMod or KeyHandler.KEYMOD_NUM_LOCK
    if (!event.isFunctionPressed) {
      val code = KeyHandler.getCode(keyCode, keyMod, emulator.isCursorKeysApplicationMode, emulator.isKeypadApplicationMode)
      if (code != null) {
        resetModifiers()
        topRow = 0
        output.write(code)
        return true
      }
    }
    // Ctrl is applied by inputCodePoint; left Alt is sent as Esc. Right Alt
    // (AltGr) stays, to compose characters.
    var clear = KeyEvent.META_CTRL_MASK
    if ((meta and KeyEvent.META_ALT_RIGHT_ON) == 0) clear = clear or KeyEvent.META_ALT_ON or KeyEvent.META_ALT_LEFT_ON
    var char = event.getUnicodeChar(meta and clear.inv())
    if (char == 0) return false
    // A dead key (an accent) waits for the next letter and combines with it, as Termux does.
    if ((char and KeyCharacterMap.COMBINING_ACCENT) != 0) {
      if (combiningAccent != 0) inputCodePoint(combiningAccent, control, leftAlt)
      combiningAccent = char and KeyCharacterMap.COMBINING_ACCENT_MASK
      return true
    }
    if (combiningAccent != 0) {
      val combined = KeyCharacterMap.getDeadChar(combiningAccent, char)
      if (combined > 0) char = combined
      combiningAccent = 0
    }
    inputCodePoint(char, control, leftAlt)
    return true
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean =
    if (event.isSystem) super.onKeyUp(keyCode, event) else true

  // Touch

  private val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
    override fun onDown(e: MotionEvent): Boolean {
      pendingTravel = 0f
      return true
    }

    override fun onLongPress(e: MotionEvent) {
      if (!scale.isInProgress) startSelection(e)
    }

    override fun onSingleTapUp(e: MotionEvent): Boolean {
      if (selectionStart != null) {
        copyMenu?.finish()
        clearSelection()
        return true
      }
      if (!hasFocus() || !emulator.isMouseTrackingActive) {
        showKeyboard()
        return true
      }
      val (col, row) = mouseCellAt(e)
      emulator.sendMouseEvent(TerminalEmulator.MOUSE_LEFT_BUTTON, col, row, true)
      emulator.sendMouseEvent(TerminalEmulator.MOUSE_LEFT_BUTTON, col, row, false)
      return true
    }

    override fun onScroll(e1: MotionEvent?, e2: MotionEvent, distanceX: Float, distanceY: Float): Boolean {
      if (scale.isInProgress) return true
      parent?.requestDisallowInterceptTouchEvent(true)
      // Natural scrolling: a finger moving down brings earlier lines into view.
      pendingTravel -= distanceY
      val rowHeight = renderer.fontLineSpacing.toFloat()
      while (abs(pendingTravel) >= rowHeight) {
        val earlier = pendingTravel > 0
        pendingTravel += if (earlier) -rowHeight else rowHeight
        scrollOneRow(earlier, e2)
      }
      return true
    }
  })

  private var pinchStartSize = fontSize
  private var pinchScale = 1f

  private val scale = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
    override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
      pinchStartSize = fontSize
      pinchScale = 1f
      return true
    }

    override fun onScale(detector: ScaleGestureDetector): Boolean {
      pinchScale *= detector.scaleFactor
      setFontSize((pinchStartSize * pinchScale).roundToInt().toFloat())
      return true
    }

    override fun onScaleEnd(detector: ScaleGestureDetector) {
      onFontSizeChange(mapOf("fontSize" to fontSize.toDouble()))
    }
  })

  override fun onTouchEvent(event: MotionEvent): Boolean {
    // After a long press the finger drags the selection's end; GestureDetector reports no scroll then.
    if (selectionStart != null && copyMenu == null) {
      when (event.actionMasked) {
        MotionEvent.ACTION_MOVE -> {
          parent?.requestDisallowInterceptTouchEvent(true)
          selectionEnd = cellAt(event, scrolled = true)
          invalidate()
          return true
        }
        MotionEvent.ACTION_UP -> {
          showCopyMenu()
          return true
        }
      }
    }
    scale.onTouchEvent(event)
    gestures.onTouchEvent(event)
    return true
  }

  /** A mouse wheel or a trackpad's two-finger scroll: three rows a notch, as Termux does. */
  override fun onGenericMotionEvent(event: MotionEvent): Boolean {
    if (!event.isFromSource(InputDevice.SOURCE_CLASS_POINTER) || event.actionMasked != MotionEvent.ACTION_SCROLL) {
      return super.onGenericMotionEvent(event)
    }
    val earlier = event.getAxisValue(MotionEvent.AXIS_VSCROLL) > 0f
    repeat(3) { scrollOneRow(earlier, event) }
    return true
  }

  private fun scrollOneRow(earlier: Boolean, event: MotionEvent) {
    if (emulator.isMouseTrackingActive) {
      val (col, row) = mouseCellAt(event)
      val button = if (earlier) TerminalEmulator.MOUSE_WHEELUP_BUTTON else TerminalEmulator.MOUSE_WHEELDOWN_BUTTON
      emulator.sendMouseEvent(button, col, row, true)
    } else {
      val history = emulator.screen.activeTranscriptRows
      topRow = (topRow + if (earlier) -1 else 1).coerceIn(-history, 0)
      invalidate()
    }
  }

  /** The cell under a touch, 0-based; with `scrolled`, its row counts the scrollback the view shows. */
  private fun cellAt(event: MotionEvent, scrolled: Boolean = false): Pair<Int, Int> {
    val col = (event.x / renderer.fontWidth).toInt().coerceIn(0, emulator.mColumns - 1)
    val row = ((event.y - lineSpacingAndAscent) / renderer.fontLineSpacing).toInt().coerceIn(0, emulator.mRows - 1)
    return col to if (scrolled) row + topRow else row
  }

  /** The same, 1-based, as mouse reports are. */
  private fun mouseCellAt(event: MotionEvent): Pair<Int, Int> {
    val (col, row) = cellAt(event)
    return col + 1 to row + 1
  }

  // Helpers

  private fun pixels(points: Float) = (points * resources.displayMetrics.density).roundToInt()

  private fun lineSpacingAndAscent(): Int {
    val paint = Paint().apply {
      typeface = Typeface.MONOSPACE
      textSize = pixels(fontSize).toFloat()
    }
    return renderer.fontLineSpacing + ceil(paint.ascent()).toInt()
  }

  private fun clipboard() = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

  private fun inputMethods() = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager

  private fun parse(value: String?): Int? = value?.let { runCatching { Color.parseColor(it) }.getOrNull() }
}

/** The emulator asks its session's client for a cursor style and logs through it; there is no session here. */
private object QuietClient : TerminalSessionClient {
  override fun onTextChanged(changedSession: TerminalSession) {}
  override fun onTitleChanged(changedSession: TerminalSession) {}
  override fun onSessionFinished(finishedSession: TerminalSession) {}
  override fun onCopyTextToClipboard(session: TerminalSession, text: String?) {}
  override fun onPasteTextFromClipboard(session: TerminalSession?) {}
  override fun onBell(session: TerminalSession) {}
  override fun onColorsChanged(session: TerminalSession) {}
  override fun onTerminalCursorStateChange(state: Boolean) {}
  override fun getTerminalCursorStyle(): Int? = null
  override fun logError(tag: String?, message: String?) {}
  override fun logWarn(tag: String?, message: String?) {}
  override fun logInfo(tag: String?, message: String?) {}
  override fun logDebug(tag: String?, message: String?) {}
  override fun logVerbose(tag: String?, message: String?) {}
  override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {}
  override fun logStackTrace(tag: String?, e: Exception?) {}
}
