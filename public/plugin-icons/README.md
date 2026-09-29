# Agent 插件图标

来源：[Figma skills-icon](https://www.figma.com/design/Czv28C4lMYwyYj6jGHhTA7/skills-icon?node-id=1-1032)。

从 36 × 36 图标节点导出原始 SVG，使用 `contentsOnly: true` 排除外层展示卡片、背景和标签，未修改矢量内容。此图标集由用户提供给 ALwith U 使用；Figma 链接本身不代表第三方开源授权。

仅 Agent 插件列表使用此图标集，Skills 和应用扩展保留原有图标逻辑。分配依据插件原始名称（非翻译后的显示名称），采用 Desktop 的哈希算法（乘 31、模 997），映射到 `src/features/plugins/plugin-icon.tsx` 中固定排序的图标池。更改图标池或插件名称可能改变分配结果；不同名称可能共用同一图标。

## 来源节点

| 资源 | Figma 节点 |
| --- | --- |
| agent-mode.svg | 1:1034 |
| application-window.svg | 1:1041 |
| audiowave.svg | 1:1048 |
| bar-chart.svg | 1:1054 |
| block-stack-skills.svg | 1:1060 |
| book-open.svg | 1:1067 |
| briefcase.svg | 1:1076 |
| bubble-on-bubble.svg | 1:1086 |
| checkmark-circle.svg | 1:1095 |
| code.svg | 1:1103 |
| compass.svg | 1:1109 |
| components-window.svg | 1:1114 |
| credit-card.svg | 1:1123 |
| csv.svg | 1:1130 |
| document.svg | 1:1141 |
| docx.svg | 1:1147 |
| exclamationmark-bubble.svg | 1:1153 |
| figma-document.svg | 1:1161 |
| figure-text-document.svg | 1:1170 |
| file-video.svg | 1:1177 |
| flash.svg | 1:1183 |
| folder.svg | 1:1193 |
| game-controller.svg | 1:1198 |
| globe.svg | 1:1205 |
| heart.svg | 1:1211 |
| heart-bubble.svg | 1:1217 |
| heart-text-clipboard.svg | 1:1223 |
| hierarchy.svg | 1:1230 |
| jpg-document.svg | 1:1236 |
| kettlebell.svg | 1:1247 |
| ladybug.svg | 1:1252 |
| lightbulb.svg | 1:1262 |
| lightning-bolt.svg | 1:1269 |
| magnifingglass.svg | 1:1275 |
| map.svg | 1:1282 |
| mappin.svg | 1:1290 |
| microphone.svg | 1:1296 |
| ms-word-document.svg | 1:1305 |
| newspaper.svg | 2:41 |
| paperclip.svg | 1:1319 |
| pdf-document.svg | 1:1331 |
| pencil.svg | 1:1341 |
| phone.svg | 1:1347 |
| photo.svg | 1:1353 |
| png-document.svg | 1:1360 |
| pointer.svg | 1:1370 |
| ppt-document.svg | 1:1376 |
| pptx.svg | 1:1382 |
| puzzle.svg | 1:1388 |
| radar.svg | 1:1396 |
| shield.svg | 1:1402 |
| shopping-bag.svg | 1:1408 |
| skill-creator.svg | 1:1488 |
| skill-installer.svg | 1:1479 |
| star-app.svg | 1:1415 |
| star-bookmark.svg | 1:1420 |
| template-creator.svg | 1:1498 |
| terminal.svg | 1:1425 |
| text-bubble-figure.svg | 1:1432 |
| text-document.svg | 1:1438 |
| text-document-lock.svg | 1:1444 |
| text-note-pointer.svg | 1:1454 |
| triangle-vercel.svg | 1:1461 |
| xls-document-excel.svg | 1:1467 |
| xlsx.svg | 1:1473 |
