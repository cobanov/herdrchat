import SwiftTerm
import UIKit

/// SwiftTerm's view, with a swipe that scrolls a program that asked for the
/// mouse, rather than dragging in it.
///
/// Both ways of attaching to a pane draw herdr's own client, which runs on the
/// alternate screen and turns mouse reporting on. SwiftTerm on iOS then turns
/// a one-finger pan into a button press, motion and release, and has no wheel
/// at all. So a swipe up to read what scrolled past reached herdr as a drag
/// (a selection, or a split moved), and the emulator's own scrollback stayed
/// empty, since nothing scrolls off an alternate screen. A two-finger pinch
/// to change the font size sent the same drag alongside it.
///
/// Here, while the program has the mouse, a vertical swipe sends wheel events
/// (buttons 64 and 65), one per row of travel, at the cell under the finger,
/// which is what a desktop terminal sends for a trackpad scroll: herdr scrolls
/// the pane's history, and a program in the pane that wants the wheel gets it.
/// Taps are still clicks. With the mouse off (a plain shell), the swipe is the
/// scroll view's, over SwiftTerm's own scrollback, as before.
final class PaneTerminalView: SwiftTerm.TerminalView {
  /// Wheel button numbers as `encodeButton` takes them (64 and 65 on the wire).
  private static let wheelUp = 4
  private static let wheelDown = 5

  private let wheel = UIPanGestureRecognizer()
  /// Travel not yet sent as a whole row.
  private var pendingTravel: CGFloat = 0

  override init(frame: CGRect) {
    super.init(frame: frame)
    installWheel()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    installWheel()
  }

  private func installWheel() {
    wheel.addTarget(self, action: #selector(wheeled(_:)))
    // One finger: two are the container's pinch, which never runs with it.
    wheel.maximumNumberOfTouches = 1
    addGestureRecognizer(wheel)
    // The scroll view's own pan waits for the wheel to decline, which it does
    // at once whenever the mouse is off.
    panGestureRecognizer.require(toFail: wheel)
  }

  /// The gesture that turns a swipe into wheel events, for the container to
  /// keep apart from its pinch.
  var wheelGesture: UIGestureRecognizer { wheel }

  /// Not SwiftTerm's: it adds the pan that drags with the mouse. The wheel
  /// above takes swipes instead, and checks the mode as each one begins.
  override func mouseModeChanged(source: Terminal) {}

  override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
    guard gestureRecognizer === wheel else { return super.gestureRecognizerShouldBegin(gestureRecognizer) }
    guard getTerminal().mouseMode != .off else { return false }
    let velocity = wheel.velocity(in: self)
    return abs(velocity.y) >= abs(velocity.x)
  }

  @objc private func wheeled(_ gesture: UIPanGestureRecognizer) {
    switch gesture.state {
    case .began:
      pendingTravel = 0
      gesture.setTranslation(.zero, in: self)
    case .changed:
      let terminal = getTerminal()
      guard terminal.mouseMode != .off, terminal.rows > 0, terminal.cols > 0 else { return }
      pendingTravel += gesture.translation(in: self).y
      gesture.setTranslation(.zero, in: self)
      let rowHeight = max(bounds.height / CGFloat(terminal.rows), 1)
      let colWidth = max(bounds.width / CGFloat(terminal.cols), 1)
      let point = gesture.location(in: self)
      let visibleY = point.y - contentOffset.y
      let col = min(max(Int(point.x / colWidth), 0), terminal.cols - 1)
      let row = min(max(Int(visibleY / rowHeight), 0), terminal.rows - 1)
      while abs(pendingTravel) >= rowHeight {
        // Natural scrolling, as on the rest of the phone: a finger moving
        // down brings earlier lines into view, which is the wheel going up.
        let down = pendingTravel < 0
        pendingTravel += down ? rowHeight : -rowHeight
        let flags = terminal.encodeButton(
          button: down ? Self.wheelDown : Self.wheelUp,
          release: false,
          shift: false,
          meta: false,
          control: false
        )
        terminal.sendEvent(buttonFlags: flags, x: col, y: row, pixelX: Int(point.x), pixelY: Int(visibleY))
      }
    default:
      pendingTravel = 0
    }
  }
}
