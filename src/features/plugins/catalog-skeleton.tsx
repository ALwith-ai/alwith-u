import { useTranslation } from "react-i18next"

import { ItemActions, ItemContent, ItemMedia, PanelList } from "@/components/alwith-ui/panel-item"
import { Item } from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"

export function CatalogSkeleton({ skills = false }: { skills?: boolean }) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      aria-label={t(skills ? "plugins.skills.loading" : "plugins.loading")}
      className="mx-2 my-3 flex flex-col gap-3"
    >
      <Skeleton className="h-4 w-36" />
      <PanelList className="grid grid-cols-1 gap-2 px-0 @min-[700px]:grid-cols-2" aria-hidden="true">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((id) => (
          <Item key={id} size="xs">
            <ItemMedia>
              <Skeleton className="size-9 rounded-sm" />
            </ItemMedia>
            <ItemContent className="min-w-0 group-data-[size=xs]/item:gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/3" />
            </ItemContent>
            <ItemActions>
              <Skeleton className="h-8 w-20" />
            </ItemActions>
          </Item>
        ))}
      </PanelList>
    </div>
  )
}
