import { afterEach, expect, test } from "bun:test"
import { UrlElicitationCard } from "@alwith/module-chat/url-elicitation-card"
import { act, fireEvent, render } from "@testing-library/react"
import { installDom } from "../codex/__tests__/dom-environment"

installDom()
const mounted: ReturnType<typeof render>[] = []
afterEach(async () => {
  await act(async () => {
    for (const view of mounted.splice(0)) view.unmount()
  })
})

test("URL card opens exactly the supplied URL without inventing an acceptance response", () => {
  const opened: string[] = []
  const responses: string[] = []
  const view = render(
    <UrlElicitationCard
      message="Authorize this connection"
      url="https://example.com/authorize?request=one"
      t={key => key}
      onOpen={url => {
        opened.push(url)
      }}
      onRespond={action => responses.push(action)}
    />
  )
  mounted.push(view)
  expect(opened).toEqual([])
  fireEvent.click(view.getByRole("button", { name: "approval.openLink" }))
  expect(opened).toEqual(["https://example.com/authorize?request=one"])
  expect(responses).toEqual([])
  fireEvent.click(view.getByRole("button", { name: "actions.decline" }))
  fireEvent.click(view.getByRole("button", { name: "actions.cancel" }))
  expect(responses).toEqual(["decline", "cancel"])
})

test("a changed request uses the new host action and URL", () => {
  const opened: string[] = []
  const responses: string[] = []
  const props = {
    message: "Connect",
    t: (key: string) => key,
    onOpen: (url: string) => {
      opened.push(url)
    }
  }
  const view = render(
    <UrlElicitationCard
      {...props}
      url="https://example.com/first"
      onRespond={action => responses.push(`first:${action}`)}
    />
  )
  mounted.push(view)
  view.rerender(
    <UrlElicitationCard
      {...props}
      url="https://example.com/second"
      onRespond={action => responses.push(`second:${action}`)}
    />
  )
  fireEvent.click(view.getByRole("button", { name: "approval.openLink" }))
  fireEvent.click(view.getByRole("button", { name: "actions.cancel" }))
  expect(opened).toEqual(["https://example.com/second"])
  expect(responses).toEqual(["second:cancel"])
})
