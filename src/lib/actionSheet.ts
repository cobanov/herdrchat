/**
 * The shape of an action sheet, worked out before any of it touches the screen.
 *
 * `ActionSheetIOS` takes a flat array of button titles plus separate indices
 * saying which one is Cancel and which are destructive. That is an API where
 * the ordering rule and the thing enforcing it live in different places: every
 * call site re-decides where Delete goes, then hand-counts its position, and a
 * later inserted action silently shifts the count.
 *
 * So the rule lives here instead, the indices are derived rather than written,
 * and the handlers come back index-aligned with the titles — which means the
 * component that shows the sheet does no arithmetic at all.
 */

export interface SheetAction {
  label: string;
  /**
   * Irreversible, or destructive on the host. Styled red by the platform and
   * moved below every safe action — see `buildSheet` for why that ordering is
   * the rule rather than a habit.
   */
  destructive?: boolean;
  onPress: () => void;
}

export interface SheetConfig {
  options: string[];
  /**
   * Index-aligned with `options`, so dispatching a tap is a lookup rather than
   * a calculation. The Cancel slot holds a no-op instead of being absent: a
   * hole in this array would make every consumer handle `undefined` for the one
   * index that is guaranteed to exist.
   */
  handlers: (() => void)[];
  /**
   * Always an array, even for one. `ActionSheetIOS` accepts `number | number[]`
   * and the array form costs nothing, whereas a union would make every consumer
   * narrow a value they only ever forward.
   */
  destructiveButtonIndices: number[];
  cancelButtonIndex: number;
}

/**
 * Order the actions and derive the indices.
 *
 * Three rules, in this order:
 *
 * 1. Safe actions keep the order they were given. Their sequence is a decision
 *    the call site made and this has no business rearranging it.
 * 2. Destructive actions move below every safe one. People scan a sheet top to
 *    bottom and commit before they finish reading; the cost of that landing on
 *    the wrong row is not symmetric, so the row that cannot be undone goes
 *    where a fast tap does not reach.
 * 3. Cancel is last. It is where the platform puts it and where a thumb rests.
 *
 * Multiple destructive actions are fine — "delete" and "block" on one object is
 * an ordinary sheet, and iOS takes a list of indices.
 */
export function buildSheet(
  actions: readonly SheetAction[],
  cancelLabel = 'Cancel'
): SheetConfig {
  const safe = actions.filter((action) => action.destructive !== true);
  const destructive = actions.filter((action) => action.destructive === true);
  const ordered = [...safe, ...destructive];

  return {
    options: [...ordered.map((action) => action.label), cancelLabel],
    // The no-op is the Cancel slot. Dismissing is the absence of an action, not
    // an action that does nothing in particular, but the array has to stay
    // aligned for the lookup to be a lookup.
    handlers: [...ordered.map((action) => action.onPress), () => {}],
    destructiveButtonIndices: destructive.map((_, offset) => safe.length + offset),
    cancelButtonIndex: ordered.length,
  };
}
