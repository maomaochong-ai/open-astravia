# 移除交互式终端（TUI）产品线，coding-agent 退为 print/RPC/SDK 三模式

本项目不再需要终端交互产品（用户的交互前端是 desktop）。但 `coding-agent` 不能整包删——desktop 经 `--agent-rpc` 拉起它跑 RPC 模式，且 `runtime-core / runtime-mcp / runtime-tools / runtime-storage` 与 desktop 的 7 个文件都 import 它的非 UI 能力（`getAgentDir`、`AuthStorage`、`ModelRegistry`、`PERSONAS`、`DefaultResourceLoader` 等）。

决定：精确切除交互层而非删包。删除 `packages/tui`（`@mariozechner/pi-tui`）整包、`coding-agent/src/modes/interactive/` 的交互宿主与全部终端 UI 组件、`pi config` / `--resume` 交互选择器；`main()` 在无 `--print`、无 `--mode` 时报错退出而非进 REPL。`coding-agent` 自此只剩 print / RPC / SDK 三模式。

关键约束是扩展系统：它的事件/钩子内核（工具包装、事件总线、沙箱授权提示）在所有存活模式（含 desktop RPC）下都加载，**不能删**；只有它的 UI 表面耦合 pi-tui。调查确认唯一存活的外部消费者 `runtime-core/sandbox-permissions.ts` 只用 `ctx.hasUI` / `ctx.ui.confirm` / `ctx.ui.requestSandboxGrant`（宿主无关原语），不碰任何 tui 类型方法。

但扩展 UI 表面并非死代码：RPC 宿主把 `setWidget` / `setHeader` / `setFooter` 转发给 desktop 渲染，HTML 导出调用工具自定义渲染器的 `Component.render(width)`。故保留这些方法的签名，把 `@mariozechner/pi-tui` 的类型（`Component` / `TUI` / `EditorComponent` / `AutocompleteItem` 等）替换为 `src/core/extensions/ui-types.ts` 的本地结构化替身，并把 `KeyId`、`DEFAULT_EDITOR_KEYBINDINGS` 内化进 `src/core/keybindings.ts`。

## Considered Options

- **只删 packages/tui，保留交互模式**：不可行——交互宿主重度依赖 pi-tui。被否。
- **连 coding-agent 一起删**：会断掉 desktop 的 RPC agent 与全部 runtime-\* 消费者。被否。
- **保留 packages/tui 作扩展子系统的休眠内部依赖**（最小改动）：仓库里仍留一个无产品的 tui 库，与"彻底移除"目标不符。被否。
- **彻底删 pi-tui + 本地类型替身**（采纳）：包消失，扩展↔宿主契约用本地最小类型承接，对所有存活消费者零破坏。

## Consequences

- `coding-agent` SDK 入口不再导出 `InteractiveMode` 与交互组件（`CustomEditor` / `BorderedLoader` / `*Component` / `*Selector`）及终端渲染主题函数；依赖这些的第三方 SDK 用法会断（本仓无存活消费者）。
- 扩展 UI 方法签名保留但失去精确 tui 类型（替身较松）。这些方法在无终端宿主时本就走 RPC 转发或 no-op，运行期行为不变。
- 删了使用已移除 UI 扩展 API 的示例扩展与交互相关测试；非 UI 的钩子示例与测试保留。
- `theme` 模块仍物理留在 `src/modes/interactive/theme/`（被 export-html / resource-loader / extensions 复用，且 `config.ts` 的 `__dirname` 打包路径逻辑绑定其位置），只剥掉了返回 pi-tui 主题对象的 4 个渲染函数。
- `coding-agent/docs/extensions.md` 与 README 中描述交互 UI / 终端组件的章节成为待清理的文档欠债（链接到已删的 `docs/tui.md`）。
