/**
 * `next`, but with every element equal to last time's (as JSON) replaced by
 * last time's object, and `previous` itself when nothing changed. A poll that
 * rebuilt the same rows gave every one a new object, and every row, and the
 * list holding them, rendered again. For plain data only.
 */
export function keepUnchanged<T>(previous: T[], next: T[], key: (item: T) => string): T[] {
  const before = new Map(previous.map((item) => [key(item), item]));
  let changed = previous.length !== next.length;
  const kept = next.map((item, index) => {
    const old = before.get(key(item));
    if (old !== undefined && JSON.stringify(old) === JSON.stringify(item)) {
      if (previous[index] !== old) changed = true;
      return old;
    }
    changed = true;
    return item;
  });
  return changed ? kept : previous;
}
