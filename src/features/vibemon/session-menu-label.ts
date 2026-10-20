/** Keep the native menu compact without splitting emoji or combining characters. */
export function fitSessionMenuLabel(label: string, measure: (text: string) => number, maxWidth = 300): string {
  if (measure(label) <= maxWidth) return label
  const parts = Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(label),
    (item) => item.segment
  )
  let low = 0
  let high = parts.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (measure(`${parts.slice(0, middle).join("")}…`) <= maxWidth) low = middle
    else high = middle - 1
  }
  return `${parts.slice(0, low).join("")}…`
}
