import { EmojiPicker } from "frimousse"
import { BoxIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export function CollectionEmoji({ emoji, onChange }: { emoji?: string; onChange: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)
  const { t, i18n } = useTranslation()
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        render={
          <Button variant="ghost" size="icon-xs" className="relative z-10" aria-label={t("collection.emoji")}>
            {emoji || <BoxIcon className="size-3.5" />}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-auto p-0">
        <EmojiPicker.Root
          emojibaseUrl="/emojibase"
          locale={i18n.language === "zh-CN" ? "zh" : "en"}
          className="flex h-80 w-72 flex-col bg-popover"
          onEmojiSelect={({ emoji: picked }) => {
            onChange(picked)
            setOpen(false)
          }}
        >
          <EmojiPicker.Search
            aria-label={t("collection.emoji")}
            className="mx-2 mt-2 flex h-8 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
          />
          <EmojiPicker.Viewport className="relative flex-1 outline-none">
            <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
              …
            </EmojiPicker.Loading>
            <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground" />
            <EmojiPicker.List
              className="pb-1.5 select-none"
              components={{
                CategoryHeader: ({ category, ...props }) => (
                  <div className="bg-popover px-3 pt-3 pb-1.5 text-xs text-muted-foreground" {...props}>
                    {category.label}
                  </div>
                ),
                Row: ({ children, ...props }) => (
                  <div className="scroll-my-1.5 px-1.5" {...props}>
                    {children}
                  </div>
                ),
                Emoji: ({ emoji: item, ...props }) => (
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-md text-lg data-[active]:bg-accent"
                    {...props}
                  >
                    {item.emoji}
                  </button>
                )
              }}
            />
          </EmojiPicker.Viewport>
        </EmojiPicker.Root>
      </PopoverContent>
    </Popover>
  )
}
