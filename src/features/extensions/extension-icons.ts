import type { ContributionIcon } from "@alwith/module-extension"
import {
  BlocksIcon,
  BookOpenIcon,
  ChartColumnIcon,
  ChartNoAxesColumnIcon,
  ClockIcon,
  GlobeIcon,
  FileTextIcon,
  PanelsTopLeftIcon,
  PlayIcon,
  SettingsIcon,
  ShieldCheckIcon
} from "lucide-react"

export const EXTENSION_ICONS: Record<ContributionIcon, typeof BlocksIcon> = {
  blocks: BlocksIcon,
  play: PlayIcon,
  panel: PanelsTopLeftIcon,
  settings: SettingsIcon,
  clock: ClockIcon,
  chart: ChartNoAxesColumnIcon,
  globe: GlobeIcon,
  "bar-chart-3": ChartColumnIcon,
  "file-text": FileTextIcon,
  "book-open": BookOpenIcon,
  "shield-check": ShieldCheckIcon
}
