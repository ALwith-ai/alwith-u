/** Continue a title's numeric suffix, skipping names already owned by another chat. */
export function forkTitle(source: string, occupied: Iterable<string>): string {
  const used = new Set(occupied)
  used.add(source)
  const suffix = /^(.*?)\s*\((\d+)\)$/.exec(source)
  const base = suffix ? suffix[1].trimEnd() : source
  let count = suffix ? BigInt(suffix[2]) + 1n : 2n
  while (used.has(`${base} (${count})`)) count++
  return `${base} (${count})`
}
