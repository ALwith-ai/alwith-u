import { applyCollectionAction, DEFAULT_COLLECTION_ID, initialCollectionData } from "@alwith/module-collection"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { fireEvent, waitFor, within } from "storybook/test"

import { AuthGate } from "../../../src/features/auth/auth-gate"
import { useChatWindowSurface } from "../../../src/lib/chat-window-state"
import { settingsStore } from "../../../src/lib/settings-store"
import { dispatchCollection, useCollectionStore } from "../../../src/features/collection/store"
import { useSessionsUiStore } from "../../../src/features/sessions/store"
import { client } from "../../fixtures/client"
import { makeSession, PROJECT_DIRECTORY } from "../../fixtures/catalog"
import { prepareNewChatExample } from "../../fixtures/new-chat"
import { separateDriveRootsFromChat } from "../../fixtures/drive"
import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const pageDocumentation: Record<string, string> = {
  "10 活动": `按进入前通知、空列表、有任务但后台未展开、展开后台、多个会话所在窗口、详情与停止入口的顺序查看。

后台分组默认展开；“未展开”示例表示用户此前收起过后台，离开后再进入仍保留该状态。暂无任务时仍显示后台标题与零计数。当前可见会话平铺在后台分组上方，不随后台收起。

主窗口与浮窗示例均展示主窗口的活动列表；窗口图标说明会话归属，不代表打开了另一个活动面板。浮窗条目点击后唤回所属浮窗。多个会话分别展示运行中、待确认和已完成状态。

2026-11-08 使用当前打包链路实测：真实创建了两个子代理，但父会话和子代理的 Runtime tasks 字段均为空，不会生成此前模拟的缩进子任务。子代理的独立运行记录标记为 reusableDraft，没有本应用持有的草稿时会被活动列表过滤。因此这里仅展示实际支持的多个聊天会话，不注入嵌套子任务。

浮窗会话示例展示先后创建的两个会话：当前会话在前台，原会话在后台，两者均保留浮窗标记；浮窗隐藏后，属于浮窗的会话都留在后台并保留浮窗标记；点击可唤回浮窗。活动操作示例同时打开真实详情卡，并将焦点放在真实停止按钮上，稳定展示行右侧的方形停止入口。停止动作调用 stopSession 关闭该会话，不是可恢复的暂停。`,
  "08 收藏/01 浏览": `点击星标“收藏”后，显示真实 CollectionPanel；会话行直接复用产品 SessionRow。集合只保存会话引用和组织信息，不复制对话。

| 分类 | 功能与规则 |
| --- | --- |
| 浏览 | 默认收藏夹、自定义集合、真实会话标题与状态、数量、展开/收起、点击或 Enter/空格打开会话 |
| 集合管理 | 创建（名称去首尾空格、空名称不能确认）、取消、重命名、选择/搜索表情、新对话、清空确认、删除确认；默认收藏夹不能重命名、删除、改表情或拖动 |
| 会话操作 | 悬停详情；收藏到其他集合、在选择器中新建集合并收藏、移出当前分组；重命名（服务支持时）、分叉（连接与能力允许时）、归档、删除确认；有运行状态时可停止；允许/排除私密会话云盘归档（企业登录且云盘已配置时） |
| 排序与快捷键 | 拖动集合排序（默认收藏夹固定）、集合内会话排序、跨集合移动；Pointer/Keyboard DnD；Cmd/Ctrl+1–9 打开当前可见的前九条；弹窗、菜单和输入期间不触发 |
| 异常状态 | 列表错误与重试、加载完成后找不到会话显示“会话不可用”并允许移除、归档会话隐藏；保存中禁用重复操作，失败显示错误且保留弹窗 |

收藏选择器一次只保留一个集合归属，选择其他集合会移动会话。清空和删除集合保留对话内容；“移出分组”也不删除对话。空集合没有额外的大型空状态插画。示例名称及会话属于隔离数据，布局、图标、菜单、弹窗和交互以真实组件为准。`,
  "08 收藏/02 集合管理": `集合排序示例可直接手动拖动集合标题调整顺序，默认收藏夹固定；交互复用真实产品组件。\n\n点击星标“收藏”后，显示真实 CollectionPanel；会话行直接复用产品 SessionRow。集合只保存会话引用和组织信息，不复制对话。

| 分类 | 功能与规则 |
| --- | --- |
| 浏览 | 默认收藏夹、自定义集合、真实会话标题与状态、数量、展开/收起、点击或 Enter/空格打开会话 |
| 集合管理 | 创建（名称去首尾空格、空名称不能确认）、取消、重命名、选择/搜索表情、新对话、清空确认、删除确认；默认收藏夹不能重命名、删除、改表情或拖动 |
| 会话操作 | 悬停详情；收藏到其他集合、在选择器中新建集合并收藏、移出当前分组；重命名（服务支持时）、分叉（连接与能力允许时）、归档、删除确认；有运行状态时可停止；允许/排除私密会话云盘归档（企业登录且云盘已配置时） |
| 排序与快捷键 | 拖动集合排序（默认收藏夹固定）、集合内会话排序、跨集合移动；Pointer/Keyboard DnD；Cmd/Ctrl+1–9 打开当前可见的前九条；弹窗、菜单和输入期间不触发 |
| 异常状态 | 列表错误与重试、加载完成后找不到会话显示“会话不可用”并允许移除、归档会话隐藏；保存中禁用重复操作，失败显示错误且保留弹窗 |

收藏选择器一次只保留一个集合归属，选择其他集合会移动会话。清空和删除集合保留对话内容；“移出分组”也不删除对话。空集合没有额外的大型空状态插画。示例名称及会话属于隔离数据，布局、图标、菜单、弹窗和交互以真实组件为准。`,
  "08 收藏/03 会话操作": `移动会话示例已展开收藏选择器：点击“自定义集合2”后，原集合数量从 3 变 2，目标集合从 0 变 1。会话排序示例可直接手动拖动会话行调整顺序，交互复用真实产品组件。\n\n点击星标“收藏”后，显示真实 CollectionPanel；会话行直接复用产品 SessionRow。集合只保存会话引用和组织信息，不复制对话。

| 分类 | 功能与规则 |
| --- | --- |
| 浏览 | 默认收藏夹、自定义集合、真实会话标题与状态、数量、展开/收起、点击或 Enter/空格打开会话 |
| 集合管理 | 创建（名称去首尾空格、空名称不能确认）、取消、重命名、选择/搜索表情、新对话、清空确认、删除确认；默认收藏夹不能重命名、删除、改表情或拖动 |
| 会话操作 | 悬停详情；收藏到其他集合、在选择器中新建集合并收藏、移出当前分组；重命名（服务支持时）、分叉（连接与能力允许时）、归档、删除确认；有运行状态时可停止；允许/排除私密会话云盘归档（企业登录且云盘已配置时） |
| 排序与快捷键 | 拖动集合排序（默认收藏夹固定）、集合内会话排序、跨集合移动；Pointer/Keyboard DnD；Cmd/Ctrl+1–9 打开当前可见的前九条；弹窗、菜单和输入期间不触发 |
| 异常状态 | 列表错误与重试、加载完成后找不到会话显示“会话不可用”并允许移除、归档会话隐藏；保存中禁用重复操作，失败显示错误且保留弹窗 |

收藏选择器一次只保留一个集合归属，选择其他集合会移动会话。清空和删除集合保留对话内容；“移出分组”也不删除对话。空集合没有额外的大型空状态插画。示例名称及会话属于隔离数据，布局、图标、菜单、弹窗和交互以真实组件为准。`,
  "08 收藏/04 异常状态": `点击星标“收藏”后，显示真实 CollectionPanel；会话行直接复用产品 SessionRow。集合只保存会话引用和组织信息，不复制对话。

| 分类 | 功能与规则 |
| --- | --- |
| 浏览 | 默认收藏夹、自定义集合、真实会话标题与状态、数量、展开/收起、点击或 Enter/空格打开会话 |
| 集合管理 | 创建（名称去首尾空格、空名称不能确认）、取消、重命名、选择/搜索表情、新对话、清空确认、删除确认；默认收藏夹不能重命名、删除、改表情或拖动 |
| 会话操作 | 悬停详情；收藏到其他集合、在选择器中新建集合并收藏、移出当前分组；重命名（服务支持时）、分叉（连接与能力允许时）、归档、删除确认；有运行状态时可停止；允许/排除私密会话云盘归档（企业登录且云盘已配置时） |
| 排序与快捷键 | 拖动集合排序（默认收藏夹固定）、集合内会话排序、跨集合移动；Pointer/Keyboard DnD；Cmd/Ctrl+1–9 打开当前可见的前九条；弹窗、菜单和输入期间不触发 |
| 异常状态 | 列表错误与重试、加载完成后找不到会话显示“会话不可用”并允许移除、归档会话隐藏；保存中禁用重复操作，失败显示错误且保留弹窗 |

收藏选择器一次只保留一个集合归属，选择其他集合会移动会话。清空和删除集合保留对话内容；“移出分组”也不删除对话。空集合没有额外的大型空状态插画。示例名称及会话属于隔离数据，布局、图标、菜单、弹窗和交互以真实组件为准。`,
  "04 新聊天/所属项目": `新聊天分为“所属项目、正常状态、异常状态”三部分。本节回答：新聊天属于哪个项目，项目条显示什么？

点击侧栏“新聊天”（或 Cmd/Ctrl+N）后，页面顶部标题为“新聊天”；输入框上方的项目条显示所选项目名或“选择项目”。判断规则：看当前选中的对话属于哪个项目，新聊天就使用哪个项目；当前是尚未发送消息的空白新聊天页时，保留页面已选的项目。仅展开项目文件夹不会改变目标项目。以下页面直接展示点击后的结果。

| 点击前的项目上下文 | 新聊天的项目条 |
| --- | --- |
| 01 首次使用，还没选过项目 | 显示“选择项目” |
| 02 当前选中的是随聊对话，不属于指定项目 | 再次新建仍显示“选择项目” |
| 03 当前选中的对话属于某个项目 | 新聊天使用该对话所属项目：选中“产品工作台”的对话就显示“产品工作台”；改选“品牌网站”的对话就显示“品牌网站” |

通过项目条可以切换最近项目或选择文件夹；取消文件夹选择保留原选择，选择“不在项目中工作”后显示“选择项目”。项目名取目录末级名称，同名文件夹可能显示相同文字，实际目录应通过项目菜单或路径信息辨别。

从工具箱等管理页点击“新聊天”也会回到聊天页：有选中的对话时使用该对话所属的项目；处于空白草稿页时保留页面已选的项目。准备结果见“正常状态”和“异常状态”，不能仅凭项目名判断是否可以发送。`,
  "04 新聊天/正常状态": `点击“新聊天”后，连接与对话准备正常时出现。

| 状态 | 何时出现 | 页面与操作 |
| --- | --- | --- |
| 准备中 | 服务正在连接，准备尚未完成 | 可先输入，等待完成后发送 |
| 可以聊天 | 服务已连接，新对话准备完成 | 空白聊天页，可输入并发送第一条消息 |`,
  "04 新聊天/异常状态/连接异常": `点击“新聊天”后，服务连接不可用时出现；连接恢复前无法发送。

| 状态 | 何时出现 | 页面与操作 |
| --- | --- | --- |
| 连接断开 | 与服务的连接处于断开状态 | 标题栏下方悬浮提示，不挤压页面；重新连接后重试 |
| 连接失败 | 连接服务的尝试失败 | 标题栏下方悬浮显示失败原因，不挤压页面；处理后重试 |`,
  "04 新聊天/异常状态/创建失败": `点击“新聊天”后，新对话准备失败时出现；此时还不能发送第一条消息。

| 状态 | 何时出现 | 页面与操作 |
| --- | --- | --- |
| 模型未登录 | 创建时缺少模型登录或供应商凭证 | 提示配置，完成登录或配置后重试 |
| 新对话创建失败 | 创建时返回其他错误 | 显示错误原因，处理后重试 |

这些示例使用隔离数据展示真实组件，实际连接和账号结果以桌面应用为准。`
}
for (const group of ["01 入口与列表", "02 窗口与会话位置", "04 活动操作"]) {
  pageDocumentation[`10 活动/${group}`] = pageDocumentation["10 活动"]!
}
pageDocumentation["10 活动/02 窗口与会话位置"] = `本组说明会话显示在哪个窗口，以及窗口切换或隐藏后，活动列表中的位置如何变化。示例统一使用绿色空闲状态；颜色的含义见“运行状态”。

| 比较项 | 主窗会话 | 浮窗会话 |
| --- | --- | --- |
| 前台位置 | 主窗当前显示的会话，列在后台分组上方 | 可见浮窗当前显示的会话，也列在后台分组上方 |
| 后台位置 | 切换到其他聊天后，原会话进入后台 | 浮窗内切换会话或隐藏浮窗后，原会话进入后台 |
| 右侧标记 | 当前主窗会话显示主窗图标；普通后台会话不显示主窗标记 | 所属浮窗的会话始终保留浮窗图标，包括进入后台后 |
| 点击行为 | 在主窗打开该会话 | 唤回浮窗，并在浮窗中打开该会话 |
| 返回主窗 | 已在主窗中查看 | 详情卡提供“返回主窗”，将会话移回主窗 |

窗口归属和运行状态是两回事：进入后台或隐藏浮窗，不会因此停止任务。两种窗口的状态颜色、标题、回复预览和停止入口共用同一套规则。`
pageDocumentation["10 活动/03 运行状态"] = `活动列表用颜色表示会话的运行状态，颜色来自 Runtime 的状态记录。

| 颜色 | 状态 | 何时出现 |
| --- | --- | --- |
| 绿色 | 空闲 | 会话没有正在执行的任务；运行结束并查看后也会回到空闲。 |
| 黄色 | 运行中 | 已发送的任务正在执行。 |
| 红色 | 需要处理 | 执行需要用户处理，例如等待权限确认；中断信息也可能要求处理。 |
| 蓝色 | 已完成，未查看 | 后台会话完成后等待查看；查看并确认已读后转为空闲。 |

蓝色示例保留已完成会话在后台，右侧显示另一个当前会话：打开并查看蓝色会话会确认已读，因此不能同时将它当作已查看的当前聊天。红色和黄色示例右侧分别展示等待确认和正在执行的聊天。`
for (const group of ["01 账号与入口", "02 配置与项目", "03 同步状态", "04 连接与同步异常"]) {
  pageDocumentation[`11 云盘/${group}`] = pageDocumentation["11 云盘"]!
}
for (const group of ["01 查看账号", "02 创建与设备", "03 伙伴显示", "04 语言与设置", "05 退出登录"]) {
  pageDocumentation[`15 账号菜单/${group}`] = "按查看账号、创建与设备、伙伴显示、语言与设置、退出登录的顺序查看。复用真实产品菜单和页面组件；移动端连接及 Gamepad 在产品中打开独立窗口。伙伴菜单根据当前账号是否已显示伙伴切换显示/隐藏文案，未装扮伙伴时点击显示会出现错误提醒。退出后由真实 AuthGate 返回登录页。"
}
export { pageDocumentation }

const meta = {
  id: "页面-导航与项目",
  title: "页面/侧栏导航/页面状态",
  component: ProductPreview,
  loaders: [async (context) => {
    await preparePreview(context)
    separateDriveRootsFromChat()
    const snapshot = await settingsStore.read()
    const data = initialCollectionData()
    await settingsStore.write({ action: "update", expectedRevision: snapshot.revision, changes: { "collections.data": { collections: data.collections, order: data.order } } })
    useCollectionStore.setState(data, true)
  }],
  args: { page: "chat", chatCase: "project", floatingChatCase: "welcome" },
  parameters: {
    layout: "fullscreen",
    productPage: true,
    a11y: { test: "todo" },
    docs: {
      description: {
        component: `按侧栏从上到下的顺序查看。每个编号模块均提供独立的完整页面示例，使用真实产品组件和隔离的模拟数据。

| 顺序 | 模块 | 行为与显示条件 |
| --- | --- | --- |
| 01 | 窗口与侧栏开关 | 固定或收起侧栏；收起后悬停可临时展开。macOS 窗口红黄绿按钮由原生应用提供，网页预览不模拟这些按钮。 |
| 02 | 搜索 | 搜索聊天、执行命令；按 Cmd/Ctrl+K 可打开同一个搜索面板。 |
| 03 | 聊天浮窗 | 首次点击打开空白浮窗；再次点击唤回浮窗原有的会话和草稿，保留生成、完成、中断或待确认等状态。此入口不会转移主窗口当前聊天；转移会话使用聊天页内的“移到浮窗”。此示例在当前画布展示浮窗内容。 |
| 04 | 新聊天 | 在当前项目中新建聊天草稿；对应快捷键为 Cmd/Ctrl+N。 |
| 05 | 工具箱 | 打开主导屏中的工具与扩展。 |
| 06 | Vibémon | 打开伙伴中心；此入口与账号菜单中的显示或隐藏伙伴操作相互独立。 |
| 08 | 收藏 | 星标标签展示收藏和自定义收藏夹；支持创建、重命名、清空、移除和调整顺序，不重复存储聊天。 |
| 09 | 聊天与项目 | 文件夹标签展示随聊、项目数量和聊天。支持展开或收起分组、显示更多项目，并通过项目弹出面板打开或新建聊天。双击标签可收起分组，并重置全部项目的展开状态。 |
| 10 | 活动 | 根据 Runtime 状态展示生成中、待确认和已完成的聊天。前台条目排在后台分组之前；查看活动后清除通知圆点。 |
| 11 | 云盘 | 仅登录 @finture.id 账号后显示云盘标签。切换标签时保留已访问的面板；不再符合条件时隐藏云盘并退出该面板。 |
| 12 | 更新状态 | 在横幅上方展示下载中、可安装或重启中的状态。空闲、检查中和未配置更新时不显示此卡片。 |
| 14 | 屏幕切换 | 进入主导屏；箭头反向后可返回主屏。 |
| 15 | 账号 | 点击头像和昵称打开账号菜单，包含账号信息、创建应用、显示或隐藏伙伴、移动端连接、Gamepad、语言、设置和退出登录。 |
| 16 | 帮助 | 打开快捷键说明或独立的使用指南窗口。Storybook 中的原生窗口操作使用隔离模拟。 |`
      }
    }
  },
  argTypes: productPreviewArgTypes
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

function sidebar(element: HTMLElement) {
  const panel = element.querySelector<HTMLElement>(".main-sidebar-panel")
  if (!panel) throw new Error("Sidebar panel is missing")
  return within(panel)
}

function clickHeader(name: string | RegExp): Story["play"] {
  return async ({ canvasElement, userEvent }) => {
    await userEvent.click(await sidebar(canvasElement).findByRole("button", { name }))
  }
}

const openAccount: Story["play"] = clickHeader(/^林然/)
function accountItem(name: string | RegExp): Story["play"] {
  return async (context) => {
    await openAccount!(context)
    await context.userEvent.click(await within(context.canvasElement.ownerDocument.body).findByRole("menuitem", { name }))
  }
}

function searchFor(value: string): Story["play"] {
  return async ({ canvasElement, userEvent }) => {
    await userEvent.click(sidebar(canvasElement).getByRole("button", { name: "搜索聊天…" }))
    const input = await within(canvasElement.ownerDocument.body).findByRole("combobox")
    fireEvent.change(input, { target: { value } })
  }
}

const populateCollections: Story["play"] = async () => {
  let data = initialCollectionData()
  data = applyCollectionAction(data, { type: "create", id: "storybook-work", name: "自定义集合1" })
  for (const row of client.store.getState().sessionList.slice(0, 3))
    data = applyCollectionAction(data, { type: "add", collectionId: "storybook-work", sessionId: row.sessionId })
  const snapshot = await settingsStore.read()
  await settingsStore.write({ action: "update", expectedRevision: snapshot.revision, changes: { "collections.data": { collections: data.collections, order: data.order } } })
  useCollectionStore.setState(data, true)
}

export const Pinned: Story = {
  name: "固定侧栏 · 始终显示",
  parameters: { pageStateGroup: "01 窗口与侧栏开关" },
  args: { sidebarPinned: true }
}

export const Unpinned: Story = {
  name: "收起侧栏 · 保留展开入口",
  parameters: { pageStateGroup: "01 窗口与侧栏开关" },
  args: { sidebarPinned: false }
}

export const Peek: Story = {
  name: "悬停开关 · 临时展开",
  parameters: { pageStateGroup: "01 窗口与侧栏开关" },
  args: { sidebarPinned: false },
  play: async ({ canvas, userEvent }) => { await userEvent.hover(canvas.getByRole("switch", { name: "固定侧边栏" })) }
}

export const Palette: Story = {
  name: "搜索入口 · 打开搜索与命令",
  parameters: { pageStateGroup: "02 搜索" },
  play: clickHeader("搜索聊天…")
}

export const PaletteResults: Story = {
  name: "输入关键词 · 匹配聊天",
  parameters: { pageStateGroup: "02 搜索" },
  play: searchFor("交付")
}

export const PaletteEmpty: Story = {
  name: "输入关键词 · 无匹配结果",
  parameters: { pageStateGroup: "02 搜索" },
  play: searchFor("no-such-project-937")
}

export const OpenFloating: Story = {
  name: "首次打开 · 新建浮窗聊天",
  parameters: { pageStateGroup: "03 聊天浮窗", docs: { description: { story: "前提：还没有浮窗会话。点击侧栏入口后显示空白聊天与输入框，可选择项目并发送消息；主窗口当前会话不会被搬入浮窗。示例直接展示点击后的真实浮窗画面，按默认 560 × 640 尺寸居中显示。" } } },
  args: { page: "floating", chatCase: "conversation", floatingChatCase: "welcome" }
}

export const OpenFloatingRunning: Story = {
  name: "生成中唤回 · 保留当前进度",
  parameters: { pageStateGroup: "03 聊天浮窗", docs: { description: { story: "前提：浮窗会话仍在生成。再次点击入口后，显示原有提问、当前思考内容和停止按钮；打开浮窗不会重新发送提问或中断生成。" } } },
  args: { page: "floating", chatCase: "conversation", floatingChatCase: "running" }
}

export const OpenFloatingTools: Story = {
  name: "执行工具时唤回 · 保留执行状态",
  parameters: { pageStateGroup: "03 聊天浮窗", docs: { description: { story: "前提：浮窗会话正在执行工具。打开后显示已完成的工具结果、执行中的工具及停止按钮，继续使用同一个会话。" } } },
  args: { page: "floating", floatingChatCase: "tools" }
}

export const OpenFloatingCompleted: Story = {
  name: "完成后唤回 · 查看回答并继续聊",
  parameters: { pageStateGroup: "03 聊天浮窗", docs: { description: { story: "前提：浮窗中的这一轮已经完成。打开后显示原有提问与完整回答，可继续输入追问；不会新建会话或再次生成。" } } },
  args: { page: "floating", floatingChatCase: "conversation" }
}

export const OpenFloatingCancelled: Story = {
  name: "主动中断后唤回 · 保留已有内容",
  parameters: { pageStateGroup: "03 聊天浮窗", docs: { description: { story: "前提：用户已中断浮窗中正在生成的这一轮。打开后保留提问及中断前的思考内容，显示中断状态与可继续输入的输入框；不会补出完成回答，也不会自动恢复生成。" } } },
  args: { page: "floating", floatingChatCase: "running" },
  loaders: [async () => { await client.cancel("running") }]
}

export const OpenFloatingStopped: Story = {
  name: "停止会话后唤回 · 查看保留记录",
  parameters: { pageStateGroup: "03 聊天浮窗", docs: { description: { story: "前提：用户已停止整个浮窗会话，使其脱离运行进程。再次打开时显示“会话已终止”和“重新连接”，保留已有聊天记录，输入框不可发送；需要重新连接后才能继续。停止整个会话与仅中断当前一轮是两个不同状态。" } } },
  args: { page: "floating", floatingChatCase: "running" },
  loaders: [async () => { await client.stopSession("running") }]
}

export const OpenFloatingPermission: Story = {
  name: "待确认时唤回 · 处理权限请求",
  parameters: { pageStateGroup: "03 聊天浮窗", docs: { description: { story: "前提：浮窗会话等待用户确认工具权限。打开后显示原有内容与待确认请求，由用户选择批准或拒绝；打开窗口本身不会代为确认。" } } },
  args: { page: "floating", floatingChatCase: "permission" }
}

export const OpenFloatingError: Story = {
  name: "出错后唤回 · 查看错误信息",
  parameters: { pageStateGroup: "03 聊天浮窗", docs: { description: { story: "前提：浮窗会话出现模型错误。打开后保留已有提问和错误信息；不会因为唤回窗口而自动重试。" } } },
  args: { page: "floating", floatingChatCase: "error" }
}

export const NewChatFirstUse: Story = {
  name: "01 首次使用 · 不指定项目",
  parameters: { pageStateGroup: "04 新聊天/所属项目", docs: { description: { story: "前提：首次使用，没有上次项目或历史聊天。新建后显示欢迎画面和“选择项目”，不会任意选中历史项目。" } } },
  args: { chatCase: "welcome", initialDirectory: null, emptyThreads: true },
  loaders: [prepareNewChatExample]
}

export const NewChatQuick: Story = {
  name: "02 选中随聊对话 · 不指定项目",
  parameters: { pageStateGroup: "04 新聊天/所属项目", docs: { description: { story: "前提：当前选中的是随聊对话，不属于指定项目。新建后输入框上方显示“选择项目”；默认存储目录不会作为项目名显示。" } } },
  args: { chatCase: "welcome", initialDirectory: null },
  loaders: [prepareNewChatExample]
}

export const NewChat: Story = {
  name: "03 选中正常项目对话 · 使用对话所属项目",
  parameters: { pageStateGroup: "04 新聊天/所属项目", docs: { description: { story: "前提：已经选中一条对话。新聊天使用这条对话所属的项目：选中“产品工作台”的对话就显示“产品工作台”；改选“品牌网站”的对话就显示“品牌网站”。本示例展示“产品工作台”，页面标题为“新聊天”，聊天内容和输入框为空。" } } },
  args: { chatCase: "project", initialDirectory: PROJECT_DIRECTORY },
  loaders: [prepareNewChatExample]
}

export const NewChatConnecting: Story = {
  name: "准备中",
  parameters: { pageStateGroup: "04 新聊天/正常状态", docs: { description: { story: "出现条件：点击新聊天后，服务正在连接。页面可先输入，准备完成后才能发送。" } } },
  args: { chatCase: "project", initialDirectory: PROJECT_DIRECTORY, connection: "connecting" },
  loaders: [prepareNewChatExample]
}

export const NewChatReady: Story = {
  name: "可以聊天",
  parameters: { pageStateGroup: "04 新聊天/正常状态", docs: { description: { story: "出现条件：服务已连接，新对话准备完成。页面为空白聊天，可输入并发送第一条消息。" } } },
  args: { chatCase: "project", initialDirectory: PROJECT_DIRECTORY },
  loaders: [prepareNewChatExample]
}

export const NewChatDisconnected: Story = {
  name: "连接断开",
  parameters: { pageStateGroup: "04 新聊天/异常状态/连接异常", docs: { description: { story: "出现条件：与服务的连接处于断开状态。标题栏下方悬浮显示连接提示，页面位置不变；重新连接后重试。" } } },
  args: { chatCase: "project", initialDirectory: PROJECT_DIRECTORY, connection: "disconnected" },
  loaders: [prepareNewChatExample]
}

export const NewChatFailed: Story = {
  name: "连接失败",
  parameters: { pageStateGroup: "04 新聊天/异常状态/连接异常", docs: { description: { story: "出现条件：连接服务的尝试失败。标题栏下方悬浮显示失败原因，页面位置不变；处理后重试。" } } },
  args: { chatCase: "project", initialDirectory: PROJECT_DIRECTORY, connection: "failed" },
  loaders: [prepareNewChatExample]
}

export const NewChatAuthRequired: Story = {
  name: "模型未登录",
  parameters: { pageStateGroup: "04 新聊天/异常状态/创建失败", docs: { description: { story: "出现条件：创建新对话时缺少模型登录或供应商凭证。页面提示配置，完成后重试。" } } },
  args: { chatCase: "project", initialDirectory: PROJECT_DIRECTORY, draftFailure: "请先登录模型账号或配置供应商。" },
  loaders: [prepareNewChatExample]
}

export const NewChatPrepareError: Story = {
  name: "新对话创建失败",
  parameters: { pageStateGroup: "04 新聊天/异常状态/创建失败", docs: { description: { story: "出现条件：创建新对话时返回其他错误。页面显示错误原因，处理后重试。" } } },
  args: { chatCase: "project", initialDirectory: PROJECT_DIRECTORY, draftFailure: "新对话创建失败，请稍后重试。", draftFailureCode: null },
  loaders: [prepareNewChatExample]
}

export const Toolbox: Story = {
  name: "已安装扩展",
  parameters: { pageStateGroup: "05 工具箱" },
  args: { extensionCase: "installed" },
  play: clickHeader("工具箱")
}

export const ToolboxEmpty: Story = {
  name: "尚未安装扩展",
  parameters: { pageStateGroup: "05 工具箱" },
  args: { extensionCase: "empty" },
  play: clickHeader("工具箱")
}

export const Vibemon: Story = {
  name: "伙伴中心",
  parameters: { pageStateGroup: "06 Vibémon" },
  play: clickHeader("Vibémon")
}

async function openCollectionMenu(context: Parameters<NonNullable<Story["play"]>>[0], name = "自定义集合1") {
  const row = await sidebar(context.canvasElement).findByRole("button", { name })
  const trigger = row.parentElement?.querySelector<HTMLElement>(`[aria-label="${name}的更多操作"]`)
  if (!trigger) throw new Error(`Collection menu trigger is missing: ${name}`)
  fireEvent.click(trigger)
  return within(context.canvasElement.ownerDocument.body)
}

const collectionArgs = { sidebarView: "collections" as const }
export const CollectionsEmpty: Story = {
  name: "默认收藏夹与空状态", parameters: { pageStateGroup: "08 收藏/01 浏览" }, args: collectionArgs
}
export const DefaultCollectionPopulated: Story = {
  name: "默认收藏夹有内容", parameters: { pageStateGroup: "08 收藏/01 浏览" }, args: collectionArgs,
  play: async () => {
    await dispatchCollection(client.state.sessionList.slice(0, 3).map((row) => ({ type: "add" as const, collectionId: DEFAULT_COLLECTION_ID, sessionId: row.sessionId })))
  }
}
export const DefaultCollectionCollapsed: Story = {
  name: "收起默认收藏夹", parameters: { pageStateGroup: "08 收藏/01 浏览" }, args: collectionArgs,
  play: async (context) => {
    await DefaultCollectionPopulated.play!(context)
    await dispatchCollection({ type: "collapse", id: DEFAULT_COLLECTION_ID, collapsed: true })
  }
}
export const Collections: Story = {
  name: "自定义集合与会话", parameters: { pageStateGroup: "08 收藏/01 浏览" }, args: collectionArgs, play: populateCollections
}
export const CollectionCollapsed: Story = {
  name: "收起集合", parameters: { pageStateGroup: "08 收藏/01 浏览" }, args: collectionArgs,
  play: async (context) => { await populateCollections!(context); await dispatchCollection({ type: "collapse", id: "storybook-work", collapsed: true }) }
}
export const CollectionManagementOverview: Story = {
  name: "入口总览", parameters: { pageStateGroup: "08 收藏/02 集合管理" }, args: collectionArgs,
  play: async (context) => { await populateCollections!(context); await openCollectionMenu(context) }
}
export const CollectionCreate: Story = {
  name: "创建集合", parameters: { pageStateGroup: "08 收藏/02 集合管理" }, args: collectionArgs,
  play: async ({ canvasElement, userEvent }) => { await userEvent.click(await sidebar(canvasElement).findByRole("button", { name: "创建集合" })) }
}
export const CollectionRename: Story = {
  name: "重命名集合", parameters: { pageStateGroup: "08 收藏/02 集合管理" }, args: collectionArgs,
  play: async (context) => { await populateCollections!(context); const body = await openCollectionMenu(context); await context.userEvent.click(await body.findByRole("menuitem", { name: "重命名" })) }
}
export const CollectionNewChat: Story = {
  name: "新对话", parameters: { pageStateGroup: "08 收藏/02 集合管理" }, args: collectionArgs,
  play: async (context) => { await populateCollections!(context); const body = await openCollectionMenu(context); await context.userEvent.click(await body.findByRole("menuitem", { name: "新对话" })) }
}
export const CollectionEmojiPicker: Story = {
  name: "集合emoji", parameters: { pageStateGroup: "08 收藏/02 集合管理" }, args: collectionArgs,
  play: async (context) => {
    await dispatchCollection({ type: "create", id: "storybook-emoji", name: "自定义集合1" })
    await context.userEvent.click(await sidebar(context.canvasElement).findByRole("button", { name: "表情" }))
  }
}
export const CollectionClear: Story = {
  name: "清空集合", parameters: { pageStateGroup: "08 收藏/02 集合管理" }, args: collectionArgs,
  play: async (context) => { await populateCollections!(context); const body = await openCollectionMenu(context); await context.userEvent.click(await body.findByRole("menuitem", { name: "清空集合" })) }
}
export const CollectionDelete: Story = {
  name: "删除集合", parameters: { pageStateGroup: "08 收藏/02 集合管理" }, args: collectionArgs,
  play: async (context) => { await populateCollections!(context); const body = await openCollectionMenu(context); await context.userEvent.click(await body.findByRole("menuitem", { name: "删除集合" })) }
}
export const CollectionSessionHover: Story = {
  name: "会话详情与操作", parameters: { pageStateGroup: "08 收藏/03 会话操作" }, args: collectionArgs,
  play: async (context) => { await populateCollections!(context); const row = context.canvasElement.querySelector<HTMLElement>("[data-session-id]"); if (!row) throw new Error("Collection session is missing"); await context.userEvent.hover(row) }
}
export const CollectionSessionRename: Story = {
  name: "重命名会话", parameters: { pageStateGroup: "08 收藏/03 会话操作" }, args: collectionArgs,
  play: async (context) => { await CollectionSessionHover.play!(context); await context.userEvent.click(await within(context.canvasElement.ownerDocument.body).findByText("重命名")) }
}
export const CollectionSessionSave: Story = {
  name: "收藏到集合", parameters: { pageStateGroup: "08 收藏/03 会话操作" }, args: collectionArgs,
  play: async (context) => { await CollectionSessionHover.play!(context); await context.userEvent.click(await within(context.canvasElement.ownerDocument.body).findByRole("button", { name: "收藏" })) }
}
export const CollectionSessionRemove: Story = {
  name: "移出分组", parameters: { pageStateGroup: "08 收藏/03 会话操作" }, args: collectionArgs,
  play: async (context) => { await CollectionSessionHover.play!(context); await context.userEvent.click(await within(context.canvasElement.ownerDocument.body).findByRole("button", { name: "移出分组" })) }
}
export const CollectionSessionFork: Story = {
  name: "分叉会话 · 打开新聊天", parameters: { pageStateGroup: "08 收藏/03 会话操作" }, args: collectionArgs,
  play: async (context) => {
    await populateCollections!(context)
    const row = context.canvasElement.querySelector<HTMLElement>('[data-session-id="conversation"]')
    if (!row) throw new Error("Collection conversation is missing")
    await context.userEvent.hover(row)
    await context.userEvent.click(await within(context.canvasElement.ownerDocument.body).findByRole("button", { name: "分叉" }))
    await waitFor(() => {
      const origin = context.canvasElement.querySelector('[data-fork-origin="conversation"]')
      if (!origin) throw new Error("Forked conversation is not displayed")
    })
  }
}
export const CollectionSessionArchive: Story = {
  name: "归档会话", parameters: { pageStateGroup: "08 收藏/03 会话操作" }, args: collectionArgs,
  play: async (context) => { await CollectionSessionHover.play!(context); await context.userEvent.click(await within(context.canvasElement.ownerDocument.body).findByRole("button", { name: "归档" })) }
}
export const CollectionSessionDelete: Story = {
  name: "删除会话", parameters: { pageStateGroup: "08 收藏/03 会话操作" }, args: collectionArgs,
  play: async (context) => { await CollectionSessionHover.play!(context); await context.userEvent.click(await within(context.canvasElement.ownerDocument.body).findByText("删除")) }
}
export const CollectionMove: Story = {
  name: "移动会话 · 选择目标集合", parameters: { pageStateGroup: "08 收藏/03 会话操作" }, args: collectionArgs,
  play: async (context) => {
    await populateCollections!(context)
    await dispatchCollection({ type: "create", id: "storybook-second", name: "自定义集合2" })
    const row = context.canvasElement.querySelector<HTMLElement>("[data-session-id]")
    if (!row) throw new Error("Collection session is missing")
    await context.userEvent.hover(row)
    const body = within(context.canvasElement.ownerDocument.body)
    const favorite = await body.findByRole("button", { name: "收藏" })
    await context.userEvent.hover(favorite)
    await body.findByRole("menuitemradio", { name: "自定义集合2" })
  }
}
export const CollectionReordered: Story = {
  name: "集合排序", parameters: { pageStateGroup: "08 收藏/02 集合管理" }, args: collectionArgs,
  play: async (context) => {
    await populateCollections!(context)
    await dispatchCollection({ type: "create", id: "storybook-second", name: "自定义集合2", sessionId: client.state.sessionList[3]!.sessionId })

  }
}
export const CollectionSessionReordered: Story = {
  name: "会话排序", parameters: { pageStateGroup: "08 收藏/03 会话操作" }, args: collectionArgs,
  play: populateCollections
}
export const CollectionUnavailable: Story = {
  name: "会话不可用与移除入口", parameters: { pageStateGroup: "08 收藏/04 异常状态" }, args: collectionArgs,
  play: async (context) => { await populateCollections!(context); await dispatchCollection({ type: "add", collectionId: "storybook-work", sessionId: "missing-session" }) }
}
export const CollectionLoadError: Story = {
  name: "读取失败与重试", parameters: { pageStateGroup: "08 收藏/04 异常状态" }, args: collectionArgs,
  play: async (context) => { await populateCollections!(context); client.store.setState({ sessionListError: "聊天列表读取失败，请重试。" }) }
}

export const ProjectsLoading: Story = {
  name: "加载中",
  parameters: { pageStateGroup: "09 聊天" },
  play: async () => { client.store.setState({ sessionList: [], sessionListLoaded: false, sessionListError: null }) }
}

export const ProjectsEmpty: Story = {
  name: "暂无项目",
  parameters: { pageStateGroup: "09 聊天" },
  args: { emptyThreads: true, initialDirectory: null }
}

export const Projects: Story = {
  name: "项目列表",
  parameters: { pageStateGroup: "09 聊天" }
}

export const ProjectPicker: Story = {
  name: "项目操作",
  parameters: { pageStateGroup: "09 聊天" },
  play: async ({ canvasElement, userEvent }) => { await userEvent.click(sidebar(canvasElement).getByRole("button", { name: /^产品工作台$/ })) }
}

export const ProjectSessionActions: Story = {
  name: "对话操作",
  parameters: { pageStateGroup: "09 聊天" },
  play: async ({ canvasElement, userEvent }) => {
    useSessionsUiStore.setState({ projectOpen: new Map() })
    const project = await sidebar(canvasElement).findByRole("button", { name: "产品工作台" })
    await userEvent.click(project)
    await userEvent.unhover(project)
    const row = canvasElement.querySelector<HTMLElement>("[data-session-id]")
    if (!row) throw new Error("Project session is missing")
    await userEvent.hover(row)
  }
}

export const MoreProjects: Story = {
  name: "展开更多项目",
  parameters: { pageStateGroup: "09 聊天" },
  play: async () => {
    const state = client.store.getState()
    if (!state.projectContext || !state.sessionList[0]) throw new Error("Project fixtures are missing")
    const projects = Array.from({ length: 9 }, (_, index) => ({
      id: `sidebar-project-${index}`,
      name: `示例项目 ${index + 1}`,
      roots: [{ path: `/Users/demo/Projects/sidebar-project-${index}` }],
      metadata: {}, position: index, createdAt: 0, updatedAt: 0, recencyAt: null
    }))
    client.store.setState({
      projectContext: { ...state.projectContext, projects },
      sessionList: projects.map((project, index) => ({
        ...state.sessionList[0]!, sessionId: `sidebar-session-${index}`,
        cwd: project.roots[0]!.path, title: `${project.name}的对话`
      }))
    })
    useSessionsUiStore.setState({ projectOpen: new Map() })
  }
}

export const ProjectSessionsMore: Story = {
  name: "展开更多会话",
  parameters: { pageStateGroup: "09 聊天" },
  play: async ({ canvasElement, userEvent }) => {
    const rows = client.store.getState().sessionList
    const row = rows.find((item) => item.cwd?.includes("产品工作台"))
    if (!row) throw new Error("Project session fixture is missing")
    useSessionsUiStore.setState({ projectOpen: new Map(), revealed: new Map() })
    client.store.setState({ sessionList: Array.from({ length: 8 }, (_, index) => ({
      ...row, sessionId: `sidebar-project-chat-${index}`, title: `项目对话 ${index + 1}`
    })) })
    const project = await sidebar(canvasElement).findByRole("button", { name: "产品工作台" })
    await userEvent.click(project)
    await userEvent.unhover(project)
  }
}

export const ProjectsCollapsed: Story = {
  name: "收起项目",
  parameters: { pageStateGroup: "09 聊天" },
  play: async () => { useSessionsUiStore.setState({ projectOpen: new Map() }) }
}

export const ProjectsError: Story = {
  name: "加载失败与重试",
  parameters: { pageStateGroup: "09 聊天" },
  play: async () => { client.store.setState({ sessionList: [], sessionListLoaded: false, sessionListError: "聊天列表加载失败，请重试。" }) }
}

function showIdleActivities() {
  client.store.setState((state) => ({
    runStates: Object.fromEntries(Object.entries(state.runStates).map(([id, record]) => [id, { ...record, state: "idle", interruption: null }])),
    sessionList: state.sessionList.map((row) => row.sessionId === "permission" ? { ...row, title: "核对交付清单" } : row),
    sessions: Object.fromEntries(Object.entries(state.sessions).map(([id, session]) => [id, { ...makeSession("conversation", id), title: session.title }]))
  }))
}

export const ActivityNotification: Story = {
  name: "01 有待处理的活动",
  parameters: { pageStateGroup: "10 活动/01 入口与列表" }
}

export const EmptyActivity: Story = {
  name: "02 暂无活动",
  parameters: { pageStateGroup: "10 活动/01 入口与列表" },
  args: { sidebarView: "activity", emptyThreads: true }
}

export const ActivityForeground: Story = {
  name: "03 后台已收起",
  parameters: { pageStateGroup: "10 活动/01 入口与列表" },
  args: { sidebarView: "activity", chatCase: "conversation" },
  beforeEach: async () => { showIdleActivities(); useSessionsUiStore.setState({ activityCollapsedGroups: new Set(["background"]) }) }
}

export const Activity: Story = {
  name: "04 后台已展开",
  parameters: { pageStateGroup: "10 活动/01 入口与列表" },
  args: { sidebarView: "activity", chatCase: "conversation" },
  beforeEach: async () => { showIdleActivities() }
}

export const ActivityFloating: Story = {
  name: "01 主窗与浮窗的前台会话",
  parameters: { pageStateGroup: "10 活动/02 窗口与会话位置", docs: { description: { story: "主窗和浮窗各自当前显示的会话，都列在后台分组上方。右侧图标分别标注主窗与浮窗；点击会话在所属窗口打开。" } } },
  args: { sidebarView: "activity", chatCase: "conversation", floatingChatCase: "running" },
  beforeEach: async () => {
    client.store.setState({ sessionWindows: { running: "chat" } })
    showIdleActivities()
    useChatWindowSurface.setState({ sessionId: "running", visible: true })
  }
}

export const ActivityFloatingMultiple: Story = {
  name: "02 浮窗切换会话后的前后台位置",
  parameters: { pageStateGroup: "10 活动/02 窗口与会话位置", docs: { description: { story: "浮窗内新建或切换到另一个会话后，当前会话留在前台，原会话进入后台；两者均保留浮窗标记。点击后台浮窗会话会在浮窗中打开。" } } },
  args: { sidebarView: "activity", chatCase: "conversation", floatingChatCase: "running" },
  beforeEach: async () => {
    client.store.setState((state) => ({
      sessionWindows: { ...state.sessionWindows, running: "chat", permission: "chat" },
      sessions: { ...state.sessions, permission: { ...state.sessions.permission!, items: [] } },
      sessionList: state.sessionList.map((row) => row.sessionId === "permission" ? { ...row, title: "整理相关资料" } : row),
      runStates: {
        ...state.runStates,
        permission: { ...state.runStates.permission!, state: "running" },
        conversation: { ...state.runStates.conversation!, state: "idle" }
      }
    }))
    showIdleActivities()
    useChatWindowSurface.setState({ sessionId: "running", visible: true })
  }
}

export const ActivityFloatingHidden: Story = {
  name: "03 隐藏浮窗后会话进入后台",
  parameters: { pageStateGroup: "10 活动/02 窗口与会话位置", docs: { description: { story: "关闭浮窗窗口、收起为宠物或隐藏浮窗后，该会话进入后台，右侧仍保留浮窗标记；主窗当前聊天仍在前台。点击浮窗会话会唤回浮窗。" } } },
  args: { sidebarView: "activity", chatCase: "conversation", floatingChatCase: "running" },
  beforeEach: async () => {
    client.store.setState((state) => ({
      sessionWindows: { ...state.sessionWindows, running: "chat" },
      runStates: {
        ...state.runStates,
        conversation: { ...state.runStates.conversation!, state: "idle" },
        running: { ...state.runStates.running!, state: "idle" }
      }
    }))
    showIdleActivities()
    useChatWindowSurface.setState({ sessionId: "running", visible: false })
  }
}

export const ActivityFloatingMultipleHidden: Story = {
  name: "04 隐藏浮窗后多个会话进入后台",
  parameters: { pageStateGroup: "10 活动/02 窗口与会话位置", docs: { description: { story: "浮窗内先后创建的两个会话，在浮窗隐藏后都位于后台，并分别保留浮窗标记。点击其中一个会话，唤回浮窗并打开该会话。" } } },
  args: { sidebarView: "activity", chatCase: "conversation", floatingChatCase: "running" },
  beforeEach: async () => {
    client.store.setState((state) => ({
      sessionWindows: { ...state.sessionWindows, running: "chat", permission: "chat" },
      sessions: { ...state.sessions, permission: { ...state.sessions.permission!, items: [] } },
      sessionList: state.sessionList.map((row) => row.sessionId === "permission" ? { ...row, title: "整理相关资料" } : row),
      runStates: {
        ...state.runStates,
        permission: { ...state.runStates.permission!, state: "running" },
        conversation: { ...state.runStates.conversation!, state: "idle" }
      }
    }))
    showIdleActivities()
    useChatWindowSurface.setState({ sessionId: "running", visible: false })
  }
}

export const ActivityStatusIdle: Story = {
  name: "01 绿色 · 空闲",
  parameters: { pageStateGroup: "10 活动/03 运行状态", docs: { description: { story: "任务已完成并查看，当前会话空闲；也可能是其他空闲会话。" } } },
  args: { sidebarView: "activity", chatCase: "conversation" },
  beforeEach: async () => {
    showIdleActivities()
    client.store.setState((state) => ({ runStates: { conversation: state.runStates.conversation! } }))
  }
}

export const ActivityStatusRunning: Story = {
  name: "02 黄色 · 运行中",
  parameters: { pageStateGroup: "10 活动/03 运行状态", docs: { description: { story: "任务执行中，右侧展示正在处理的会话。" } } },
  args: { sidebarView: "activity", chatCase: "running" },
  beforeEach: async () => { client.store.setState((state) => ({ runStates: { running: state.runStates.running! } })) }
}

export const ActivityStatusAction: Story = {
  name: "03 红色 · 需要处理",
  parameters: { pageStateGroup: "10 活动/03 运行状态", docs: { description: { story: "当前会话等待用户确认，右侧展示需要处理的请求。" } } },
  args: { sidebarView: "activity", chatCase: "permission" },
  beforeEach: async () => { client.store.setState((state) => ({ runStates: { permission: { ...state.runStates.permission!, state: "requires_action" } } })) }
}

export const ActivityStatusUnread: Story = {
  name: "04 蓝色 · 完成未查看",
  parameters: { pageStateGroup: "10 活动/03 运行状态", docs: { description: { story: "后台会话已完成但尚未查看；打开并查看后，状态会转为空闲。右侧显示另一个当前会话。" } } },
  args: { sidebarView: "activity", chatCase: "conversation" },
  beforeEach: async () => {
    showIdleActivities()
    client.store.setState((state) => ({ runStates: {
      conversation: state.runStates.conversation!,
      running: { ...state.runStates.running!, state: "done" }
    } }))
  }
}

export const ActivityHover: Story = {
  name: "01 查看详情和停止",
  parameters: { pageStateGroup: "10 活动/04 活动操作" },
  args: { sidebarView: "activity", chatCase: "conversation" },
  beforeEach: async () => { showIdleActivities() },
  play: async ({ canvasElement, userEvent }) => {
    const row = canvasElement.querySelector<HTMLElement>('[data-session-id="conversation"]')
    if (!row) throw new Error("Running activity is missing")
    fireEvent.keyUp(window, { key: "Meta" })
    fireEvent.keyUp(window, { key: "Control" })
    await userEvent.hover(row)
    // Focus exposes the real row actions; synthetic hover does not activate CSS :hover.
    row.focus()
    const stop = within(row).getByRole("button", { name: /^停止$/ })
    stop.focus()
    await waitFor(() => {
      if (!canvasElement.ownerDocument.querySelector('[data-slot="codex-hover-card"]'))
        throw new Error("Activity detail card is not open")
    })
  }
}

export const Drive: Story = {
  name: "@finture.id 账号 · 显示云盘标签",
  parameters: { pageStateGroup: "11 云盘/01 账号与入口" },
  args: { sidebarView: "drive" }
}

export const PersonalAccount: Story = {
  name: "其他邮箱账号 · 不显示云盘标签",
  parameters: { pageStateGroup: "11 云盘/01 账号与入口" },
  args: { companyAccount: false }
}

export const DriveUnconfigured: Story = {
  name: "云盘 · 尚未配置",
  parameters: { pageStateGroup: "11 云盘/02 配置与项目" },
  args: { sidebarView: "drive", driveCase: "unconfigured" }
}

export const DriveEmpty: Story = {
  name: "云盘 · 没有项目",
  parameters: { pageStateGroup: "11 云盘/02 配置与项目" },
  args: { sidebarView: "drive", driveCase: "empty" }
}

export const DriveProjects: Story = {
  name: "云盘 · 显示项目与资料库",
  parameters: { pageStateGroup: "11 云盘/02 配置与项目" },
  args: { sidebarView: "drive" }
}

export const DriveSyncing: Story = {
  name: "云盘 · 正在上传与下载",
  parameters: { pageStateGroup: "11 云盘/03 同步状态" },
  args: { sidebarView: "drive", driveCase: "syncing" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "YUP Drive" }))
  }
}

export const DrivePaused: Story = {
  name: "云盘 · 同步暂停",
  parameters: { pageStateGroup: "11 云盘/03 同步状态" },
  args: { sidebarView: "drive", driveCase: "paused" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "YUP Drive" }))
  }
}

export const DriveOffline: Story = {
  name: "云盘 · 连接断开",
  parameters: { pageStateGroup: "11 云盘/04 连接与同步异常" },
  args: { sidebarView: "drive", driveCase: "offline" }
}

export const DriveError: Story = {
  name: "云盘 · 同步错误",
  parameters: { pageStateGroup: "11 云盘/04 连接与同步异常" },
  args: { sidebarView: "drive", driveCase: "error" }
}

export const DriveFailedUploads: Story = {
  name: "云盘 · 上传失败详情",
  parameters: { pageStateGroup: "11 云盘/04 连接与同步异常" },
  args: { sidebarView: "drive", driveCase: "failedUploads" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "YUP Drive" }))
  }
}

export const DriveConflicts: Story = {
  name: "云盘 · 文件冲突详情",
  parameters: { pageStateGroup: "11 云盘/04 连接与同步异常" },
  args: { sidebarView: "drive", driveCase: "conflict" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "YUP Drive" }))
  }
}

export const UpdateIdle: Story = {
  name: "无更新 · 不显示更新卡片",
  parameters: { pageStateGroup: "12 更新提示" },
  args: { updateCase: "idle" }
}

export const UpdateIndeterminate: Story = {
  name: "下载更新 · 未知文件大小",
  parameters: { pageStateGroup: "12 更新提示" },
  args: { updateCase: "indeterminate" }
}

export const UpdateDownloading: Story = {
  name: "下载更新 · 42% 进度",
  parameters: { pageStateGroup: "12 更新提示" },
  args: { updateCase: "downloading" }
}

export const UpdateReady: Story = {
  name: "下载完成 · 安装并重启入口",
  parameters: { pageStateGroup: "12 更新提示" },
  args: { updateCase: "ready" }
}

export const UpdateRestarting: Story = {
  name: "安装更新 · 重启处理中",
  parameters: { pageStateGroup: "12 更新提示" },
  args: { updateCase: "restarting" }
}

export const LeadingScreen: Story = {
  name: "底部箭头 · 进入负一屏",
  parameters: { pageStateGroup: "14 屏幕切换" },
  play: clickHeader("进入 -1 屏")
}

export const BackToMain: Story = {
  name: "底部箭头反向 · 返回主屏",
  parameters: { pageStateGroup: "14 屏幕切换" },
  args: { page: "plugins" },
  play: clickHeader("返回主屏")
}

export const AccountMenu: Story = {
  name: "头像与昵称 · 展开完整用户菜单",
  parameters: { pageStateGroup: "15 账号菜单/01 查看账号" },
  play: openAccount
}

export const AccountCreateApp: Story = {
  name: "创建应用 · 打开创建弹窗",
  parameters: { pageStateGroup: "15 账号菜单/02 创建与设备" },
  play: accountItem(/创建/)
}

export const AccountMobile: Story = {
  name: "移动端连接 · 独立设置窗口内容",
  parameters: { pageStateGroup: "15 账号菜单/02 创建与设备", docs: { description: { story: "账号菜单的移动端连接入口打开独立设置窗口的移动端连接页；这里展示该真实页面组件。" } } },
  args: { page: "settings", settingsSection: "mobile" }
}

export const AccountGamepad: Story = {
  name: "Gamepad · 独立工具窗口内容",
  parameters: { pageStateGroup: "15 账号菜单/02 创建与设备", docs: { description: { story: "账号菜单的 Gamepad 入口打开独立工具窗口；这里展示该真实窗口组件。" } } },
  args: { page: "gamepad" }
}

export const AccountPetShow: Story = {
  name: "已装扮且未开启 · 开启 Vibémon 入口",
  parameters: { pageStateGroup: "15 账号菜单/03 伙伴显示" },
  args: { petCase: "hidden" },
  play: openAccount
}

export const AccountPetHide: Story = {
  name: "伙伴已开启 · 关闭 Vibémon 入口",
  parameters: { pageStateGroup: "15 账号菜单/03 伙伴显示" },
  args: { petCase: "desktop" },
  play: openAccount
}

export const AccountPetMissing: Story = {
  name: "未装扮伙伴 · 点击开启后的错误提醒",
  parameters: { pageStateGroup: "15 账号菜单/03 伙伴显示" },
  play: accountItem(/开启 Vibémon/)
}

export const AccountLanguage: Story = {
  name: "语言 · 展开选项与当前语言",
  parameters: { pageStateGroup: "15 账号菜单/04 语言与设置" },
  play: async (context) => { await openAccount!(context); await context.userEvent.click(await within(context.canvasElement.ownerDocument.body).findByRole("menuitem", { name: /语言/ })) }
}

export const AccountSettings: Story = {
  name: "设置 · 打开设置页",
  parameters: { pageStateGroup: "15 账号菜单/04 语言与设置" },
  play: accountItem(/^设置/)
}

export const AccountSignOut: Story = {
  name: "退出登录 · 返回登录页面",
  parameters: { pageStateGroup: "15 账号菜单/05 退出登录" },
  render: (args) => <AuthGate><ProductPreview {...args} /></AuthGate>,
  play: accountItem(/退出/)
}

export const HelpMenu: Story = {
  name: "问号入口 · 快捷键与用户指南",
  parameters: { pageStateGroup: "16 帮助" },
  play: clickHeader("帮助")
}

export const Hotkeys: Story = {
  name: "快捷键入口 · 打开快捷键说明",
  parameters: { pageStateGroup: "16 帮助" },
  play: async (context) => { await clickHeader("帮助")!(context); await context.userEvent.click(await within(context.canvasElement.ownerDocument.body).findByRole("menuitem", { name: /快捷键/ })) }
}

export const Guide: Story = {
  name: "用户指南 · 独立窗口内容",
  parameters: { pageStateGroup: "16 帮助", docs: { description: { story: "真实产品通过帮助菜单打开独立的使用指南窗口。此示例直接展示该窗口的内容，网页预览不会创建原生窗口。" } } },
  args: { page: "guide" }
}
