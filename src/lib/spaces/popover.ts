/** A rectangle in window points. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a floating card goes, in its host's own coordinates: `top` or `bottom` is set, never both. */
export interface Placement {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Where the layout card floats beside the button that showed it, inside the
 * host it is drawn in (the chats list): its right edge under the button's
 * right edge, kept `margin` inside the host, below the button when there is
 * at least as much room there as above it, else above. Its height is capped
 * at the room on that side.
 */
export function popoverPlacement(
  anchor: Frame,
  host: Frame,
  want: { width: number; maxHeight: number; margin: number; gap: number }
): Placement {
  const width = Math.max(0, Math.min(want.width, host.width - want.margin * 2));
  const anchorRight = anchor.x + anchor.width - host.x;
  const left = Math.max(want.margin, Math.min(anchorRight - width, host.width - want.margin - width));
  const anchorTop = anchor.y - host.y;
  const anchorBottom = anchorTop + anchor.height;
  const below = host.height - anchorBottom - want.gap - want.margin;
  const above = anchorTop - want.gap - want.margin;
  if (below >= above) {
    return { left, width, top: anchorBottom + want.gap, maxHeight: Math.max(0, Math.min(want.maxHeight, below)) };
  }
  return { left, width, bottom: host.height - anchorTop + want.gap, maxHeight: Math.max(0, Math.min(want.maxHeight, above)) };
}
