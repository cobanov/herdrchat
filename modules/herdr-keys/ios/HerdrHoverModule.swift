import ExpoModulesCore
import UIKit

/// A pointer resting on a view (a trackpad or mouse on iPad), for the layout
/// card a space card's button shows on hover.
///
/// Native, because React Native's own hover does not reach iOS in this build:
/// `Pressable`'s `onHoverIn` is wired only behind a feature flag that is off
/// (`shouldPressibilityUseW3CPointerEventsForHover`), and the pointer events a
/// `View` could take instead are dispatched only once
/// `RCTSetDispatchW3CPointerEvents(YES)` is called, which nothing does. A
/// hover recogniser on this view needs neither.
public class HerdrHoverModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdrHover")

    View(HoverView.self) {
      Events("onHoverChange")
    }
  }
}

/// Reports `{ over: true }` when a pointer comes onto it or any view inside
/// it, and `{ over: false }` when it leaves, once each. No delays here: the
/// JS side debounces, where the durations are tokens.
final class HoverView: ExpoView {
  let onHoverChange = EventDispatcher()
  private var over = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    let recognizer = UIHoverGestureRecognizer(target: self, action: #selector(hovered(_:)))
    // Hover is not a touch: it must never hold up the list's own gestures.
    recognizer.cancelsTouchesInView = false
    addGestureRecognizer(recognizer)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  @objc private func hovered(_ recognizer: UIHoverGestureRecognizer) {
    let now: Bool
    switch recognizer.state {
    case .began, .changed:
      now = true
    default:
      now = false
    }
    guard now != over else { return }
    over = now
    onHoverChange(["over": now])
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    // Unmounted under the pointer: the recogniser never ends, so say so.
    if window == nil && over {
      over = false
      onHoverChange(["over": false])
    }
  }
}
