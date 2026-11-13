import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import type { ActivityImage } from "@alwith/module-chat/activity-host"
import { revealItemsInDir } from "@tauri-apps/plugin-opener"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FolderOpenIcon,
  ImageIcon,
  LoaderCircleIcon,
  XIcon
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { create } from "zustand"

import { commands } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { type AppInfo, externalAppCandidates, openPathInApp, readAppsInfo } from "@/lib/open-with-app"
import { isMac } from "@/lib/platform"

import { chatFileName, downloadChatFile } from "../file-actions"
import { ProjectAppIcon } from "../open-in-editor"
import { ImageEditOverlay, ImageEditToolbar, useImageEditor } from "./image-editor"

// Gallery entries keep their original attachment identity for file operations.
type PreviewImage = ActivityImage & { uri?: string }
type LightboxState = { images: PreviewImage[]; index: number; sessionId?: string; sending: boolean }
const useLightbox = create<LightboxState>(() => ({ images: [], index: 0, sessionId: undefined, sending: false }))
const closeLightbox = (): void => {
  if (!useLightbox.getState().sending)
    useLightbox.setState({ images: [], index: 0, sessionId: undefined, sending: false })
}
const setLightboxSending = (sending: boolean): void => useLightbox.setState({ sending })

export function openImageLightbox(src: string, alt = "", uri?: string, sessionId?: string): void {
  openImageGallery([{ src, alt, uri }], 0, sessionId)
}

export function openImageGallery(images: PreviewImage[], index: number, sessionId?: string): void {
  if (useLightbox.getState().sending) return
  if (images[index] === undefined) throw new Error("Image gallery index is out of range")
  useLightbox.setState({ images, index, sessionId })
}

function moveImage(direction: number): void {
  useLightbox.setState((state) => ({
    index: state.sending ? state.index : Math.max(0, Math.min(state.images.length - 1, state.index + direction))
  }))
}

function localPath(uri: string | undefined): string | null {
  if (!uri) return null
  if (uri.startsWith("file:")) {
    const url = new URL(uri)
    const path = decodeURIComponent(url.pathname)
    if (url.hostname && url.hostname !== "localhost") return `//${url.hostname}${path}`
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
  }
  return uri.startsWith("/") || /^[A-Za-z]:[\\/]/.test(uri) || uri.startsWith(String.raw`\\`) ? uri : null
}

type SendImageEdit = (prompt: acp.ContentBlock[]) => Promise<void>

function ImagePreview({
  image,
  index,
  count,
  onSend
}: {
  image: PreviewImage
  index: number
  count: number
  onSend?: SendImageEdit
}) {
  const { t } = useTranslation()
  const viewport = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [apps, setApps] = useState<AppInfo[]>([])
  const [fileManager, setFileManager] = useState<AppInfo>()
  const [appsError, setAppsError] = useState(false)
  const [failed, setFailed] = useState(false)
  const exportedPath = useRef<Promise<string> | null>(null)
  const sending = useLightbox((state) => state.sending)
  const editor = useImageEditor(image.src, natural, onSend, closeLightbox, setLightboxSending, sending)
  const path = localPath(image.uri) ?? localPath(image.src)
  const data = /^data:(image\/[^;,]+);base64,([\s\S]*)$/.exec(image.src)
  const name = image.uri ? chatFileName(image.uri) : `image.${data?.[1]?.split("/")[1] ?? "png"}`
  const canOpen = path !== null || data !== null
  const ensureLocalPath = (): Promise<string> => {
    if (path) return Promise.resolve(path)
    if (!data) return Promise.reject(new Error("Image data is unavailable"))
    return (exportedPath.current ??= Promise.try(async () => {
      const bytes = Uint8Array.from(atob(data[2]), (character) => character.charCodeAt(0))
      return await commands.chatWritePastedFile({ name, data: [...bytes] })
    }).catch((error: unknown) => {
      exportedPath.current = null
      throw error
    }))
  }
  const fit =
    natural.width && bounds.width
      ? Math.min(1, Math.max(1, bounds.width - 48) / natural.width, Math.max(1, bounds.height - 48) / natural.height)
      : null
  const scale = zoom ?? fit
  useEffect(() => {
    const node = viewport.current
    if (!node) return
    const measure = (): void => setBounds({ width: node.clientWidth, height: node.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const loadApps = (): void => {
    setAppsError(false)
    void readAppsInfo(
      isMac()
        ? ["Preview", "Photos", "Adobe Photoshop", "Affinity Photo", "Pixelmator Pro", "GIMP"]
        : ["Photos", "Paint", "Adobe Photoshop", "GIMP"],
      true
    )
      .then(setApps)
      .catch(() => setAppsError(true))
    void readAppsInfo([externalAppCandidates()[0]], true)
      .then((apps) => setFileManager(apps[0]))
      .catch(() => setFileManager(undefined))
  }
  return (
    <>
      <header className="flex w-full shrink-0 items-center justify-end gap-3 px-4 py-3">
        <DialogTitle className="sr-only">{t("chat.image.view")}</DialogTitle>
        <div className="flex shrink-0 items-center gap-2" role="toolbar" aria-label={t("chat.image.tools")}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" className="rounded-full" aria-label={t("chat.image.zoom")} />}
            >
              {scale === null ? t("chat.image.fit") : `${Math.round(scale * 100)}%`}
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuRadioGroup
                value={zoom === null ? "fit" : String(zoom)}
                onValueChange={(value) => setZoom(value === "fit" ? null : Number(value))}
              >
                <DropdownMenuRadioItem value="fit">{t("chat.image.fit")}</DropdownMenuRadioItem>
                {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((value) => (
                  <DropdownMenuRadioItem key={value} value={String(value)}>
                    {value * 100}%
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu onOpenChange={(open) => open && loadApps()}>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  className="rounded-full"
                  disabled={!canOpen || busy || editor.sending}
                  title={!canOpen ? t("chat.image.localRequired") : undefined}
                />
              }
            >
              <FolderOpenIcon />
              {t("actions.open")}
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {apps.map((app) => (
                <DropdownMenuItem
                  key={app.bundle_id}
                  onClick={() => void run(async () => openPathInApp(app.bundle_id, await ensureLocalPath()))}
                >
                  {app.icon ? <img src={app.icon} alt="" className="size-4" /> : <ImageIcon />}
                  {app.name}
                </DropdownMenuItem>
              ))}
              {appsError && <DropdownMenuItem disabled>{t("chat.image.appsUnavailable")}</DropdownMenuItem>}
              <DropdownMenuItem onClick={() => void run(async () => revealItemsInDir(await ensureLocalPath()))}>
                <ProjectAppIcon app={fileManager} />
                {t(isMac() ? "plugins.skills.revealInFinder" : "plugins.skills.revealInFileExplorer")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            disabled={!data || busy || editor.sending}
            aria-label={t("chat.content.download", { name })}
            title={t("chat.content.download", { name })}
            onClick={() => data && void run(() => downloadChatFile(image.uri ?? name, data[2]))}
          >
            {busy ? <LoaderCircleIcon className="motion-safe:animate-spin" /> : <DownloadIcon />}
          </Button>
          <DialogClose
            render={
              <Button
                variant="outline"
                size="icon"
                className="rounded-full"
                disabled={editor.sending}
                aria-label={t("actions.close")}
                title={t("actions.close")}
              />
            }
          >
            <XIcon />
          </DialogClose>
        </div>
      </header>
      <div ref={viewport} className="min-h-0 w-full flex-1 overflow-auto">
        <div className="grid min-h-full w-max min-w-full place-items-center p-6">
          {failed ? (
            <p role="alert">{t("chat.image.unavailable")}</p>
          ) : (
            <div className="relative w-fit shrink-0">
              <img
                draggable={false}
                src={image.src}
                alt={image.alt}
                className="block max-w-none border-0 shadow-none"
                style={
                  natural.width && scale
                    ? { width: natural.width * scale, height: natural.height * scale }
                    : { maxWidth: "100%", maxHeight: "80vh" }
                }
                onLoad={(event) =>
                  setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
                }
                onError={() => setFailed(true)}
              />
              <ImageEditOverlay editor={editor} />
            </div>
          )}
        </div>
      </div>
      {!failed && <ImageEditToolbar editor={editor} />}
      {count > 1 && (
        <>
          <Button
            variant="outline"
            size="icon"
            className="absolute start-3 top-1/2 rounded-full"
            aria-label={t("chat.image.previous")}
            disabled={index === 0 || editor.sending}
            onClick={() => moveImage(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="absolute end-3 top-1/2 rounded-full"
            aria-label={t("chat.image.next")}
            disabled={index === count - 1 || editor.sending}
            onClick={() => moveImage(1)}
          >
            <ChevronRightIcon />
          </Button>
        </>
      )}
    </>
  )
}

export function ImageLightbox({ sessionId, onSend }: { sessionId?: string; onSend?: SendImageEdit }) {
  const { t } = useTranslation()
  const { images, index, sessionId: owner } = useLightbox()
  const image = owner === sessionId ? images[index] : undefined
  return (
    <Dialog open={image !== undefined} onOpenChange={(open) => !open && closeLightbox()}>
      <DialogContent
        showCloseButton={false}
        aria-label={t("chat.image.view")}
        onKeyDown={(event) => {
          if (
            (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
            !event.defaultPrevented &&
            !(event.target instanceof Element && event.target.closest('[role="menu"], input, textarea, select'))
          ) {
            event.preventDefault()
            moveImage(event.key === "ArrowLeft" ? -1 : 1)
          }
        }}
        className="fixed inset-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background/90 p-0 ring-0 backdrop-blur-md sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100"
      >
        {image && (
          <ImagePreview
            key={`${index}:${image.src}:${image.uri ?? ""}`}
            image={image}
            index={index}
            count={images.length}
            onSend={onSend}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
