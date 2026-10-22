import type { Meta, StoryObj } from "@storybook/react-vite"
import { PictureInPicture2Icon, PlusIcon, SearchIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "../../src/components/alwith-ui/button"

function ShortcutPreview() {
  const { t } = useTranslation()
  return (
    <div className="flex h-48 items-center justify-center gap-8">
      <Button variant="ghost" size="icon-sm" aria-label={t("sidebar.search")} shortcut="CmdOrCtrl+K">
        <SearchIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={t("chatWindow.open")} shortcut="Alt+Space">
        <PictureInPicture2Icon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={t("sidebar.newChat")} shortcut="CmdOrCtrl+N">
        <PlusIcon />
      </Button>
    </div>
  )
}
const meta = { title: "Navigation/Shortcut hints", component: ShortcutPreview } satisfies Meta<typeof ShortcutPreview>
export default meta
export const Keycaps: StoryObj<typeof meta> = {}
