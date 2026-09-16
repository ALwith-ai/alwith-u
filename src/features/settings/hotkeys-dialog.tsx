// Keyboard shortcuts reference, from ALwith Desktop's hotkeys-dialog reduced to this app's
// shortcuts. Menu accelerators are fixed in src-tauri/src/menu.rs and listed here by hand.
import { Fragment } from "react"
import { useTranslation } from "react-i18next"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { formatShortcutForDisplay } from "@/lib/shortcut-formatter"

export function HotkeysDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const groups = [
    {
      title: t("shortcuts.groups.general"),
      items: [
        { label: t("shortcuts.items.newChat"), key: "CommandOrControl+N" },
        { label: t("shortcuts.items.commandPalette"), key: "CommandOrControl+K" },
        { label: t("shortcuts.items.findInChat"), key: "CommandOrControl+F" },
        { label: t("shortcuts.items.openSettings"), key: "CommandOrControl+," },
        { label: t("shortcuts.items.openHotkeys"), key: "CommandOrControl+/" },
        { label: t("shortcuts.items.zoomIn"), key: "CommandOrControl+=" },
        { label: t("shortcuts.items.zoomOut"), key: "CommandOrControl+-" },
        { label: t("shortcuts.items.actualSize"), key: "CommandOrControl+0" },
        { label: t("shortcuts.items.activityJump"), key: "CommandOrControl+1…9" }
      ]
    },
    {
      title: t("shortcuts.groups.chat"),
      items: [
        { label: t("shortcuts.items.sendMessage"), key: "Enter" },
        { label: t("shortcuts.items.newLine"), key: "Shift+Enter" },
        { label: t("shortcuts.items.approvalPick"), key: "1…9" },
        { label: t("shortcuts.items.dismiss"), key: "Escape" }
      ]
    }
  ].map(group => ({
    title: group.title,
    items: group.items.map(item => ({ label: item.label, keys: formatShortcutForDisplay(item.key) }))
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          {groups.map(group => (
            <div key={group.title}>
              <div className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                {group.title}
              </div>
              <div className="bg-muted/40 rounded-lg px-3">
                {group.items.map((item, index) => (
                  <Fragment key={item.label}>
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <div className="text-sm">{item.label}</div>
                      <KbdGroup className="gap-1.5">
                        {item.keys.map((key, keyIndex) => (
                          <Fragment key={`${item.label}-${key}`}>
                            {keyIndex > 0 && <span className="text-muted-foreground text-xs">+</span>}
                            <Kbd>{key}</Kbd>
                          </Fragment>
                        ))}
                      </KbdGroup>
                    </div>
                    {index < group.items.length - 1 && <Separator />}
                  </Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
