import type { ContributionIcon } from "@alwith/module-extension"
import {
  BlocksIcon,
  ChartNoAxesColumnIcon,
  ClockIcon,
  GlobeIcon,
  PanelsTopLeftIcon,
  PlayIcon,
  SettingsIcon
} from "lucide-react"

export const EXTENSION_ICONS: Record<ContributionIcon, typeof BlocksIcon> = {
  blocks: BlocksIcon,
  play: PlayIcon,
  panel: PanelsTopLeftIcon,
  settings: SettingsIcon,
  clock: ClockIcon,
  chart: ChartNoAxesColumnIcon,
  globe: GlobeIcon
}
