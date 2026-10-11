/** A rectangle in window points. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a floating card goes, in window points: `top` or `bottom` is set, never both. */
export interface Placement {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Where the layout card floats for the button that showed it. It is drawn
 * over the whole window (`LayoutPeekOverlay`), so it can leave the column of
 * chats it came from.
 *
 * Beside the column when the window has room for it there (iPad's sidebar
 * with a thread beside it): its left edge `margin` past the column's right
 * edge, its top level with the button's top when there is at least as much
 * room below the button as above it, else its bottom level with the button's
 * bottom. The rows below stay uncovered, so the pointer can go on to the next
 * card's button.
 *
 * Inside the column otherwise (the list is the whole window): its right edge
 * under the button's right edge, kept `margin` inside the column, below the
 * button or above it as before. Its height is capped at the room on its side.
 */
export function popoverPlacement(
  anchor: Frame,
  column: Frame,
  window: Frame,
  want: { width: number; maxHeight: number; margin: number; gap: number }
): Placement {
  const windowBottom = window.y + window.height;
  const columnRight = column.x + column.width;
  const anchorBottom = anchor.y + anchor.height;
  if (window.x + window.width - columnRight - want.margin * 2 >= want.width) {
    const below = windowBottom - anchor.y - want.margin;
    const above = anchorBottom - window.y - want.margin;
    const left = columnRight + want.margin;
    if (below >= above) {
      return { left, width: want.width, top: anchor.y, maxHeight: Math.max(0, Math.min(want.maxHeight, below)) };
    }
    return { left, width: want.width, bottom: windowBottom - anchorBottom, maxHeight: Math.max(0, Math.min(want.maxHeight, above)) };
  }
  const width = Math.max(0, Math.min(want.width, column.width - want.margin * 2));
  const left = Math.max(column.x + want.margin, Math.min(anchor.x + anchor.width - width, columnRight - want.margin - width));
  const below = column.y + column.height - anchorBottom - want.gap - want.margin;
  const above = anchor.y - column.y - want.gap - want.margin;
  if (below >= above) {
    return { left, width, top: anchorBottom + want.gap, maxHeight: Math.max(0, Math.min(want.maxHeight, below)) };
  }
  return { left, width, bottom: windowBottom - anchor.y + want.gap, maxHeight: Math.max(0, Math.min(want.maxHeight, above)) };
}
