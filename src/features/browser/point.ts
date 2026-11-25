/** What the page answers about a point: where the thing there is, and what a person would call it. */
export interface Pointed {
  /** Left, top, width and height, as fractions of the page's visible area. */
  rect: [number, number, number, number]
  kind: string
  name: string
  text: string
  around: string
  /** A CSS selector that matches only this thing, or nothing when there is none. */
  selector: string
  /** The paragraph, list item or table cell the thing is part of, as the page shows it. */
  block: string
}

/** The words a person would know the thing by: its label, or what it says. */
export function pointedWords({ name, text }: Pick<Pointed, "name" | "text">): string {
  const words = name || text
  return words.length > 80 ? `${words.slice(0, 79)}…` : words
}

/**
 * What a conversation is told beside the person's own words. The first line is what the person
 * is shown: the thing by its words, in their language. The lines after it are for the
 * conversation: the page, the tab, and the selector that identifies the thing itself, so it acts
 * on exactly that and does not look for it again. Only a place that is no element, such as the
 * page's background, is told by where it is. Text the person selected is what they mean, more
 * exactly than the element it is in; the paragraph around it says which occurrence.
 */
export function pointedContext(
  pointed: Pointed,
  page: { url: string; tab: string; selection?: string },
  say: (key: "browser.pointLabel" | "browser.pointLabelPlain", values: Record<string, string>) => string
): string {
  const selection = page.selection?.replace(/\s+/g, " ").trim() ?? ""
  const what = selection ? pointedWords({ name: selection, text: "" }) : pointedWords(pointed)
  const lines = [
    what ? say("browser.pointLabel", { what }) : say("browser.pointLabelPlain", {}),
    `page: ${page.url}`,
    `tab: ${page.tab}`
  ]
  if (pointed.selector) lines.push(`selector: css=${pointed.selector}`)
  else {
    const [left, top, width, height] = pointed.rect
    const percent = (value: number) => Math.round(value * 100)
    lines.push(
      `position: ${percent(left + width / 2)}% from the left, ${percent(top + height / 2)}% from the top of the visible page`
    )
  }
  if (selection) lines.push(`selected text: ${selection.slice(0, 2000)}`)
  if (pointed.block && pointed.block !== selection) lines.push(`in: ${pointed.block}`)
  return lines.join("\n")
}

/**
 * Where the box a person writes in goes, in fractions of the page's visible area: under the thing
 * they pointed at, or over it when there is no room underneath.
 */
export function remarkPlace(rect: Pointed["rect"], box: { width: number; height: number }) {
  const [left, top, , height] = rect
  const under = top + height
  return {
    left: Math.max(0, Math.min(left, 1 - box.width)),
    top: under + box.height <= 1 ? under : Math.max(0, top - box.height)
  }
}
