import { expect, test } from "vitest"
import { sendExtensionMessage } from "../chat"

function setup() {
  const events: string[] = []
  let writable = true
  let enabled = true
  let afterCatalog = (): void => {}
  const dependencies = {
    session: (id: string) => (id === "target" && writable ? { cwd: "/work" } : null),
    skills: async (cwd: string) => {
      events.push(`skills:${cwd}`)
      afterCatalog()
      return [{ name: "bi-add-metric", enabled, path: "/plugins/bi-add-metric/SKILL.md" }]
    },
    present: (id: string): void => {
      events.push(`present:${id}`)
    },
    prompt: async (id: string, text: string): Promise<void> => {
      events.push(`prompt:${id}:${text}`)
    }
  }
  return {
    dependencies,
    events,
    disable: () => {
      enabled = false
    },
    detach: () => {
      writable = false
    },
    detachDuringCatalog: () => {
      afterCatalog = () => {
        writable = false
      }
    }
  }
}

test("checks skills before revealing the explicit target and sending once", async () => {
  const { dependencies, events } = setup()
  await sendExtensionMessage("target", "build", ["bi-add-metric"], dependencies)
  expect(events).toEqual(["skills:/work", "present:target", "prompt:target:build"])
})

test("missing skills do not navigate or send", async () => {
  const { dependencies, events, disable } = setup()
  disable()
  await expect(sendExtensionMessage("target", "build", ["bi-add-metric"], dependencies)).rejects.toThrow(
    "bi-add-metric"
  )
  expect(events).toEqual(["skills:/work"])
})

test("rechecks session availability after asynchronous skill discovery", async () => {
  const { dependencies, events, detachDuringCatalog } = setup()
  detachDuringCatalog()
  await expect(sendExtensionMessage("target", "build", ["bi-add-metric"], dependencies)).rejects.toThrow("会话")
  expect(events).toEqual(["skills:/work"])
})

test("validates writable sessions even when no skill is required", async () => {
  const { dependencies, events, detach } = setup()
  detach()
  await expect(sendExtensionMessage("target", "hello", [], dependencies)).rejects.toThrow("会话")
  expect(events).toEqual([])
})

test("propagates prompt rejection without retrying", async () => {
  const { dependencies, events } = setup()
  dependencies.prompt = async () => {
    events.push("rejected")
    throw new Error("offline")
  }
  await expect(sendExtensionMessage("target", "hello", [], dependencies)).rejects.toThrow("offline")
  expect(events).toEqual(["present:target", "rejected"])
})

test("uses the resolved plugin skill name in the outgoing business prompt", async () => {
  const { dependencies, events } = setup()
  dependencies.skills = async () => [
    { name: "finture-bi:bi-add-metric", enabled: true, path: "/plugins/finture-bi/skills/bi-add-metric/SKILL.md" }
  ]
  await sendExtensionMessage("target", "按 bi-add-metric skill 建卡", ["bi-add-metric"], dependencies)
  expect(events).toEqual(["present:target", "prompt:target:按 finture-bi:bi-add-metric skill 建卡"])
})

test("draft placement does not send and reveals the chat only after a successful write", async () => {
  const { setExtensionDraft } = await import("../chat")
  const { dependencies, events } = setup()
  await setExtensionDraft("target", "review me", [], {
    ...dependencies,
    writeDraft: (id, text) => {
      events.push(`draft:${id}:${text}`)
    }
  })
  expect(events).toEqual(["draft:target:review me", "present:target"])
})

test("a draft conflict keeps the current page and never sends", async () => {
  const { setExtensionDraft } = await import("../chat")
  const { dependencies, events } = setup()
  await expect(
    setExtensionDraft("target", "review me", [], {
      ...dependencies,
      writeDraft: () => {
        throw new Error("existing draft")
      }
    })
  ).rejects.toThrow("existing draft")
  expect(events).toEqual([])
})

test("draft placement rejects unavailable sessions and missing skills", async () => {
  const { setExtensionDraft } = await import("../chat")
  const { dependencies, events, detach } = setup()
  detach()
  await expect(
    setExtensionDraft("target", "review me", [], {
      ...dependencies,
      writeDraft: () => {
        events.push("draft")
      }
    })
  ).rejects.toThrow("会话")
  expect(events).toEqual([])
})

test("an extension unloaded during skill discovery cannot send", async () => {
  const { dependencies, events } = setup()
  let unloaded = false
  dependencies.skills = async () => {
    unloaded = true
    return [{ name: "bi-add-metric", enabled: true, path: "/skills/bi-add-metric/SKILL.md" }]
  }
  await expect(
    sendExtensionMessage("target", "build", ["bi-add-metric"], {
      ...dependencies,
      check: () => {
        if (unloaded) throw new Error("unloaded")
      }
    })
  ).rejects.toThrow("unloaded")
  expect(events).toEqual([])
})

test("draft placement also checks required skills before touching input", async () => {
  const { setExtensionDraft } = await import("../chat")
  const { dependencies, events, disable } = setup()
  disable()
  await expect(
    setExtensionDraft("target", "build", ["bi-add-metric"], {
      ...dependencies,
      writeDraft: () => {
        events.push("draft")
      }
    })
  ).rejects.toThrow("bi-add-metric")
  expect(events).toEqual(["skills:/work"])
})
