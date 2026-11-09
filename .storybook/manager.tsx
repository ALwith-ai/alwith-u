import React from "react"
import { addons } from "storybook/manager-api"

addons.setConfig({
  sidebar: {
    renderLabel: (item) => {
      const feature = item.type === "group" && ["04 新聊天", "异常状态"].includes(item.name)
      const category = item.type === "component" && ["连接异常", "创建失败"].includes(item.name)
      if (!feature && !category) return item.name
      return (
        <span className={`sidebar-feature-label${category ? " sidebar-category-label" : ""}`}>
          <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden="true">
            {React.createElement("use", { href: category ? "#icon--group" : "#icon--component" })}
          </svg>
          {item.name}
        </span>
      )
    }
  }
})
