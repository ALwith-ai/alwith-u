import {
  accountKey,
  createPetAssets,
  type MyVibemonItem,
  type PetAccount,
  type VibemonCatalogItem
} from "@alwith/module-auth/pets"
import {
  configureVibemon,
  initializeSettings,
  observeResourceSync,
  requestVibemonView
} from "@alwith/module-auth/pets/core"

import spriteConfig from "../../node_modules/@alwith/module-auth/assets/pets/vibemon/dino-sena-m/config.json"
import { type BubbleCase, petSessions, petWindows, resetPetSession } from "./pet-session"

const account: PetAccount = { apiHost: "api.example.test", userId: "storybook-user", revision: 1 }
const listeners = new Set<() => void>()
let stop = () => {}
let stopSettings = () => {}
let storageValues: Record<string, unknown> = {}
const image = new URL(
  "../../node_modules/@alwith/module-auth/assets/pets/card-draw/placeholder-card.png",
  import.meta.url
).href
const equipBackground = new URL(
  "../../node_modules/@alwith/module-auth/assets/pets/vibemon/equip/page-bg.webp",
  import.meta.url
).href
const pullBackground = new URL(
  "../../node_modules/@alwith/module-auth/assets/pets/card-draw/pull-page-background.png",
  import.meta.url
).href
const spriteUrl = new URL(
  "../../node_modules/@alwith/module-auth/assets/pets/vibemon/dino-sena-m/sprite-sheet.png",
  import.meta.url
).href
const storage = {
  get: async <T>(key: string): Promise<T | undefined> => storageValues[key] as T | undefined,
  set: async (key: string, value: unknown) => {
    storageValues[key] = value
    for (const listener of listeners) listener()
  }
}
export type PetCase =
  | "home"
  | "pull"
  | "album"
  | "equip"
  | "empty"
  | "offline"
  | "syncError"
  | "firstVisit"
  | "drawError"
  | "insufficient"
  | "desktop"
export async function resetPets(kind: PetCase = "home", bubbleCase?: BubbleCase): Promise<void> {
  stopSettings()
  stop()
  resetPetSession(bubbleCase)
  const scope = accountKey(account)
  storageValues = {
    "vibemon.accounts": {
      [scope]: { pet: kind === "desktop" ? "pet-0" : "", enabled: kind === "desktop", position: { x: 300, y: 300 } }
    },
    "vibemon.introSeen": { [scope]: kind !== "firstVisit" },
    "vibemon.onboardingStep": {},
    "vibemon.albumHasUnseen": {}
  }
  const owned: MyVibemonItem[] =
    kind === "empty"
      ? []
      : ["小森", "阿洛", "墨墨"].map((name, index) => ({
          vibemon_uuid: `pet-${index}`,
          name,
          description: "用于展示的模拟宠物资料。",
          rarity_code: index === 0 ? "SSR" : "SR",
          rarity_name: index === 0 ? "传说" : "稀有",
          rarity_color: "#aa8844",
          category_code: "dino",
          category_name: "恐龙",
          cover_url: image,
          gacha_url: image,
          icon_url: image,
          background_url: equipBackground,
          pool_card_url: image,
          sidebar_selected_url: image,
          sidebar_hover_url: image,
          sidebar_unselected_url: image,
          is_limited: 0,
          is_equipped: false,
          obtained_time: "2026-10-23T04:00:00Z",
          duplicate_count: index
        }))
  const layout = {
    frameWidth: spriteConfig.frameSize,
    frameHeight: spriteConfig.frameSize,
    states: spriteConfig.states
  }
  const catalog: VibemonCatalogItem[] = owned.map((pet) => ({
    ...pet,
    uuid: pet.vibemon_uuid,
    rarity_uuid: "demo-rarity",
    category_uuid: "demo-category",
    resource_url: "/storybook-pets/vibemon/dino-sena-m",
    resource_version: 1,
    sheet_url: spriteUrl,
    layout: JSON.stringify(layout),
    status: 1,
    gacha_url: image,
    multi_draw_url: image
  }))
  const assets = createPetAssets({
    account: () => account,
    storage,
    request: async <T>(path: string, _method: string, data?: unknown): Promise<T> => {
      let value: unknown
      if (path.includes("/mine")) {
        if (kind === "offline") throw new Error("模拟离线")
        value = owned
      } else if (path.endsWith("/catalog")) value = catalog
      else if (path.endsWith("/first-visit")) value = { first_visit: kind === "firstVisit" }
      else if (path.endsWith("/first-draw")) value = { first_draw: false }
      else if (path.endsWith("/points/account"))
        value = { available_points: kind === "insufficient" ? 0 : 3200, total_points: 3200, frozen_points: 0 }
      else if (path.endsWith("/pools"))
        value = [
          {
            uuid: "demo-pool",
            name: "伙伴相遇",
            banner_url: image,
            single_cost: 160,
            multi_count: 10,
            multi_cost: 1600,
            currency_type: "POINT",
            start_time: null,
            end_time: null,
            status: 1,
            sort_order: 0,
            is_default: 1
          }
        ]
      else if (path.includes("/pools/"))
        value = {
          uuid: "demo-pool",
          name: "伙伴相遇",
          description: "示例卡池",
          banner_url: image,
          single_cost: 160,
          multi_count: 10,
          multi_cost: 1600,
          currency_type: "POINT",
          start_time: null,
          end_time: null,
          status: 1,
          rates: [],
          items: [
            {
              uuid: "demo-item",
              reward_type: "VIBEMON",
              status: 1,
              rarity_code: "SSR",
              vibemon_sidebar_selected_url: image,
              vibemon_sidebar_hover_url: image,
              vibemon_sidebar_unselected_url: image,
              vibemon_background_url: pullBackground,
              vibemon_pool_card_url: image
            }
          ],
          guarantee: {
            target_rarity_code: "SSR",
            target_rarity_name: "传说",
            hard_pity_count: 80,
            soft_pity_start: 70,
            ten_pull_min_rarity_name: "稀有"
          },
          first_draw_discount: false
        }
      else if (path.endsWith("/draw")) {
        if (kind === "drawError") throw new Error("模拟抽取失败，请重试。")
        const count = (data as { draw_type?: string })?.draw_type === "MULTI" ? 10 : 1
        value = {
          order_no: "DEMO-20261023",
          cost_amount: 160 * count,
          currency_type: "POINT",
          results: Array.from({ length: count }, (_, index) => ({
            draw_index: index + 1,
            reward_type: "VIBEMON",
            rarity_code: "SR",
            rarity_name: "稀有",
            rarity_color: "#aa8844",
            is_duplicate: index > 0,
            duplicate_action: null,
            duplicate_value: 0,
            is_pity_hit: false,
            exchange_points: null,
            vibemon_uuid: "pet-0",
            vibemon_name: "小森",
            cover_url: image,
            gacha_url: image,
            multi_draw_url: image,
            sheet_url: catalog[0]?.sheet_url,
            layout: JSON.stringify(layout),
            icon_url: image,
            background_url: image,
            pool_card_url: image,
            sidebar_selected_url: image,
            sidebar_hover_url: image,
            sidebar_unselected_url: image
          })),
          state: {
            pool_uuid: "demo-pool",
            pity_count: 1,
            hard_pity_count: 80,
            remaining_to_hard_pity: 79,
            soft_pity_start: 70,
            total_draw_count: count
          }
        }
      } else throw new Error(`Unimplemented Storybook pet endpoint: ${path}`)
      return value as T
    },
    resources: {
      exists: async () => false,
      read: async () => null,
      write: async () => {},
      replace: async () => {},
      remove: async () => {}
    },
    download: async () => {
      throw new Error("No remote pet resource in Storybook")
    }
  })
  const localResource = async () => ({
    directory: "/demo/pets",
    sheetName: "sprite-sheet.png",
    layout,
    version: 1,
    config: spriteConfig,
    sheet: new Uint8Array(await (await fetch(spriteUrl)).arrayBuffer())
  })
  assets.ensureResource = localResource
  Object.assign(assets.resources, { inspect: localResource, cached: localResource, ensure: localResource })
  stop = configureVibemon({
    account: () => account,
    assets,
    storage,
    subscribeStorage: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    sessions: petSessions,
    windows: petWindows,
    onError: (error) => console.error(error)
  })
  stopSettings = await initializeSettings()
  observeResourceSync(kind === "syncError" ? "error" : "done")
  if (
    kind === "pull" ||
    kind === "equip" ||
    kind === "drawError" ||
    kind === "insufficient" ||
    kind === "empty" ||
    kind === "offline"
  )
    requestVibemonView(["equip", "empty", "offline"].includes(kind) ? "equip" : "pull")
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    stopSettings()
    stop()
  })
