// from curtiz-utils

export function groupBy<T, U>(arr: T[], f: (x: T) => U): Map<U, T[]> {
  const ret: Map<U, T[]> = new Map();
  for (const x of arr) {
    const y = f(x);
    const hit = ret.get(y);
    if (hit) {
      hit.push(x);
    } else {
      ret.set(y, [x]);
    }
  }
  return ret;
}
