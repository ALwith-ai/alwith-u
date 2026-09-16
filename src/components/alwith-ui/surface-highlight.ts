/**
 * 侧栏「一行被指到 / 被选中」的底色 —— 全侧栏共用这一份。
 *
 * 用半透明叠加而不是 `bg-accent` 这类实色 token:玻璃底板撤掉后,行背后直接是毛玻璃 + 壁纸,
 * 实色压上去像贴了张纸;低透明度的 foreground 叠加是「把底下压暗/提亮一点」,壁纸纹理仍透得过来,
 * 亮暗主题自动反向。这是本项目「禁止自造半透明」的一处明确例外(2026-07-26 用户指定)。
 *
 * 两个常量差别**只在属性写法**:shadcn `Item` 用 `data-[active=true]`,shadcn `Sidebar`
 * 的菜单按钮用 `data-active` / `active:`。数值必须一致 —— 上面菜单与下面列表 hover 观感不同
 * 就是各写各的造成的(2026-07-26 用户指出)。Tailwind 只认字面量,所以不能拼接复用。
 */

/** Codex list token: hover 8%，选中 5%；hover 比静态选中更强。 */
export const ROW_HIGHLIGHT = "hover:bg-foreground/8 data-[active=true]:bg-foreground/5"

/** 导航菜单按钮。 */
export const MENU_HIGHLIGHT = "hover:bg-foreground/8 data-active:bg-foreground/5"
