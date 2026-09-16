# 插件开发文档索引

手册**不在工作台包里**，它随 `@vetta-org/plugin-sdk` 装进**被编辑工程自己的** `node_modules`。
这样读到的合同与该工程实际编译的 SDK 版本一致——随 App 发版的内嵌副本做不到这一点。

## 先拿到手册路径

```bash
node "<workbenchRoot>/agent/cli/vetta-plugin-cli.js" docs --json
```

`workbenchRoot` = `listPlugins()` 中 `id === "plugin-workbench"` 的 `rootPath`。

返回：

| 字段 | 含义 |
| --- | --- |
| `manualDir` | 手册目录绝对路径 |
| `entry` | `README.md` 绝对路径 |
| `sdkVersion` | 这份手册对应的 SDK 版本 |
| `project` | 当前命中的插件工程（id、根目录、版本） |
| `hub` | 若其上有能力市场索引，给出路径与 sync 提示 |

工程还没 `npm install` 时会明确报出该装什么——那一步本来也绕不过去，构建需要 SDK。
**不要硬编码 node_modules 路径**：工作区可能把依赖提升到上层，一仓多插件时各插件还可能钉不同版本。

## 必读顺序（创建/改插件时）

以下都相对 `manualDir`：

| 顺序 | 文件 | 何时读 |
| --- | --- | --- |
| 1 | `README.md` | **总是先读**：能力矩阵、信任模型、导航 |
| 2 | `getting-started.md` | 首次写代码 / 构建安装调试 |
| 3 | `manifest.md` | 写/改 `plugin.json`、贡献智能体与团队、settings、版本 |
| 4 | `permissions.md` | 选定权限列表、向用户确认授权前 |
| 5 | 按扩展点选读下方「按需」 | 只读相关章节，避免盲写 |

## 按需

| 文件 | 何时读 |
| --- | --- |
| `ui-slots.md` | **notify 全局 Toast/错误堆栈** / global / file-preview / activity-tab / input-action / **new-session-context** / **turn-card** / **tool-call 槽** / hardIsolation / **工作区视图与接管页头（immersive）** / **侧边栏状态 useSidebarState** |
| `conversation-and-agent.md` | 对话、registerTool、**command.run**、fs、images、settings、**i18n** |
| `message-cards.md` | 消息下方卡片、`details.cards`、registerCardRenderer |
| `mcp.md` | **MCP 三源聚合**、插件内聚 MCP 清单与命名 |
| `styling-and-pitfalls.md` | 样式、MF 顶层 JSX 陷阱、缓存与 version bump、Tailwind |
| `system-plugins.md` | 系统插件 / 租户打包；用户插件一般不必深入 |

## 工程自带的 AGENTS.md

`init` 生成的工程根目录有一份 `AGENTS.md`，内容与本 skill 同源（该读什么、不可违反的几条、
构建安装闭环）。**先读它**——在 Vetta 外用别的 Agent 打开这个工程时，那份是唯一的说明书。

## 内置 CLI

| 命令 | 作用 |
| --- | --- |
| `init --id <slug> --name "<Display>" [dir]` | 起插件工程（含 AGENTS.md） |
| `docs [--json]` | 手册位置与 SDK 版本 |
| `add .` | 装当前工程（**在 Vetta 里优先走面板「应用到 Vetta」**，见主 skill） |
| `reload <id>` / `uninstall [id]` | 应用待生效版本 / 卸载 |
| `watch [--stop]` | 热更新：宿主改从工程目录加载 |
| `sync [--check]` | 能力市场仓库根：对账 `.vetta/marketplace.json` |

## 工作台脚本

| 脚本 | 路径 |
| --- | --- |
| check-manifest | `<workbenchRoot>/scripts/check-manifest.mjs` |
| bump-version | `<workbenchRoot>/scripts/bump-version.mjs` |
| build-and-pack | `<workbenchRoot>/scripts/build-and-pack.mjs` |

构建/打包在工作台里**必须**走 `build-and-pack.mjs`：面板的「应用到 Vetta」依赖它的产物，
且那条安装路径不弹审批 sheet。不要自创 pack 流程。
