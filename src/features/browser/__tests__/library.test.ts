import "./language"
import { beforeEach, expect, test } from "vitest"

import { resolveAddress } from "../address"
import { type Library, loadLibrary, recordVisit, searchProviders, suggest, topSites } from "../library"

const day = 86_400_000
const now = 100 * day
const library = (partial: Partial<Library>): Library => ({ history: [], bookmarks: [], search: "google", ...partial })
beforeEach(() => localStorage.clear())

test("a repeat visit counts, moves to the front and keeps its title until a new one arrives", () => {
  let history = recordVisit([], "https://a.example/", "A", 1)
  history = recordVisit(history, "https://b.example/", "B", 2)
  history = recordVisit(history, "https://a.example/", "", 3)
  expect(history).toEqual([
    { url: "https://a.example/", title: "A", visits: 2, last: 3 },
    { url: "https://b.example/", title: "B", visits: 1, last: 2 }
  ])
  // Internal and non-web locations are not history.
  expect(recordVisit(history, "about:blank", "", 4)).toEqual(history)
})

test("history is bounded and drops the oldest pages", () => {
  let history = recordVisit([], "https://first.example/", "", 0)
  for (let index = 1; index <= 2000; index++) history = recordVisit(history, `https://site${index}.example/`, "", index)
  expect(history).toHaveLength(2000)
  expect(history.some((visit) => visit.url === "https://first.example/")).toBe(false)
})

test("suggestions answer what was typed: host prefix first, then host, title and path", () => {
  const value = library({
    history: [
      { url: "https://docs.example.com/guide", title: "Guide", visits: 1, last: now },
      { url: "https://example.com/", title: "Example", visits: 1, last: now },
      { url: "https://news.site/story-about-example", title: "Story", visits: 50, last: now },
      { url: "https://other.site/", title: "An example of titles", visits: 1, last: now }
    ]
  })
  expect(suggest(value, "exa", now).map((page) => page.url)).toEqual([
    "https://example.com/",
    "https://docs.example.com/guide",
    "https://other.site/",
    "https://news.site/story-about-example"
  ])
  expect(suggest(value, "https://www.exa", now)[0]?.url).toBe("https://example.com/")
  expect(suggest(value, "   ", now)).toEqual([])
  expect(suggest(value, "nothing-matches", now)).toEqual([])
})

test("habit and bookmarks order pages that match equally well", () => {
  const value = library({
    history: [
      { url: "https://github.com/rare", title: "", visits: 1, last: now - 60 * day },
      { url: "https://github.com/daily", title: "", visits: 40, last: now },
      { url: "https://github.com/old-favourite", title: "", visits: 40, last: now - 300 * day }
    ],
    bookmarks: [{ url: "https://github.com/starred", title: "Starred" }]
  })
  const pages = suggest(value, "github.com/", now)
  expect(pages[0]).toEqual({ url: "https://github.com/daily", title: "", bookmarked: false })
  expect(pages.find((page) => page.url === "https://github.com/starred")?.bookmarked).toBe(true)
  expect(pages.map((page) => page.url).indexOf("https://github.com/starred")).toBeLessThan(
    pages.map((page) => page.url).indexOf("https://github.com/rare")
  )
  expect(suggest(value, "github", now, 2)).toHaveLength(2)
})

test("the start page offers the most used pages", () => {
  const history = [
    { url: "https://a.example/", title: "", visits: 2, last: 5 },
    { url: "https://b.example/", title: "", visits: 9, last: 1 },
    { url: "https://c.example/", title: "", visits: 2, last: 7 }
  ]
  expect(topSites(history, 2).map((visit) => visit.url)).toEqual(["https://b.example/", "https://c.example/"])
})

test("a search uses the chosen provider and an address never does", () => {
  expect(resolveAddress("rust book", searchProviders.duckduckgo.url)).toBe("https://duckduckgo.com/?q=rust%20book")
  expect(resolveAddress("中文 搜索", searchProviders.baidu.url)).toBe(
    `https://www.baidu.com/s?wd=${encodeURIComponent("中文 搜索")}`
  )
  expect(resolveAddress("example.com", searchProviders.bing.url)).toBe("https://example.com/")
  expect(resolveAddress("rust book")).toBe("https://www.google.com/search?q=rust%20book")
})

test("a corrupt or non-web library is rejected instead of trusted", () => {
  expect(loadLibrary()).toEqual({ history: [], bookmarks: [], search: "google" })
  const save = (value: unknown) => localStorage.setItem("alwith.browser.library.v1", JSON.stringify(value))
  save({ history: [], bookmarks: [{ url: "javascript:alert(1)", title: "x" }], search: "google" })
  expect(() => loadLibrary()).toThrow("Invalid browser library")
  save({ history: [], bookmarks: [], search: "evil" })
  expect(() => loadLibrary()).toThrow("Invalid browser library")
  save({ history: [{ url: "https://a.example/", title: "A", visits: "many", last: 1 }], bookmarks: [], search: "bing" })
  expect(() => loadLibrary()).toThrow("Invalid browser library")
  save({ history: [{ url: "https://a.example/", title: "A", visits: 3, last: 1 }], bookmarks: [], search: "bing" })
  expect(loadLibrary().search).toBe("bing")
})

test("imported bookmarks are merged without duplicates or non-web entries", async () => {
  const { addBookmarks, libraryStore } = await import("../library")
  libraryStore.setState({ history: [], bookmarks: [{ url: "https://a.example/", title: "Mine" }], search: "google" })
  expect(
    addBookmarks([
      { url: "https://a.example/", title: "Theirs" },
      { url: "https://b.example/", title: "B" },
      { url: "https://b.example/", title: "B again" },
      { url: "javascript:alert(1)", title: "x" }
    ])
  ).toBe(1)
  expect(libraryStore.getState().bookmarks).toEqual([
    { url: "https://a.example/", title: "Mine" },
    { url: "https://b.example/", title: "B" }
  ])
})

test("a bookmarks file is read in either format, keeping only web pages", async () => {
  const { parseBookmarks } = await import("../library")
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Work</H3>
  <DL><p>
    <DT><A HREF="https://docs.example/?a=1&amp;b=2" ADD_DATE="1">Docs &amp; <b>guides</b></A>
    <DT><a href="javascript:alert(1)">Script</a>
    <DT><A HREF="http://intranet.example/wiki" ICON="data:image/png;base64,AAA"></A>
  </DL><p>
</DL><p>`
  expect(parseBookmarks(html)).toEqual([
    { url: "https://docs.example/?a=1&b=2", title: "Docs & guides" },
    { url: "http://intranet.example/wiki", title: "" }
  ])
  const chromium = JSON.stringify({
    roots: {
      bookmark_bar: {
        type: "folder",
        children: [
          { type: "url", name: "News", url: "https://news.example/" },
          { type: "folder", children: [{ type: "url", name: "Settings", url: "chrome://settings/" }] }
        ]
      },
      other: { type: "folder", children: [{ type: "url", name: "Other", url: "https://other.example/" }] }
    }
  })
  expect(parseBookmarks(chromium)).toEqual([
    { url: "https://news.example/", title: "News" },
    { url: "https://other.example/", title: "Other" }
  ])
  expect(() => parseBookmarks("{}")).toThrow("这不是书签文件")
  expect(() => parseBookmarks("just some text")).toThrow("这不是书签文件")
})

test("a page open in another tab is offered as that tab, ahead of an equal answer", () => {
  const value = library({
    history: [
      { url: "https://example.com/", title: "Example", visits: 1, last: now },
      { url: "https://example.org/", title: "Example", visits: 1, last: now }
    ]
  })
  const open = [
    { url: "https://example.org/", title: "Example" },
    { url: "https://examples.dev/never-visited", title: "Open only" }
  ]
  expect(suggest(value, "exa", now, 6, open)).toEqual([
    { url: "https://example.org/", title: "Example", bookmarked: false, open: true },
    { url: "https://examples.dev/never-visited", title: "Open only", bookmarked: false, open: true },
    { url: "https://example.com/", title: "Example", bookmarked: false }
  ])
})
