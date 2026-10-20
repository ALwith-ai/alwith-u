import { expect, test } from "vitest"

import { macProjectPaths } from "../project-path"

test.each(["var", "tmp", "etc"])("macOS %s aliases keep one identity without accessing deleted directories", root => {
  const relative = `${root}/deleted-parent/deleted-project`
  const expected = [`/private/${relative}`, `/${relative}`]
  expect(macProjectPaths(`/${relative}`)).toEqual(expected)
  expect(macProjectPaths(`/private/${relative}/`)).toEqual(expected)
  expect(macProjectPaths(`/${root}`)).toEqual([`/private/${root}`, `/${root}`])
})

test.each(["/variable/project", "/private/variant/project", "/Users/me/project", "/", "C:\\work\\project"])(
  "unrelated path %s keeps its own identity",
  cwd => {
    expect(macProjectPaths(cwd)).toEqual([cwd])
  }
)
