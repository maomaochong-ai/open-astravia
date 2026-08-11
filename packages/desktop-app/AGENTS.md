# Team: Frontend Apps

> 本包属于 **Frontend Apps Team**，同组包：`packages/admin`

## 职责范围

Electron 桌面应用，提供 AI Coding Agent 的图形化界面。

## 技术栈

- Electron 34 + Vite + React 19
- TailwindCSS 4 + Jotai 状态管理
- Shiki 代码高亮
- TanStack Router (hash history, 适配 Electron file:// 协议)
- shadcn/ui 组件库

## 项目结构

```
src/
  main/                — Electron 主进程
    ipc/               — 按领域拆分的 IPC handler
      session.ts         会话管理
      settings.ts        配置读写
      updater.ts         应用更新
      skills.ts          技能安装/卸载
      dialog.ts          系统对话框
      fs.ts              文件系统操作
      scheduler.ts       定时任务
      index.ts           聚合注册
    scheduler/         — 定时任务执行引擎
    window-manager.ts  — 窗口创建与管理
    tray-manager.ts    — 系统托盘
    main.ts            — 生命周期编排（精简壳）
    updater.ts         — 自动更新
  preload/             — 安全上下文桥接
  renderer/            — React 渲染进程
    domains/           — 按业务领域组织
      chat/              聊天核心
        components/        ChatPage, ChatView, InputBar, MessageList, blocks/...
        hooks/             useSessionManager, useAppInit
        services/          chat-service.ts (消息处理纯函数 + 流式状态)
      project/           项目与侧边栏
        components/        Sidebar, ProjectsPanel, ProjectGroup, AddProjectMenu...
        hooks/             useProjects
      file-explorer/     文件浏览器
        components/        FilesPanel, FileTree, FileTreeNode, FileContextMenu...
        hooks/             useFileTree
      activity-panel/    文件预览面板
        components/        ActivityPanel, FilePreview, previews/...
        hooks/             useActivityPanel
      scheduler/         定时任务
        components/        AutomationPage, TaskForm, TaskList, schedule-picker/...
        hooks/             useScheduledTasks, CRON_PRESETS
      auth/              认证
        components/        LoginDialog
        hooks/             useAuth
      settings/          设置（拆分为独立子页面组件）
        components/        SettingsPage, GeneralSettings, ModelsSettings, McpSettings...
      skills/            技能市场
        components/        SkillsPage
    shared/            — 跨领域公共代码
      components/ui/     shadcn 基础组件 (Button, Dialog, Input, Select...)
      components/        TitleBar, ResizeHandle, WelcomeScreen, UpdateChecker...
      hooks/             useTheme, useShortcuts（全局 app 层快捷键）
      shortcuts/         ShortcutScopeStack + useShortcutScope（作用域快捷键中心）
      lib/               utils, platform, shortcuts（绑定读写）, api
      store/             Jotai atoms（按领域拆分 + re-export hub）
        atoms.ts           re-export hub（所有消费者从这里导入）
        chat-atoms.ts      聊天相关 atoms
        project-atoms.ts   项目相关 atoms
        file-atoms.ts      文件浏览器 atoms
        activity-atoms.ts  预览面板 atoms
        scheduler-atoms.ts 定时任务 atoms
        auth-atoms.ts      认证 atoms
        ui-atoms.ts        主题、确认对话框等 UI atoms
      types/             全局类型声明
    App.tsx            — RootLayout 壳组件（~70行）
    router.tsx         — TanStack Router 路由定义
    main.tsx           — 入口
```

### 路径别名

- `@shared/*` → `src/renderer/shared/*`
- `@domains/*` → `src/renderer/domains/*`
- `@preload/*` → `src/preload/*`

## **CRITICAL** 开发规范 **CRITICAL**

### 0. UI 改动必读 DESIGN.md

**修改 `src/renderer/**` 任何 `.tsx` / `.css`、`shared/components/ui/**`、或新增 `motion/react` 动画前，必须读 [`DESIGN.md`](./DESIGN.md)。**
该文件定义颜色 token / 卡片阴影 / 圆角 / 间距 / 动画 / 图标 / 桌面端 drag-region 等的硬性规则，违反即视为不合格 PR。

### 1. 不要重复造轮子

**UI 组件**：所有操作按钮（提交、保存、取消、删除、安装等）**必须**使用 `@shared/components/ui/button` 的 `Button` 组件，不要用原生 `<button>` 手写样式。Button 提供以下 variant：

| Variant | 用途 | 示例 |
|---------|------|------|
| `default` | 主要操作（保存、创建、发送） | `<Button>保存</Button>` |
| `outline` | 次要操作、带边框 | `<Button variant="outline">取消</Button>` |
| `ghost` | 轻量操作、工具栏按钮 | `<Button variant="ghost" size="icon-xs">` |
| `destructive` | 危险操作（删除） | `<Button variant="destructive">删除</Button>` |
| `secondary` | 辅助操作 | `<Button variant="secondary">` |

**允许使用原生 `<button>` 的场景**：导航项、菜单项、列表选择项、标签切换、展开/折叠 toggle、窗口控件等**布局交互元素**。

**其他 UI 组件**：优先使用 `@shared/components/ui/` 下已有的 shadcn 组件（Dialog, Input, Select, Switch, Textarea, Tooltip, Popover, Calendar 等）。新增 UI 组件前先检查是否已存在。

### 2. 遵循领域结构

- 新功能代码放入对应的 `domains/<领域>/` 目录
- 跨领域共享的代码放入 `shared/`
- 可主题化的纯 UI 展现组件放入 `@vetta/theme-ui`；desktop-app 领域层只保留数据加载、状态、i18n 与事件适配，通过 props/view model 驱动 UI。
- **不要**在 `domains/` 外面创建新的顶层目录（如 `components/`, `hooks/`, `lib/`）
- 每个领域内部结构：`components/`, `hooks/`, `services/`（按需）
- 领域间通过 `@shared/store/atoms` 共享状态，不要跨领域直接 import 其他领域的内部模块

### 3. 状态管理

- 使用 Jotai atoms 管理全局状态
- 新增 atom 放入对应领域的 `shared/store/<领域>-atoms.ts`
- 在 `shared/store/atoms.ts` re-export hub 中添加 re-export
- 所有消费者统一从 `@shared/store/atoms` 导入

### 4. 路由

- 使用 TanStack Router 静态路由模式（`createRoute` + `createHashHistory`）
- 路由定义在 `router.tsx`
- 页面切换通过 `useNavigate()` 而非 atom，**不要用 atom 做页面切换**
- RootLayout (`App.tsx`) 只负责布局壳，页面内容通过 `<Outlet />` 渲染

### 5. 主题与样式

- 使用项目 CSS 变量（`var(--text-1)`, `var(--hover)`, `var(--border)`, `var(--accent)` 等）
- **不要**使用 Tailwind 语义色（`bg-primary`, `text-foreground` 等），这些未在项目中配置
- shadcn 组件的样式已经对齐到项目 CSS 变量
- 图标优先使用 solar 图标集（`icon-[solar--*-linear]`，统一 linear 风格），其次 mdi；详见 DESIGN.md §6

### 6. IPC 通信

- 渲染进程通过 `window.vetta.*` 调用主进程功能
- 新增 IPC handler 放入 `main/ipc/<领域>.ts`
- 在 `main/ipc/index.ts` 中注册
- preload 层定义类型契约

### 7. i18n 国际化（**面向用户的文案一律不硬编码**）

本应用已接入 i18next + react-i18next（背景与架构见 [`docs/adr/0031`](../../docs/adr/0031-desktop-i18n-i18next-semantic-keys-main-owned-language.md)）。**所有面向用户的文案必须走 i18n，禁止硬编码中文字符串**——包括新写的代码和你改到的旧代码里新增的文案。

**catalog 与命名空间**
- 文案存 `src/shared/i18n/locales/{zh,en}/<ns>.json`，**zh 为准、en 后填**，缺译自动回退 zh（`fallbackLng=zh`，绝不暴露原始 key）。
- 按 domain 分 ns：`common`（按钮等基础件）、`main`（主进程原生 UI）、`chat` / `settings` / … 各 domain 一个 ns。
- key 用**语义点路径**，按组件/特性分组：`t("inputBar.placeholder.defaults")`、`t("newSession.subtitle")`。

**怎么取文案**
- React 组件：`const { t } = useTranslation("<ns>")`，用**裸 key**：`t("group.leaf")`。带插值：catalog 里写 `{{var}}`，调用 `t("k", { var })`。内嵌 JSX（含 `<b>`/`<a>` 等）用 `<Trans i18nKey="<ns>:k">…</Trans>`。跨 ns 取词用前缀并把该 ns 绑进 hook：`useTranslation(["chat","common"])` 后 `t("common:actions.cancel")`。
- 非组件（`.ts` hook / service）：**不要用 `useTranslation`**，改 `import { i18n } from "@shared/i18n"` 然后 `i18n.t("<ns>:key")`（**带 ns 前缀**）。
- 主进程（托盘菜单 / 系统通知 / 原生 dialog）：`import { mainT } from "../i18n/index.js"`，`mainT("tray.showWindow")`，文案进 `main` ns。

**铁律**
- **模块级常量不准存中文。** 形如 `const MODE_OPTIONS = [{ label: "沙盒受限" }]` 一律禁止——改成存 i18n key（或只留 `mode`/`icon`），渲染期用 `t()` 解析；或把常量挪进组件内。
- key 写错 / 不存在会被 **tsc 拦下**（`i18next.d.ts` 基于 zh 资源做了类型增强，有自动补全）。
- **新增 ns** 要在三处注册：`src/shared/i18n/config.ts` 的 `NAMESPACES`、`src/shared/i18n/resources.ts`、`src/renderer/shared/i18n/i18next.d.ts`。
- **不抽**：代码注释、日志（`*.warn`/`console`）、发给 LLM 或协议/IPC channel 的串——保持原样。
- 增量推进：尚未抽离的 domain 仍是硬编码中文，**改到这些 domain 时，新增文案必须走 i18n**，并尽量顺手把所在文件抽干净（流程：发现文案 → 给语义 key → 包 `t()`/`<Trans>` → 文案进对应 ns 的 zh.json）。

### 8. 快捷键（**禁止 ad-hoc `window/document.addEventListener("keydown")`**）

渲染层快捷键走 **统一作用域栈**，不要在组件里各自挂 `keydown`。

**代码位置**
- 栈与匹配：`src/renderer/shared/shortcuts/`（`ShortcutScopeStack`、`useShortcutScope`）
- 全局可配置动作：`src/shared/shortcuts.ts`（`SHORTCUT_ACTIONS`）+ `useGlobalShortcuts`（注册 `kind: "app"`）
- 键串格式与 `matchesShortcut`：`src/renderer/shared/lib/platform.ts`（如 `mod+s`、`arrowleft`、`escape`）

**作用域 kind（高 → 低）**

| kind | 用途 | 示例 |
|------|------|------|
| `modal` | 对话框，常 `exclusive: true` | 确认删除、更新重启 |
| `overlay` | 浮层面板 | 命令面板、@ 文件、skill picker |
| `surface` | 当前主内容面 | 文件预览/图廊、项目详情编辑 |
| `app` | 全局可配置快捷键 | Cmd/Ctrl+N 新建会话、Cmd/Ctrl+S 保存文件 |

同 kind 内后注册优先。匹配到绑定则 `preventDefault` + `stopPropagation`；`exclusive` 的 scope 未命中也不再向下传。

**怎么写**

```ts
import { useShortcutScope } from "@shared/shortcuts";

useShortcutScope({
  id: "surface:file-preview", // 稳定 id，便于排查
  kind: "surface",
  active: previewOpen,        // false 时不注册
  exclusive: false,
  bindings: [
    { key: "arrowleft", run: goPrev, when: "not-editable" },
    { key: "escape", run: onClose, when: "not-editable" },
  ],
});
```

- `when`：`always`（默认）| `editable` | `not-editable`。编辑器（CodeMirror contenteditable）内要留给光标的键用 `not-editable`，避免预览 ←→ 抢走方向键。
- **theme-ui 视图不绑全局键**；快捷键在 desktop-app 的 hook/model 里用 `useShortcutScope` 注册。
- 设置页「全局快捷键」只覆盖 `SHORTCUT_ACTIONS`；surface/overlay 的导航键一般写死合理默认，不必进设置。
- 新增可配置全局动作：先扩 `src/shared/shortcuts.ts` 的 `SHORTCUT_ACTIONS`，再在 `useRootLayoutModel` 的 handler 里处理。

**反例（禁止）**

```ts
// BAD — 与栈并行抢键，作用域混乱
useEffect(() => {
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
```

### 9. 测试（**重要行为必须在测试阶段暴露错误**）

本包同时包含 Node/Electron 主进程、preload 合同和 React Renderer。必须先按根目录规则判断测试是否为必选项，再按错误实际发生的层级选择工具；不能用纯函数测试或手工启动替代组件接线、IPC 或 Electron 边界测试。

| 被测对象 | 必选工具与环境 | 适用重点 |
|----------|----------------|----------|
| 纯函数、策略、映射、校验 | Vitest，默认 `node` 环境 | 边界值、错误分支、状态转换，不加载 DOM |
| React 组件、Hook、Jotai 与路由交互 | Vitest + `jsdom` + React Testing Library；用户输入优先 `@testing-library/user-event` | 按用户可见文本、role、label、状态和副作用断言 |
| 依赖底层 DOM/Pointer/Drag API 的行为 | `jsdom` 中使用 React `act()`、`createRoot` 和必要的原生事件；仅在 Testing Library 无法准确表达时使用 | 拖拽、portal、尺寸或浏览器 API 适配 |
| preload、IPC 和主进程服务 | Vitest `node` 环境，在 Electron/系统 API 边界使用窄 fake；生产者与消费者使用同一合同夹具 | channel、参数、返回值、错误和权限边界 |
| 真实窗口、跨进程、原生菜单、打包启动 | WebdriverIO/Electron E2E | 只覆盖低层测试无法证明的关键路径 |
| 启动连通性、UI 观感、布局和主题 | `verify:ui:*` 与截图检查 | 作为环境与视觉补充，不是功能测试 |

以下 Renderer 变更必须有 React 组件或 Hook 测试，不能只测抽出的纯函数：

- 条件渲染、空态、loading/error/retry、按钮可用性或权限导致的 UI 差异。
- 点击、输入、提交、选择、键盘、焦点、Dialog/Popover、拖拽和快捷键作用域行为。
- Router、TanStack Query、Jotai、Context、i18n 或 `window.vetta` 数据与组件之间的接线。
- aria role/name、label、焦点恢复等会影响可访问操作的语义。

组件测试应挂载满足行为所需的最小 Provider 和组件子树，优先使用 `getByRole`、`getByLabelText`、可见文案和最终用户状态查询；不要依赖 class 名、脆弱 DOM 层级或大面积快照。异步更新使用 Testing Library 的异步查询或 `waitFor`，不要用任意延时。

当前包已经配置 Vitest 和 `jsdom`，但尚未在自身 `devDependencies` 声明 React Testing Library。首次新增适合上述组件测试的行为时，应在同一任务补齐 `@testing-library/react`、`@testing-library/user-event`、统一 setup，并让 Vitest 收集 `*.test.tsx`，同时更新锁文件；不得依赖其他 workspace 偶然提升的依赖。已有 `createRoot` 测试可以渐进保留，不要求为形式批量改写。

`jsdom` 不实现真实布局、完整 Pointer/Drag、Electron 和原生窗口行为。此类差异会影响正确性时，必须增加对应 E2E 或 UI 验证；若要改用 `happy-dom`，应先证明其更适合目标行为并统一相关测试，不在同一类测试中随意混用环境。

跑测：包内 `bun run test`，或仓库根 `bunx vitest --run <具体 test 路径>`。涉及真实 Electron 行为时运行定向 `bun run test:e2e`；需要启动连通性或视觉检查时再使用规定的 `verify:ui:*` 流程。改完至少跑通本次新增/改动测试及受影响的现有测试。

## 缓存规范

主进程需要持久化可重新生成或重新下载的内容时，统一使用
`src/main/cache/application-cache-service.ts` 的 `ApplicationCacheService`，并为每个业务模块分配独立的
kebab-case namespace。默认根目录为 `~/.vetta/cache/`，例如 Marketplace 使用
`~/.vetta/cache/marketplace/`；不要再直接拼接 `*-cache` 或 `open-marketplace` 目录。

缓存中不得保存用户配置、安装台账、正式安装内容、凭证或其他不可重建数据。删除某个 cache namespace
必须不影响其他 namespace 和正式功能；临时文件使用 namespace 的 `createTemporaryDirectory()`，需要清理时使用
`clear()`。新增缓存使用方时应补充命名空间隔离、路径逃逸和清理边界测试。

## 配置迁移

持久化 JSON 配置需要演进结构时，复用 `packages/toolkit/src` 提供的迁移能力：
纯 `schemaVersion` 转换使用 `@vetta/toolkit/versioned-config`，文件读写可使用
`@vetta/toolkit/config-store`。业务 schema 与连续 migration 留在 desktop-app 对应领域内，
不要在业务模块重复实现迁移框架。

## 日志规范

desktop-app 的文本日志统一由 `src/main/logger.ts` 管理。新增或修改日志时，优先使用这里的入口，不要直接手写 `appendFileSync`、`console.log` 文件重定向，或重新实现独立轮转逻辑。

### 日志位置

```text
~/.vetta/desktop-app/logs/
├── main/YYYY-MM-DD.log
├── render/YYYY-MM-DD.log
└── im/YYYY-MM-DD.log
```

- `main/`：主进程日志，包含生命周期、诊断、窗口事件、IPC、runtime、action 等主进程模块。
- `render/`：浏览器渲染进程日志。由 `BrowserWindow.webContents` 的 `console-message` 事件转发到主进程后写入。
- `im/`：IM sidecar / im-gateway 相关日志。IM 设置页最近日志仍来自内存环形缓冲，但同一批日志也会持久化到这里。

不要再把当天日志写到 `main.log`。旧版本遗留的 `~/.vetta/desktop-app/logs/main.log` 会在启动时迁移到 `main/legacy.*.migration.log`。

### 使用方式

```ts
import { getAppLogger } from "./logger.js";

const log = getAppLogger("window");
log.info("created");

const renderLog = getAppLogger("renderer", "render");
renderLog.warn("renderer warning");

const imLog = getAppLogger("sidecar", "im");
imLog.debug("sidecar debug message");
```

- `scope`：模块名，只用于日志行标识，例如 `window`、`diagnostics`、`sidecar`。
- `type`：日志分类，可选值为 `"main"`、`"render"`、`"im"`；默认是 `"main"`。

日志行格式：

```text
[2026-06-10T14:03:22.123+08:00] [info] [window] created
```

### 轮转策略

- 每条日志按北京时间写入对应日期文件。
- 跨日时由 `electron-log` 的 `resolvePathFn` 自动切换到新的 `YYYY-MM-DD.log`，不通过定时器重命名当天文件。
- 单文件超过 `5MB` 时触发大小轮转，归档文件仍留在同一分类目录下。
- 最近 `10` 个日期会保留；同一天的所有轮转分片一起保留。
- 如果大小轮转时重命名失败，会保留当前日志文件最后 `256KB`，避免清空整个日志文件。

### 进程日志路径

- 主进程启动诊断会调用 `configureAppLogging()` 和 `patchConsoleToAppLogger()`，把主进程 `console.log/info/warn/error` 转到 `main` 日志。新增主进程代码时优先使用显式 logger；只有临时诊断或已有代码路径可以继续走 `console.*`。
- 渲染进程不要直接写主进程文件。当前路径是 `renderer console.* -> webContents console-message -> getAppLogger("renderer", "render")`，相关实现见 `src/main/window-manager.ts`。
- IM sidecar 日志路径是 `im-gateway stdout NDJSON -> SidecarManager -> ImHost.pushLog()`，相关实现见 `src/main/im-host/sidecar-manager.ts`、`src/main/im-host/index.ts`、`src/main/im-host/log-buffer.ts`。`LogBuffer` 只负责 UI 最近日志展示，不负责持久化。

### 日志注意事项

- 不要记录 API key、Authorization、Cookie、IM App Secret、完整凭据或用户隐私内容。
- 不要新增直接文件写入日志逻辑；需要新分类时先扩展 `AppLogType` 和 `APP_LOG_TYPES`。
- 不要用 `main.log` 作为当前日志文件。
- 不要依赖 `electron-log` 的内部 `File.reset()`、`File.crop()` 等非公开 API。
- 文本日志和 AI 请求调试 JSON 分开管理；`debug-writer.ts` 的请求快照不属于文本日志轮转。

## 开发注意事项

### UI 验证入口（暂行）

`bun run verify:ui:*` 目前仅用于检查 desktop-app 的启动与连接问题，不用于 UI 功能测试；相关验证能力尚未完善。

### bun dev 前置依赖构建

`desktop-app` 的主进程（`src/main/`）依赖 workspace 中的其他包（`@vetta/ai`、`@vetta/agent-core`、`@vetta/coding-agent` 等）。这些包的 `dist/` 目录必须先构建，否则 `build:main` 会报 "Failed to resolve entry for package" 错误。

**首次运行或依赖变更后**，必须先执行以下构建命令：

```bash
# 按依赖顺序构建 workspace 包
cd packages/ai && bun run build              # @vetta/ai
cd packages/agent && bun run build            # @vetta/agent-core
cd packages/tui && bun run build             # @mariozechner/pi-tui
cd packages/coding-agent && bun run build    # @vetta/coding-agent

# 然后即可启动 desktop-app 开发服务器
cd packages/desktop-app && bun dev
```

## 注意事项

- 与 `admin` 包完全独立，可安全并行开发
- 消费 `@vetta/runtime-core` 的事件契约，契约变更需同步适配
- 主进程和渲染进程通过 IPC 通信，注意安全边界
- desktop-app 类型检查：仓库根目录 `bun run check` **已包含** `bunx tsc --noEmit -p packages/desktop-app/tsconfig.json`（在 Biome + monorepo `tsgo` 之后）。
- 单独排查时也可：`cd packages/desktop-app && bunx tsc --noEmit`，或在仓库根目录 `bunx tsc --noEmit -p packages/desktop-app/tsconfig.json`。不要在仓库根目录裸跑 `bunx tsc --noEmit`（那会用根 tsconfig，**查不到** desktop-app / i18n 等类型错误）。
