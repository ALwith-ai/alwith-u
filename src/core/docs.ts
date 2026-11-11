export type ChapterMetadata = {
  id: string
  icon: string
  summary: string
  group: string
  takeaway: string
  keywords: string
}

export type GuideChapter = ChapterMetadata & { title: string; text: string; url: string }

/** One parser for the bundled reader and the documentation service. */
export function parseGuide(content: string, metadata: ChapterMetadata[]): GuideChapter[] {
  const sections = content.split(/^## /m)
  if (sections.length !== metadata.length) throw new Error("Guide chapters and catalog must match")
  const ids = new Set<string>()
  return sections.map((section, index) => {
    const entry = metadata[index]
    if (!/^[a-z][a-z0-9-]*$/.test(entry.id) || ids.has(entry.id)) throw new Error(`Invalid guide ID: ${entry.id}`)
    ids.add(entry.id)
    const end = section.indexOf("\n")
    if (end < 0) throw new Error(`Empty guide chapter: ${entry.id}`)
    return {
      ...entry,
      title: index === 0 ? "Welcome" : section.slice(0, end).trim(),
      text: section.slice(end + 1).trim(),
      url: `alwith-docs://guide/${entry.id}`
    }
  })
}

export function searchGuide(chapters: GuideChapter[], query: string) {
  const words = query.toLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? []
  const terms = [
    ...new Set(
      words.flatMap((word) =>
        /\p{Script=Han}/u.test(word)
          ? [
              word,
              ...Array.from(word)
                .slice(1)
                .map((character, index) => word[index] + character)
            ]
          : [word]
      )
    )
  ]
  if (!terms.length) throw new Error("Enter a documentation search query")
  return chapters
    .map((chapter) => {
      const title = `${chapter.title} ${chapter.keywords}`.toLowerCase()
      const body = chapter.text.toLowerCase()
      const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 5 : body.includes(term) ? 1 : 0), 0)
      return { id: chapter.id, title: chapter.title, url: chapter.url, summary: chapter.summary, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}
