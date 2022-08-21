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

export function substringInArray(v: string[], target: string): undefined|{
  startIdx: number;
  endIdx: number
}
{
  // this is a prefix scan of `v`'s elements' lengths
  const cumLengths = v.map((s) => s.length)
                         .reduce((p, x) => p.concat(x + p[p.length - 1]), [0]);
  const haystack = v.join('');
  const match = haystack.indexOf(target);
  if (match >= 0) {
    const startIdx = cumLengths.indexOf(match);
    const endIdx = cumLengths.indexOf(match + target.length);
    if (startIdx >= 0 && endIdx >= 0) {
      return {startIdx, endIdx};
    }
  }
}
