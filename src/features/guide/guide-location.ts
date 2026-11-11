import { guideChapters } from "./content"

export const guideLocationKey = "alwith-guide-location"

export function readGuideLocation(): number {
  const saved = localStorage.getItem(guideLocationKey)
  if (saved === null) return 0
  const { id } = JSON.parse(saved) as { id: string }
  const index = guideChapters.findIndex((chapter) => chapter.id === id)
  if (index < 0) throw new Error(`Unknown guide chapter: ${id}`)
  return index
}

export function guideLinkChapter(value: string): string {
  const url = new URL(value)
  const id = url.pathname.slice(1)
  if (
    url.protocol !== "alwith-docs:" ||
    url.hostname !== "guide" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !guideChapters.some((chapter) => chapter.id === id)
  )
    throw new Error(`Invalid guide link: ${value}`)
  return id
}
