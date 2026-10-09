import { describe, expect, test } from "vitest"
import { patchStatsByFile } from "../edited-files-card"

const patch = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 keep
-old
+new
+added
diff --git a/src/b.ts b/src/b.ts
deleted file mode 100644
--- a/src/b.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-gone
-gone too
diff --git a/src/c.ts b/src/c.ts
new file mode 100644
--- /dev/null
+++ b/src/c.ts
@@ -0,0 +1 @@
+fresh
`

describe("patchStatsByFile", () => {
  test("counts each file's own hunks instead of the whole patch", () => {
    const stats = patchStatsByFile(patch)
    expect(stats.get("src/a.ts")).toEqual({ additions: 2, deletions: 1 })
    expect(stats.get("src/b.ts")).toEqual({ additions: 0, deletions: 2 })
    expect(stats.get("src/c.ts")).toEqual({ additions: 1, deletions: 0 })
    expect(stats.size).toBe(3)
  })
})
