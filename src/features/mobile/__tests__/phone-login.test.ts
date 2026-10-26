import { usePhoneLoginTicket as useSharedPhoneLoginTicket } from "@alwith/module-auth/phone-login"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = {
  createMobileQrTicket: vi.fn<() => Promise<{ qr_ticket: string; qr_content: string; expires_in: number }>>(),
  getMobileQrTicketStatus:
    vi.fn<(ticket: string) => Promise<{ status: string; device_id: string | null; device_name: string | null }>>(),
  confirmMobileQrTicket: vi.fn<(ticket: string) => Promise<void>>()
}
const apiPost = async <T>(path: string, body?: unknown): Promise<T> => {
  const ticket = (body as { qr_ticket: string } | undefined)?.qr_ticket
  if (path.endsWith("/status")) return (await mocks.getMobileQrTicketStatus(ticket!)) as T
  if (path.endsWith("/confirm")) return (await mocks.confirmMobileQrTicket(ticket!)) as T
  return (await mocks.createMobileQrTicket()) as T
}
const usePhoneLoginTicket = () => useSharedPhoneLoginTicket({ apiPost })

const TICKET = {
  qr_ticket: "ticket-1",
  qr_content: "alwith://mobile-login?ticket=ticket-1",
  expires_in: 120
}
const PENDING = { status: "PENDING", device_id: null, device_name: null }
const SCANNED = { status: "SCANNED", device_id: "device-1", device_name: "iPhone 16 Pro" }

function apiError(status: number, message = `http ${status}`): Error {
  return Object.assign(new Error(message), { status })
}

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.createMobileQrTicket.mockResolvedValue(TICKET)
  mocks.getMobileQrTicketStatus.mockResolvedValue(PENDING)
  mocks.confirmMobileQrTicket.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("手机扫码登录票据", () => {
  it("挂载后创建票据并展示服务端返回的二维码原文", async () => {
    const { result } = renderHook(() => usePhoneLoginTicket())

    expect(result.current.state.phase).toBe("creating")
    await advance(0)

    expect(result.current.state).toEqual({
      phase: "showing",
      qrContent: TICKET.qr_content,
      secondsLeft: 120
    })
  })

  it("倒计时按服务端有效期递减并在归零时过期", async () => {
    const { result } = renderHook(() => usePhoneLoginTicket())
    await advance(0)

    await advance(3_000)
    expect(result.current.state).toMatchObject({ phase: "showing", secondsLeft: 117 })

    await advance(117_000)
    expect(result.current.state).toEqual({ phase: "expired" })
  })

  it("扫码后展示完整设备信息并停止轮询", async () => {
    mocks.getMobileQrTicketStatus.mockResolvedValue(SCANNED)
    const { result } = renderHook(() => usePhoneLoginTicket())
    await advance(0)
    await advance(1_500)

    expect(result.current.state).toEqual({
      phase: "scanned",
      deviceId: "device-1",
      deviceName: "iPhone 16 Pro",
      confirmError: null
    })
    const pollCount = mocks.getMobileQrTicketStatus.mock.calls.length
    await advance(6_000)
    expect(mocks.getMobileQrTicketStatus).toHaveBeenCalledTimes(pollCount)
  })

  it("SCANNED 缺少设备信息时明确进入错误态", async () => {
    mocks.getMobileQrTicketStatus.mockResolvedValue({ status: "SCANNED", device_id: null, device_name: null })
    const { result } = renderHook(() => usePhoneLoginTicket())
    await advance(0)
    await advance(1_500)

    expect(result.current.state).toEqual({
      phase: "error",
      message: "Mobile QR ticket is SCANNED without device information"
    })
  })

  it("服务端确认票据后直接进入完成态", async () => {
    mocks.getMobileQrTicketStatus.mockResolvedValue({ status: "CONFIRMED", device_id: null, device_name: null })
    const { result } = renderHook(() => usePhoneLoginTicket())
    await advance(0)
    await advance(1_500)

    expect(result.current.state).toEqual({ phase: "confirmed" })
  })

  it("未知服务端状态明确进入错误态", async () => {
    mocks.getMobileQrTicketStatus.mockResolvedValue({ status: "REJECTED", device_id: null, device_name: null })
    const { result } = renderHook(() => usePhoneLoginTicket())
    await advance(0)
    await advance(1_500)

    expect(result.current.state).toEqual({
      phase: "error",
      message: "Unsupported mobile QR ticket status: REJECTED"
    })
  })

  it("票据不存在或状态冲突时进入过期态", async () => {
    mocks.getMobileQrTicketStatus.mockRejectedValue(apiError(404))
    const { result } = renderHook(() => usePhoneLoginTicket())
    await advance(0)
    await advance(1_500)

    expect(result.current.state).toEqual({ phase: "expired" })
  })

  it("短暂网络失败继续轮询，连续五次失败才进入错误态", async () => {
    mocks.getMobileQrTicketStatus
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValue(new Error("network down"))
    const { result } = renderHook(() => usePhoneLoginTicket())
    await advance(0)

    await advance(6_000)
    expect(result.current.state).toMatchObject({ phase: "showing" })

    await advance(1_500)
    expect(result.current.state).toEqual({ phase: "error", message: "network down" })
  })

  it("用户确认后调用当前票据并进入完成态", async () => {
    mocks.getMobileQrTicketStatus.mockResolvedValue(SCANNED)
    const { result } = renderHook(() => usePhoneLoginTicket())
    await advance(0)
    await advance(1_500)

    act(() => result.current.confirm())
    expect(result.current.state).toMatchObject({ phase: "confirming" })
    await advance(0)

    expect(mocks.confirmMobileQrTicket).toHaveBeenCalledWith("ticket-1")
    expect(result.current.state).toEqual({ phase: "confirmed" })
  })

  it("确认失败时保留设备信息，允许用户再次确认", async () => {
    mocks.getMobileQrTicketStatus.mockResolvedValue(SCANNED)
    mocks.confirmMobileQrTicket.mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined)
    const { result } = renderHook(() => usePhoneLoginTicket())
    await advance(0)
    await advance(1_500)

    act(() => result.current.confirm())
    await advance(0)
    expect(result.current.state).toEqual({
      phase: "scanned",
      deviceId: "device-1",
      deviceName: "iPhone 16 Pro",
      confirmError: "network"
    })

    act(() => result.current.confirm())
    await advance(0)
    expect(result.current.state).toEqual({ phase: "confirmed" })
  })

  it("刷新会让旧票据异步结果失效并创建新票据", async () => {
    mocks.getMobileQrTicketStatus.mockResolvedValue({ status: "EXPIRED", device_id: null, device_name: null })
    const { result } = renderHook(() => usePhoneLoginTicket())
    await advance(0)
    await advance(1_500)
    expect(result.current.state).toEqual({ phase: "expired" })

    mocks.getMobileQrTicketStatus.mockResolvedValue(PENDING)
    act(() => result.current.refresh())
    await advance(0)

    expect(mocks.createMobileQrTicket).toHaveBeenCalledTimes(2)
    expect(result.current.state).toMatchObject({ phase: "showing", secondsLeft: 120 })
  })

  it("卸载后停止轮询", async () => {
    const { unmount } = renderHook(() => usePhoneLoginTicket())
    await advance(0)
    unmount()
    const pollCount = mocks.getMobileQrTicketStatus.mock.calls.length

    await advance(10_000)

    expect(mocks.getMobileQrTicketStatus).toHaveBeenCalledTimes(pollCount)
  })
})

it("ignores a status response arriving after ticket expiry", async () => {
  let resolve!: (value: { status: string; device_id: string | null; device_name: string | null }) => void
  mocks.createMobileQrTicket.mockResolvedValue({ ...TICKET, expires_in: 2 })
  mocks.getMobileQrTicketStatus.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const { result } = renderHook(() => usePhoneLoginTicket())
  await advance(0)
  await advance(2_000)
  expect(result.current.state.phase).toBe("expired")
  await act(async () => resolve(SCANNED))
  expect(result.current.state.phase).toBe("expired")
})
