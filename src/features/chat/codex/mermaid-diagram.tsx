import { Code, Copy, Download, Eye, Maximize2, MoreHorizontal, X } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

import { downloadChatFile } from "../file-actions"
import { diagramImage, diagramPng } from "./mermaid-export"
import { MermaidPreview } from "./mermaid-preview"

/** Mermaid's theme derivation requires hex colors, while our tokens use OKLCH. */
function diagramTheme(element: HTMLElement) {
  const styles = getComputedStyle(element)
  const context = document.createElement("canvas").getContext("2d")
  if (!context) throw new Error("Unable to resolve diagram colors")
  const hex = (color: string) => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = styles.backgroundColor
    context.fillRect(0, 0, 1, 1)
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
  }
  return {
    background: hex(styles.backgroundColor),
    primaryColor: hex(styles.getPropertyValue("--muted").trim()),
    primaryTextColor: hex(styles.color),
    primaryBorderColor: hex(styles.getPropertyValue("--border").trim()),
    lineColor: hex(styles.getPropertyValue("--muted-foreground").trim())
  }
}

export function MermaidDiagram({ source }: { source: string }) {
  const { resolvedTheme } = useTheme()
  const id = `mermaid-${useId().replaceAll(":", "")}`
  const [svg, setSvg] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const preview = useMemo(() => (svg === null ? null : diagramImage(svg)), [svg])

  useEffect(() => {
    let cancelled = false
    setSvg(null)
    void (async () => {
      try {
        const module = await import("mermaid")
        if (cancelled || container.current === null) return
        const mermaid = module.default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          htmlLabels: false,
          theme: "base",
          themeVariables: { ...diagramTheme(container.current), darkMode: resolvedTheme === "dark" }
        })
        const result = await mermaid.render(id, source)
        if (!cancelled) setSvg(result.svg)
      } catch {
        if (!cancelled) setSvg(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, resolvedTheme, source])

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(source)
      toast.success("Mermaid 源码已复制")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const download = async () => {
    if (svg === null || container.current === null || saving) return
    setSaving(true)
    try {
      const data = await diagramPng(svg, getComputedStyle(container.current).backgroundColor)
      await downloadChatFile("mermaid.png", data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const downloadButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="下载 PNG"
      title="下载 PNG"
      disabled={svg === null || saving}
      onClick={() => void download()}
    >
      <Download className="size-4" />
    </Button>
  )

  return (
    <div ref={container} className="group/mermaid relative my-3 min-w-0 rounded-lg bg-background">
      <div
        data-open={menuOpen}
        className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 transition-opacity group-focus-within/mermaid:opacity-100 group-hover/mermaid:opacity-100 data-[open=true]:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            aria-label="图表选项"
            title="图表选项"
            render={<Button variant="ghost" size="icon-sm" />}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem disabled={svg === null} onClick={() => setShowSource((value) => !value)}>
              {showSource ? <Eye /> : <Code />}
              {showSource ? "显示图表" : "查看源码"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void copySource()}>
              <Copy />
              复制源码
            </DropdownMenuItem>
            <DropdownMenuItem disabled={svg === null || saving} onClick={() => void download()}>
              <Download />
              下载 PNG
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="放大图表"
          title="放大图表"
          disabled={svg === null}
          onClick={() => setExpanded(true)}
        >
          <Maximize2 className="size-4" />
        </Button>
      </div>
      {showSource || svg === null ? (
        <pre className="overflow-x-auto rounded-lg bg-muted/30 p-3 pt-11 text-xs">
          <code>{source}</code>
        </pre>
      ) : (
        <div
          className="overflow-x-auto rounded-lg px-3 pt-10 pb-3 [&_svg]:mx-auto [&_svg]:max-w-full"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid returns sanitized SVG markup.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      <Dialog open={expanded && preview !== null} onOpenChange={setExpanded}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[calc(100dvh-clamp(1.5rem,10dvh,6rem))] w-[calc(100vw-clamp(1.5rem,10vw,8rem))] max-w-none flex-col gap-2 overflow-hidden bg-background p-2 sm:max-w-none sm:p-4"
        >
          {expanded && preview && (
            <MermaidPreview
              key={preview.src}
              image={preview}
              actions={
                <>
                  {downloadButton}
                  <DialogClose
                    aria-label="关闭预览"
                    title="关闭预览"
                    render={<Button variant="ghost" size="icon-sm" />}
                  >
                    <X className="size-4" />
                  </DialogClose>
                </>
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
