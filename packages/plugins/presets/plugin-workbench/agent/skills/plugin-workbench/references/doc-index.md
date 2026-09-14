# 插件开发文档索引（工作台内嵌）

生产环境 **没有** monorepo 的 `docs/plugin`。完整手册已同步到：

```text
<workbenchRoot>/agent/docs/plugin/
```

其中 `workbenchRoot` = `listPlugins()` 中 `id === "plugin-workbench"` 的 `rootPath`。

## 必读顺序（创建/改插件时）

| 顺序 | 文件 | 何时读 |
| --- | --- | --- |
| 1 | `README.md` | **总是先读**：能力矩阵、信任模型、导航 |
| 2 | `getting-started.md` | scaffold / 首次写代码 / 构建安装调试 |
| 3 | `manifest.md` | 写/改 `plugin.json`、guidingWords、settings、**贡献智能体与团队**、版本与安装目录 |
| 4 | `permissions.md` | 选定权限列表、向用户确认授权前 |
| 5 | 按扩展点选读下方「按需」 | 只读相关章节，避免盲写 |

## 按需

| 文件 | 何时读 |
| --- | --- |
| `ui-slots.md` | **notify 全局 Toast/错误堆栈** / global / file-preview / activity-tab / input-action / **new-session-context** / **turn-card** / **tool-call 槽** / hardIsolation |
| `conversation-and-agent.md` | 对话、registerTool、**command.run**、fs、images、settings、**i18n** |
| `message-cards.md` | 消息下方卡片、`details.cards`、registerCardRenderer |
| `mcp.md` | **MCP 三源聚合**、插件内聚 MCP 清单与命名 |
| `styling-and-pitfalls.md` | 样式、MF 顶层 JSX 陷阱、缓存与 version bump、Tailwind |
| `system-plugins.md` | 系统插件 / 租户打包；用户插件一般不必深入 |

## Agent 读取方式

1. 解析 `workbenchRoot`（见主 skill）。
2. 用 **read 工具**打开绝对路径，例如：  
   `read <workbenchRoot>/agent/docs/plugin/README.md`
3. 实现某一扩展点前，再 read 对应文件（不要凭记忆瞎写 API）。
4. 相对链接（如 `./manifest.md`）在包内仍有效；路径按上表解析到同目录。

## 与工作台脚本

| 脚本 | 路径 |
| --- | --- |
| scaffold | `<workbenchRoot>/scripts/scaffold.mjs` |
| check-manifest | `<workbenchRoot>/scripts/check-manifest.mjs` |
| bump-version | `<workbenchRoot>/scripts/bump-version.mjs` |
| build-and-pack | `<workbenchRoot>/scripts/build-and-pack.mjs` |
| sync-docs（开发） | `<workbenchRoot>/scripts/sync-plugin-docs.mjs` |

构建/打包 **必须**走 `build-and-pack.mjs`，不要自创 vite 打包流程（除非文档明确要求且用户环境一致）。
