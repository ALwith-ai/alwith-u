import { act, fireEvent, render } from "@testing-library/react"
import { beforeAll, expect, mock, test } from "bun:test"
import { useState } from "react"
import { installDom } from "../../../chat/codex/__tests__/dom-environment"
import { initI18n } from "@/lib/i18n"
import { PROVIDERS, type ProviderSnapshot } from "@/lib/providers"
import { CustomProviderEditor, ProviderRow, ProviderTabs } from "../provider-section"
import { CodexAccountSummary } from "../codex-provider-section"
import type { SettingsAccount } from "@/lib/settings-bridge"

installDom()
beforeAll(async () => {
  await initI18n("en")
})
const provider = PROVIDERS.find(item => item.id === "qwen")
if (!provider) throw new Error("Qwen provider fixture missing")
function snapshot(revision: number, region = "intl"): ProviderSnapshot {
  return {
    revision,
    appliedRevision: revision,
    status: "applied",
    error: null,
    customProviders: [],
    providers: { qwen: { configured: true, region } }
  }
}

test("an untouched row follows loaded regions and submits the revision it displayed", async () => {
  const save = mock(async () => snapshot(3))
  const view = render(
    <ProviderRow
      provider={provider}
      saved={{ configured: true, region: "cn" }}
      revision={1}
      busy={false}
      onSave={save}
    />
  )
  view.rerender(
    <ProviderRow
      provider={provider}
      saved={{ configured: true, region: "intl" }}
      revision={2}
      busy={false}
      onSave={save}
    />
  )
  await act(async () => {
    view.getByLabelText("API key").focus()
    fireEvent.input(view.getByLabelText("API key"), { target: { value: "new-key" } })
    fireEvent.keyUp(view.getByLabelText("API key"), { key: "a" })
  })
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Save" }))
  })
  expect(save.mock.calls[0]).toEqual([2, { apiKey: "new-key", region: "intl" }])
  expect((view.getByLabelText("API key") as HTMLInputElement).value).toBe("")
  await act(async () => {
    view.getByLabelText("API key").focus()
    fireEvent.input(view.getByLabelText("API key"), { target: { value: "after-ack" } })
    fireEvent.keyUp(view.getByLabelText("API key"), { key: "a" })
  })
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Save" }))
  })
  expect(save.mock.calls[1]).toEqual([3, { apiKey: "after-ack", region: "intl" }])
})

test("a dirty row keeps its loaded revision across another window's save and retains a rejected draft", async () => {
  const save = mock(async () => null)
  const view = render(
    <ProviderRow
      provider={provider}
      saved={{ configured: true, region: "cn" }}
      revision={1}
      busy={false}
      onSave={save}
    />
  )
  await act(async () => {
    view.getByLabelText("API key").focus()
    fireEvent.input(view.getByLabelText("API key"), { target: { value: "draft-key" } })
    fireEvent.keyUp(view.getByLabelText("API key"), { key: "a" })
  })
  view.rerender(
    <ProviderRow
      provider={provider}
      saved={{ configured: true, region: "intl" }}
      revision={2}
      busy={false}
      onSave={save}
    />
  )
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Save" }))
  })
  expect(save.mock.calls[0]).toEqual([1, { apiKey: "draft-key", region: "cn" }])
  expect((view.getByLabelText("API key") as HTMLInputElement).value).toBe("draft-key")
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Remove" }))
  })
  expect(save.mock.calls[1]).toEqual([1, null])
})

test("a successful save advances the base without erasing text typed while it was in flight", async () => {
  let finish!: (value: ProviderSnapshot) => void
  const save = mock(
    () =>
      new Promise<ProviderSnapshot>(resolve => {
        finish = resolve
      })
  )
  const view = render(<ProviderRow provider={provider} saved={null} revision={1} busy={false} onSave={save} />)
  await act(async () => {
    view.getByLabelText("API key").focus()
    fireEvent.input(view.getByLabelText("API key"), { target: { value: "submitted-key" } })
    fireEvent.keyUp(view.getByLabelText("API key"), { key: "a" })
  })
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Save" }))
  })
  await act(async () => {
    view.getByLabelText("API key").focus()
    fireEvent.input(view.getByLabelText("API key"), { target: { value: "next-draft" } })
    fireEvent.keyUp(view.getByLabelText("API key"), { key: "a" })
  })
  await act(async () => {
    finish(snapshot(2, "cn"))
  })
  expect((view.getByLabelText("API key") as HTMLInputElement).value).toBe("next-draft")
  view.rerender(
    <ProviderRow
      provider={provider}
      saved={{ configured: true, region: "cn" }}
      revision={2}
      busy={false}
      onSave={save}
    />
  )
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Save" }))
  })
  expect(save.mock.calls[1]).toEqual([2, { apiKey: "next-draft", region: "cn" }])
  await act(async () => {
    finish(snapshot(3, "cn"))
  })
})

test("a built-in provider saves a page-configured API base URL", async () => {
  const save = mock(async () => snapshot(2))
  const view = render(
    <ProviderRow
      provider={provider}
      saved={{ configured: true, region: "intl" }}
      revision={1}
      busy={false}
      onSave={save}
    />
  )
  await act(async () => {
    const input = view.getByLabelText("API base URL")
    input.focus()
    fireEvent.input(input, {
      target: { value: "https://gateway.example.test/v1" }
    })
    fireEvent.keyUp(input, { key: "a" })
  })
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Save" }))
  })
  expect(save.mock.calls[0]).toEqual([1, { region: "intl", baseUrl: "https://gateway.example.test/v1" }])
})

test("provider tabs show configuration state and switch the single active panel", async () => {
  const custom = {
    id: "custom_private",
    name: "Private gateway",
    baseUrl: "https://gateway.example.test/v1",
    models: [{ label: "Model A", api_id: "model-a" }]
  }
  function Harness() {
    const [active, setActive] = useState("deepseek")
    return (
      <>
        <ProviderTabs
          activeId={active}
          keys={{ deepseek: { configured: true } }}
          customProviders={[custom]}
          onSelect={setActive}
          onAdd={() => setActive("new")}
        />
        <output>{active}</output>
      </>
    )
  }
  const view = render(<Harness />)
  expect(view.getByRole("button", { name: "DeepSeek" }).getAttribute("aria-pressed")).toBe("true")
  expect(view.getByTestId("deepseek-status").getAttribute("data-configured")).toBe("true")
  expect(view.getByTestId("qwen-status").getAttribute("data-configured")).toBe("false")

  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Qwen" }))
  })
  expect(view.getByRole("button", { name: "Qwen" }).getAttribute("aria-pressed")).toBe("true")
  expect(view.getByText("qwen")).toBeTruthy()

  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Private gateway" }))
  })
  expect(view.getByText("custom_private")).toBeTruthy()
})

const customProvider = {
  id: "custom_private",
  name: "Private gateway",
  baseUrl: "https://gateway.example.test/v1",
  models: [{ label: "Model A", api_id: "model-a" }]
}

async function enterText(input: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    input.focus()
    fireEvent.input(input, { target: { value } })
    fireEvent.keyUp(input, { key: "a" })
  })
}

test("custom model previews reflect edits and keep the JSON draft when reopened", async () => {
  const save = mock(async () => true)
  const saved = mock(() => {})
  const view = render(
    <CustomProviderEditor provider={customProvider} revision={7} busy={false} onSave={save} onSaved={saved} />
  )
  expect(view.getByText("Model A")).toBeTruthy()
  expect(view.queryByLabelText("Models (JSON)")).toBeNull()
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Edit JSON" })))
  const draft = '[{"label":"Model B","api_id":"model-b","contextWindow":32000}]'
  await enterText(view.getByLabelText("Models (JSON)"), draft)
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Preview models" })))
  expect(view.getByText("Model B")).toBeTruthy()
  expect(view.getByText("model-b")).toBeTruthy()
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Edit JSON" })))
  expect((view.getByLabelText("Models (JSON)") as HTMLTextAreaElement).value).toBe(draft)
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Save" })))
  expect(save.mock.calls).toEqual([[7, { ...customProvider, models: JSON.parse(draft) }]])
  expect(saved.mock.calls).toEqual([[customProvider.id]])
})

test("invalid model JSON stays editable and cannot be saved or hidden by preview", async () => {
  const save = mock(async () => true)
  const view = render(
    <CustomProviderEditor provider={customProvider} revision={1} busy={false} onSave={save} onSaved={() => {}} />
  )
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Edit JSON" })))
  await enterText(view.getByLabelText("Models (JSON)"), "[]")
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Preview models" })))
  expect(view.getByLabelText("Models (JSON)").getAttribute("aria-invalid")).toBe("true")
  expect(view.getByRole("alert").textContent).toBe("Add at least one model")
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Save" })))
  expect(save).not.toHaveBeenCalled()
  expect((view.getByLabelText("Models (JSON)") as HTMLTextAreaElement).value).toBe("[]")
})

test("a new custom provider starts with the model editor open and masks its API key", async () => {
  const view = render(
    <CustomProviderEditor provider={null} revision={1} busy={false} onSave={async () => true} onSaved={() => {}} />
  )
  expect(view.getByLabelText("Models (JSON)")).toBeTruthy()
  expect(view.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true)
  await enterText(view.getByLabelText("API key"), "draft-key")
  expect(view.getByLabelText("API key").getAttribute("type")).toBe("password")
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Show key" })))
  expect(view.getByLabelText("API key").getAttribute("type")).toBe("text")
  expect((view.getByLabelText("API key") as HTMLInputElement).value).toBe("draft-key")
})

test("Codex loading resolves to real usage without presenting a signed-out action", async () => {
  const signOut = mock(() => {})
  const view = render(<CodexAccountSummary account={undefined} disabled={false} onSignOut={signOut} />)
  expect(view.getByLabelText("Codex").getAttribute("aria-busy")).toBe("true")
  expect(view.queryByRole("button")).toBeNull()
  const account: SettingsAccount = {
    account: { account: { type: "chatgpt", email: "test@example.test", planType: "pro" }, requiresOpenaiAuth: true },
    rateLimits: {
      limitId: null,
      limitName: null,
      credits: null,
      spendControlReached: null,
      planType: "pro",
      primary: { usedPercent: 27, windowDurationMins: 10080, resetsAt: null },
      secondary: null
    }
  }
  view.rerender(<CodexAccountSummary account={account} disabled={false} onSignOut={signOut} />)
  expect(view.getByLabelText("Codex").getAttribute("aria-busy")).toBe("false")
  expect(view.getByText("test@example.test · Pro")).toBeTruthy()
  expect(view.getAllByRole("progressbar")).toHaveLength(1)
  expect(view.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("27")
  await act(async () => fireEvent.click(view.getByRole("button")))
  expect(signOut).toHaveBeenCalledTimes(1)
  view.rerender(<CodexAccountSummary account={null} disabled={false} onSignOut={signOut} />)
  expect(view.queryByRole("progressbar")).toBeNull()
  expect(view.queryByRole("button")).toBeNull()
})
