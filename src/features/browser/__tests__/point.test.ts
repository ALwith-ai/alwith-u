import { describe, expect, test } from "vitest"

import { type Pointed, pointedContext, pointedWords, remarkPlace } from "../point"

const thing = (values: Partial<Pointed>): Pointed => ({
  rect: [0.1, 0.2, 0.3, 0.1],
  kind: "button",
  name: "",
  text: "",
  around: "",
  selector: "",
  block: "",
  ...values
})
const say = (key: string, values: Record<string, string>) => `${key} ${JSON.stringify(values)}`

describe("what a conversation is told about a pointed thing", () => {
  test("a thing is known by its label before what it says", () => {
    expect(pointedWords(thing({ name: "Close", text: "×" }))).toBe("Close")
    expect(pointedWords(thing({ text: "Buy now" }))).toBe("Buy now")
    expect(pointedWords(thing({ text: "a".repeat(200) }))).toHaveLength(80)
  })

  const page = { url: "https://shop.example/", tab: "browser-1" }

  test("the first line is for the person; the page, tab and selector are for the conversation", () => {
    expect(pointedContext(thing({ text: "Buy now", selector: "#buy" }), page, say)).toBe(
      'browser.pointLabel {"what":"Buy now"}\npage: https://shop.example/\ntab: browser-1\nselector: css=#buy'
    )
  })

  test("a thing without words is still identified by its selector", () => {
    expect(pointedContext(thing({ selector: "form > input:nth-of-type(2)" }), page, say)).toBe(
      "browser.pointLabelPlain {}\npage: https://shop.example/\ntab: browser-1\nselector: css=form > input:nth-of-type(2)"
    )
  })

  test("selected text is what the person means; the paragraph says which occurrence", () => {
    const cell = thing({ text: "自己占 28～52%", selector: "td", block: "笔记写自己占 28～52%，风控 48～72%" })
    expect(pointedContext(cell, { ...page, selection: " 28～52% " }, say)).toBe(
      'browser.pointLabel {"what":"28～52%"}\npage: https://shop.example/\ntab: browser-1\nselector: css=td\nselected text: 28～52%\nin: 笔记写自己占 28～52%，风控 48～72%'
    )
    // Without a selection the paragraph still says where the thing is.
    expect(pointedContext(cell, page, say)).toContain("\nin: 笔记写自己占 28～52%，风控 48～72%")
  })

  test("a place that is no element is told by where its middle is", () => {
    expect(pointedContext(thing({}), page, say)).toBe(
      "browser.pointLabelPlain {}\npage: https://shop.example/\ntab: browser-1\nposition: 25% from the left, 25% from the top of the visible page"
    )
  })
})

describe("where the remark is written", () => {
  const box = { width: 0.3, height: 0.1 }

  test("under the thing, starting at its left", () => {
    expect(remarkPlace([0.1, 0.2, 0.3, 0.1], box)).toEqual({ left: 0.1, top: expect.closeTo(0.3) })
  })

  test("over the thing when there is no room underneath", () => {
    expect(remarkPlace([0.1, 0.85, 0.3, 0.1], box)).toEqual({ left: 0.1, top: expect.closeTo(0.75) })
  })

  test("never past the right edge", () => {
    expect(remarkPlace([0.9, 0.2, 0.1, 0.1], box).left).toBeCloseTo(0.7)
  })
})
