import { expect, test } from "vitest"
import { searchPalette } from "../search"

test("keeps the catalog order for an empty query and ranks exact matches before fuzzy matches", () => {
  const groups = [
    { id: "actions", heading: "Actions", entries: [{ search: "Open settings" }] },
    { id: "chats", heading: "Chats", entries: [{ search: "z a l w i t h" }, { search: "alwith" }] }
  ]
  expect(searchPalette(groups, "")).toBe(groups)
  const found = searchPalette(groups, "alwith")
  expect(found.map(group => group.id)).toEqual(["chats"])
  expect(found[0].entries.map(entry => entry.search)).toEqual(["alwith", "z a l w i t h"])
  expect(groups[1].entries[0].search).toBe("z a l w i t h")
})
