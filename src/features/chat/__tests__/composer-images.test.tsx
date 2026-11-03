import { createSession, type Session, type SessionSummary } from "@alwith/module-chat/client"
import { drafts } from "@alwith/module-chat/conversation"
import { DEFAULT_IMAGE_SELECTION } from "@alwith/module-chat/image"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest"

import { IMAGE_THREAD_SOURCE } from "@/agent/session-kind"
import { useImagePreferences } from "@/features/images/preferences"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { predictionPreference } from "../composer/prediction-preference"
import { Composer } from "./timeline-host"

vi.mock("@/features/images/availability", () => ({
  useImageAvailability: () => ({
    available: true,
    canGenerate: true,
    chatgptConnected: true,
    seedreamConfigured: true,
    checking: false,
    error: null
  })
}))

const original = client.state
const originalSelection = useImagePreferences.getState().selection
const originalPredictions = predictionPreference.getState().enabled
const nativeModels = [
  { value: "gpt-6.1-sol", name: "6.1 Sol" },
  { value: "gpt-6-astra", name: "6 Astra" },
  { value: "gpt-6-luna", name: "6 Luna" }
]

beforeAll(() => initI18n("en"))
beforeEach(() => {
  useImagePreferences.setState({ selection: DEFAULT_IMAGE_SELECTION })
  predictionPreference.setState({ enabled: false })
})
afterEach(() => {
  cleanup()
  client.store.setState(original, true)
  useImagePreferences.setState({ selection: originalSelection })
  predictionPreference.setState({ enabled: originalPredictions })
  drafts.clear()
})

test.each([false, true])("the composer uses the owning session's image surface policy (image: %s)", async (image) => {
  const session: Session = {
    ...createSession("conversation", "/tmp"),
    attached: true,
    configOptions: [
      {
        configId: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "gpt-6.1-sol",
        options: nativeModels
      },
      {
        configId: "reasoning_effort",
        name: "Effort",
        category: "thought_level",
        type: "select",
        currentValue: "medium",
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" }
        ]
      }
    ]
  }
  const originalOptions = structuredClone(session.configOptions)
  const summary: SessionSummary = {
    sessionId: session.id,
    cwd: session.cwd,
    title: "A conversation",
    updatedAt: null,
    archived: false,
    ...(image ? { threadSource: IMAGE_THREAD_SOURCE } : {})
  }
  client.store.setState({ sessions: { [session.id]: session }, sessionList: [summary] })
  const view = render(<Composer session={session} />)
  const selectors = image ? view.getAllByRole("button", { name: "Image model" }) : view.getAllByTestId("model-trigger")
  expect(selectors).toHaveLength(1)
  expect(selectors[0]).toHaveTextContent(image ? "ChatGPT Images" : "6.1 Sol")
  await act(() => Promise.try(() => fireEvent.click(selectors[0])))

  if (image) {
    expect(screen.getByRole("menuitemradio", { name: "ChatGPT Images" })).toBeVisible()
    expect(screen.queryByRole("menuitemradio", { name: "Seedream 4.5" })).not.toBeInTheDocument()
    expect(screen.getByRole("menuitemradio", { name: "Seedream 5.0 Lite" })).toBeVisible()
    expect(screen.getByRole("menuitemradio", { name: "Seedream 5.0 Pro" })).toBeVisible()
    for (const model of nativeModels)
      expect(screen.queryByRole("menuitemradio", { name: model.name })).not.toBeInTheDocument()
    expect(screen.queryByRole("slider", { name: "Effort" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "More models" })).not.toBeInTheDocument()
  } else {
    for (const model of nativeModels) expect(screen.getByRole("menuitemradio", { name: model.name })).toBeVisible()
    expect(screen.getByRole("slider", { name: "Effort" })).toHaveAttribute("aria-valuetext", "Medium")
    expect(screen.queryByRole("menuitemradio", { name: "ChatGPT Images" })).not.toBeInTheDocument()
  }
  expect(client.state.sessions[session.id].configOptions).toEqual(originalOptions)
})
