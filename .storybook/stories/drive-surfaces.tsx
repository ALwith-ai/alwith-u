import { DriveCondense } from "@alwith/module-drive/content"
import { driveTranslator } from "@alwith/module-drive/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../src/components/ui/dialog"
import { driveControls, driveDialogClassName } from "../../src/features/drive/controls"
import { DriveSharingDialog } from "../../src/features/drive/drive"
import { PROJECT_DIRECTORY } from "../fixtures/catalog"
import { drive } from "../fixtures/drive"
import { ProductPreview, type ProductPreviewProps } from "./product-preview"
export function DriveSurfaces(args: ProductPreviewProps & { surface?: "sharing" | "condense" }) {
  const { i18n } = useTranslation()
  const locale = i18n.language.startsWith("zh") ? "zh-CN" : "en"
  const [open, setOpen] = useState(true)
  return (
    <>
      <ProductPreview {...args} />
      {args.surface === "sharing" ? (
        <DriveSharingDialog path={open ? `${PROJECT_DIRECTORY}/README.md` : null} onClose={() => setOpen(false)} />
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className={driveDialogClassName}>
            <DialogHeader>
              <DialogTitle>{driveTranslator(locale)("condense.action")}</DialogTitle>
            </DialogHeader>
            <DriveCondense
              controller={drive}
              scope={{ projectId: 1, projectName: "产品资料库", scopePath: null }}
              controls={driveControls}
              locale={locale}
              onClose={() => setOpen(false)}
              onOpenFile={async () => setOpen(false)}
              onOpenExternal={async () => setOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
