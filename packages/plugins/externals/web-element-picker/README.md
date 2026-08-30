# web-element-picker 插件：方案与使用流程

> 状态：v0.2.4 桌面插件已实现并通过全量验证（二期：输入栏入口 / webview 交互修复 / 二次打开加固 / 稳定性 / 设置迁移 / 桥 adapter；v0.2.3：图标自绘 SVG + 地址栏工具栏无填充重设计；v0.2.4：选中框滚动跟随修复）；**三期浏览器扩展（v0.3.2）已实现并通过 Playwright 端到端验证 8/8**（MV3 扩展 + ECDSA 授权码 + popup 控制面，见 §12；v0.3.1：background 改经典 service worker 兼容 Firefox 等外部浏览器；v0.3.2：滚动跟随修复同步内核）；商店上架与收款渠道为运营事项。本文档基于实际代码撰写，与实现保持一致。

## 1. 概述

`web-element-picker` 是 Astravia Desktop 的**外置插件**（`externals/` 目录，不随 App 打包，用户自行安装 zip）。

它把网页元素选择能力带进 App：在插件面板的 **webview** 里打开任意网页，进入选择模式后点选/多选/框选元素，生成**结构化上下文**（CSS 选择器、XPath、语义路径、React 组件链、文本），然后：

- 复制到剪贴板（普通上下文 / Markdown / 复刻报告）
- 截图所选元素并存入插件存储（可随下一次发送自动挂为附件）
- **发送给当前对话的 AI**，让 AI 基于上下文直接改代码

### 1.1 背景

项目源起是 GitHub 上的 `selector-main`（bookmarklet 式视觉元素选择器，v0.4.1，MIT）。最初计划复用其宿主扩展缝隙（`window.__SELECTOR_HOST__` 生命周期钩子），实施时改为**自研内核**（`src/kernel/`）：同样零依赖、页面内注入，但去掉对宿主全局钩子的依赖，通信收敛为单一 `console-message` 桥，为后续浏览器扩展形态留了干净接口。

### 1.2 设计目标

- 与宿主解耦：内核 iife 字符串注入，不 import 任何模块
- 复用内置浏览器分区（`persist:astravia-browser`），登录态与内置浏览器共享
- 用户可见文案全部走 i18n（宿主侧用 `locales/*.json`，内核侧用内置 en/zh 词典）
- App 侧键位不注册全局快捷键，选择器快捷键只在 webview 页面内生效（不污染宿主）
- 页面内交互为「所见即所得」：指令编辑期间暂停选择（防跳转）、F2 可随时暂停/继续

## 2. 架构总览

```
Astravia Desktop (Electron renderer, Module Federation host)
│
├─ plugin.json ── 声明权限、MF remote、styles、i18n
│
├─ src/index.tsx ── activate()：registerActivityTab(「网页选择器」) + registerInputAction(「element-picker」)
│      │  scope_use: conversation / project / cli, initiallyVisible: true
│      │  输入栏 action → plugin-context.ts intent 通道 → 打开/聚焦 Tab + start-select/stop-select
│      ▼
│  WebElementPickerPanel (React 19 + Tailwind v4)
│   │  ● 地址栏 + 工具栏（后退/前进/刷新/系统浏览器/选择/发送给 AI/写轮眼/设置）
│   │  ● <webview allowpopups partition="persist:astravia-browser">（登录态共享）
│   │  ● target=_blank / window.open 经宿主 popup 重定向同窗加载（allowpopups + setWindowOpenHandler→loadURL，与内置浏览器一致）
│   │  ● conversation.sendPrompt 发 AI；storage.putBlob 存截图；ui.setPromptAttachment 挂附件
│   │  ● 设置弹层：语言 / 写轮眼开关+说明（ctx.settings）/ 页内快捷键清单
│  src/kernel/kernel.ts ── Bun.build → iife 字符串 → kernel-bundle.generated.ts
│      │  页面内：hover/click/拖拽框选/键盘导航/指令 popover/复刻报告
│      │  内核 UI：右下角状态胶囊（收起态）↔ 命令面板（展开态：元素列表+快捷键+操作）
│      │  post()：WepBridge adapter（默认 console.log("[wep]"+JSON) ──→ 宿主桥；mount({bridge}) 可换桥）
│      └── 宿主桥消息：mounted / destroyed / mount-failed / selection-changed / copy / send-to-ai / screenshot / open-settings
└─ 使用方：活动 Tab 栏 + 对话输入栏 action
```

### 2.1 数据流

1. 用户在地址栏输入 URL → webview 加载页面
2. 点「开始选择」→ 宿主 `executeJavaScript` 注入内核 iife 并 `mount({lang})`
3. 页面内交互（悬停/点击/框选/方向键）→ 内核状态更新 → `post()` 发 `selection-changed`
4. 复制/发送/截图 → 内核 `post()` 发对应消息 → 宿主桥处理（剪贴板/`sendPrompt`/`capturePage`）
5. 导航时内核随文档销毁 → 宿主在 `did-navigate`/`did-navigate-in-page` 自动重注入，保持连续选择；语言切换实时 `applyLang`，写轮眼开关实时 `applySettings`

## 3. 目录结构

```
web-element-picker/
├── plugin.json                 # 插件声明（id/版本/权限/MF 配置/i18n）
├── package.json                # 构建脚本与依赖
├── README.md                   # 本文档：方案与使用流程
├── tsconfig.json
├── vite.config.ts              # @astravia-org/plugin-vite + @tailwindcss/vite
├── scripts/
│   └── build-kernel.mjs        # 把 kernel.ts 打成 iife 字符串 → generated
├── locales/
│   ├── zh.json                 # 宿主侧 i18n（中文）
│   └── en.json                 # 宿主侧 i18n（英文）
├── src/
│   ├── index.tsx               # 插件入口：activate() 注册活动 Tab
│   ├── plugin-context.ts       # activate 持有的 PluginContext 存取
│   ├── WebElementPickerPanel.tsx  # 面板：地址栏 + webview + 工具栏 + 宿主桥 + 设置弹层
│   ├── style.css               # Tailwind 入口
│   ├── jsx.d.ts                # webview 标签类型声明
│   └── kernel/
│       ├── kernel.ts           # 自研选择器内核（零依赖，页面内运行）
│       └── kernel-bundle.generated.ts  # build-kernel 产物，勿手改
├── dist/                       # vite 构建产物（gitignore）
└── release/                    # 安装包 zip（gitignore，vite build 后自动生成）
```

## 4. 权限与声明（plugin.json）

| 权限 | 用途 |
|---|---|
| `ui.slot.activity-tab` | 注册活动 Tab（无此权限 Tab 不出现） |
| `ui.slot.input-action` | 输入栏 Action 入口（二期已实现：直达/聚焦 Tab + start-select/stop-select） |
| `agent.session.read` | 探测活跃会话（发送给 AI 的前置检查） |
| `agent.session.write` | 调用 `conversation.sendPrompt` 发送上下文 |
| `settings.read` / `settings.write` | 宿主设置体系读写（二期：写轮眼开关等） |
| `storage.read` / `storage.write` | 截图经 `storage.putBlob` 持久化；`lastUrl` 经 `storage.readJson/writeJson` |
| `shell.openExternal` | 「在系统浏览器打开」按钮（`ctx.ui.openExternal`） |

- `runtime: module-federation`，`remoteName: web_element_picker`，expose `./plugin`
- `styles: ["dist/style.css"]`，`defaultLocale: zh`
- 未声明 `agent.skillPaths` → 「/」技能面板里不出现插件名（平台语义）；输入栏入口走 `registerInputAction`（按钮形态，非「/」命令）

## 5. 内核设计

### 5.1 注入链路

- `scripts/build-kernel.mjs` 用 Bun.build 把 `kernel.ts` 打成 **iife 字符串**，写入 `kernel-bundle.generated.ts`（`export default "<code>"`）
- 面板侧把该字符串拼进 `executeJavaScript`：`(() => { <code> window.__WEP__?.mount({lang}) ... })()`
- 内核只暴露 `window.__WEP__`：`{ mount, destroy, applyLang, applySettings, getContext }`
- 选择模式中导航 → 文档销毁 → 宿主自动重注入；语言与写轮眼状态由宿主侧（`ctx.settings` / 插件 storage）保留并在注入后下发
- 注入时先 `mount({lang})` 再 `applySettings({sharingan})`；mount 失败回滚监听器/UI 并上报 `mount-failed`（防僵尸内核吞点击）

### 5.2 选择交互

| 操作 | 行为 |
|---|---|
| 悬停 | 虚线高亮当前元素（`pointerover`，浮层自身除外） |
| 单击 | 单选（替换当前选择，记录撤销历史） |
| Shift + 单击 | 切换加入/移出多选 |
| 拖拽 | 框选（24px 网格 `elementsFromPoint` 采样，排除浮层自身）；Shift+拖拽追加 |
| 方向键 | 在选中元素上移动：↑父 / ↓子 / ←前兄弟 / →后兄弟 |
| Esc | 关闭指令弹层 → 清空选择 → 再次按退出选择模式 |
| F2 | 暂停/恢复（`preventDefault`；暂停期间页面恢复可交互，见 §5.2.1） |

#### 5.2.1 暂停与防跳转（F2 / popover 互斥）

- **F2 暂停**：按下 `F2` 时 `preventDefault` 并翻转 `paused`。暂停期间 `pointerdown/move/up`、`pointerover`、`click` 的选择相关处理全部短路，页面可正常交互；胶囊圆点变琥珀色、文案变「已暂停 · F2」；已选内容仍可复制/发送；再按 F2 恢复。
- **指令 popover 防跳转**：popover 打开期间，`pointerover`/`pointerdown`/点击导航全部暂停——点击浮层外只关闭 popover，不再改选/跳转；键盘只放行 textarea 输入与 Esc 关闭。修复了「写指令时鼠标一动选择就跳走」的问题。
- 两者互斥且状态一致：popover 打开时 F2/方向键/复制快捷键不响应；关闭后恢复。

### 5.3 上下文收集（每个元素）

```
Element: button#submit.btn-primary
CSS selector: #submit > .btn-primary:nth-of-type(2)   // id 优先，class+tag 链，兜底 nth-of-type
XPath: /html/body/div[1]/main/form/button[2]
Semantic path: body > main > form > button
React components: PageHeader > SubmitButton             // 沿 __reactFiber$ 链收集最近 3 个具名组件
Text: 提交订单                                           // 文本节点/叶子文本，截断 120 字符
Instruction: 把按钮改成红色                               // 指令 popover 写入
```

- CSS 选择器：id 优先；否则 class（仅 `[a-zA-Z0-9_-]`）+ tag 链向上；同标签兄弟多时补 `:nth-of-type`；全程 `CSS.escape`
- React 链：`Object.keys(el).find(k => k.startsWith("__reactFiber$"))` 沿 fiber 向上，取最近 3 个具名函数组件
- 上下文组装：`buildContext`（普通）与 `buildMarkdown`（Markdown 格式）两种输出

### 5.4 指令 popover

- 选中元素后点内核浮层「✎ 指令」→ 目标元素旁弹出 textarea（保存到 `instructions: Map<Element, string>`）
- 指令随上下文一起输出（`Instruction: ...` 行），提示 AI 具体修改意图
- popover 位置自动避开视口边缘；`textarea` 自动聚焦；确定/取消/Esc 关闭（见 §5.2.1 防跳转）

### 5.5 复刻模式（写轮眼）

- 面板工具栏「写轮眼模式」开关，经宿主设置体系持久化（`ctx.settings` 读写 `sharingan`，宿主 preload `astravia.plugins.setSettings`，localStorage 降级）；运行中的内核通过 `applySettings({sharingan})` 实时切换
- 开启后内核命令面板出现提示条，复制/发送输出**高保真复刻报告**（`buildSharinganReport`）：

```
# Web Element Recreation Report
URL / Generated 时间戳

## button#submit.btn-primary            （每个选中元素一段）
CSS selector / Semantic path / React components
### Full DOM         → 元素 outerHTML（截断 6000 字符）
### Inline styles    → style 属性原文
### Computed styles  → getComputedStyle 全量属性（截断 8000 字符）
### Fonts            → computed font-family
### Animations       → animation-* 生效属性（name/duration/…）

## @font-face rules   → 文档全部 @font-face 规则源码（collectFontFaces）
## @keyframes         → 文档全部 @keyframes 定义源码（collectKeyframes，截断 8000 字符）
```

- `@font-face` / `@keyframes` 通过遍历 `document.styleSheets[].cssRules` 收集（跨域样式表静默跳过）
- 开启后面板复制按钮文案切换为「复制完整报告」；发送引导语同步切换（见 §8）

### 5.6 内核快捷键（仅页面内生效）

| 按键 | 行为 |
|---|---|
| `Click` | 单击选择 |
| `⇧` | Shift+单击多选 / Shift+拖拽追加 |
| `←↑→↓` | 元素间导航（父/子/兄弟） |
| `F2` | 暂停/恢复（不退出选择模式） |
| `⌘/Ctrl + C` | 复制提示词（选择器 + 上下文；复刻模式则复制完整报告） |
| `⌘/Ctrl + Shift + C` | 复制选中框内可见文字 |
| `⌘/Ctrl + Shift + I` | 复制提示词，并附带选区截图（截图保存并挂附件） |
| `⌘/Ctrl + M` | 复制为 Markdown |
| `⌘/Ctrl + Z` | 撤销上一次选择操作 |
| `Esc` | 关弹层 → 清选择 → 再按退出 |

> 快捷键在 webview 页面内 `keydown` 捕获——这是选择器的工作方式，不属于 App 宿主侧键位（宿主一律走 `registerShortcutScope`，本插件未注册任何全局键位）。

### 5.7 内核 UI 结构

- **样式变量统一**：全部主题色/间距/圆角/字号收敛为 `#wep-root` 上的 `--wep-*` CSS 变量（背景、面板、边框、文字、强调色、危险色、状态色、`--wep-radius*`、字号档位）
- **字号三档**：`--wep-fs-xs(11px)` / `--wep-fs-sm(12px)` / `--wep-fs-base(13px)`，按钮/列表/快捷键/提示条按层级取档
- **组件样式去重**：`.wep-btn` 为命令面板与 popover 共用按钮基类（primary/danger 为修饰），避免两套重复定义
- **两态布局**：
  - 收起态：右下角**状态胶囊**（`.wep-cap`）——绿点（暂停时琥珀）+「选择中」标签 + `PRO` 徽标 + 计数
  - 展开态：**命令面板**（`.wep-panel`）——header（标题+计数+⚙设置/折叠/关闭）+ 复刻提示条 + **选中元素信息列表** + 快捷键网格 + 操作按钮（指令/复制/发送/退出）
- **选中元素信息列表**（对齐需求图）：每行 = 序号 + 标签（`tag#id.class`）+ 文本摘要 + ✕单删；底部「清除全部」；点击行滚动聚焦该元素并高亮，不改动选择；空态提示「未选中元素，点击页面选取」

## 6. 宿主桥协议（console-message）

内核经 `console.log("[wep]" + JSON.stringify(msg))` 上报，宿主 `console-message` 事件按 `[wep]` 前缀过滤解析：

| type | 载荷 | 宿主处理 |
|---|---|---|
| `mounted` | — | 置选择中状态，计数清零 |
| `mount-failed` | — | toast 提示 + 复位（内核初始化失败回滚） |
| `destroyed` | — | 退出选择状态 |
| `selection-changed` | `{count}` | 更新面板计数（发送按钮可用性） |
| `copy` | `{text, mime}` | `navigator.clipboard.writeText` 优先，`execCommand("copy")` 兜底，toast 提示 |
| `send-to-ai` | `{text}` | 探测会话 → 包装引导语 → `conversation.sendPrompt` |
| `screenshot` | `{rect?}` | 隐藏浮层 → `webview.capturePage(rect)` → PNG → `storage.putBlob` → `setPromptAttachment` 挂附件 |
| `open-settings` | — | 打开宿主侧设置弹层 |

## 7. 宿主侧面板

### 7.1 工具栏与设置弹层

工具栏从左到右：后退 / 前进 / 停止-刷新 / 地址栏 / 系统浏览器打开 / **开始选择**（选择中变「停止选择」，红色）/ **发送给 AI**（无选中或发送中禁用）/ **写轮眼模式**开关 / **设置**（⚙）。

设置弹层（`settingsOpen` 状态）包含：

- **语言**：当前语言显示（跟随 App，`useTranslation` 的 `locale`）
- **写轮眼模式**：开关 + 说明文案（与工具栏开关联动、同源持久化）
- **页内快捷键清单**：F2 暂停 / ⌘C 复制提示词 / ⌘⇧C 文字 / ⌘⇧I 提示词+图片 / ⌘M Markdown / ⌘Z 撤销 / Esc 清除 / Click 选择

面板还提供：选择模式提示条（含当前计数）、toast 轻提示、空态/加载中/加载失败重试三态。

### 7.2 截图与附件（Pro 能力）

- `⌘⇧I` 或内核截图：内核计算选中元素**合并边界框**（裁剪到视口）→ `post({type:"screenshot", rect})`
- 宿主先隐藏 `#wep-root` 浮层（避免框选虚线被截进图里）→ `webview.capturePage(rect)` → dataURL → `storage.putBlob`（id `screenshot-<ts>`）
- 成功后 `ui.setPromptAttachment({id, label, instructions, metadata})` 挂一次性附件——**下一次发送给 AI 时宿主自动合并** `instructions`（指引 AI 按 blobId 从插件存储读取图片）与 `metadata`
- 截图后恢复浮层（页面若已导航则忽略失败）

### 7.3 剪贴板与持久化

- 剪贴板：宿主侧统一写（内核直写 `navigator.clipboard` 仅作兜底），`navigator.clipboard` 失败时 `execCommand("copy")` 兜底
- 持久化（插件 storage + 宿主设置）：最后访问 URL（`storage.readJson/writeJson("lastUrl")`，带 localStorage 旧键升级路径）、写轮眼开关（`ctx.settings.sharingan`）
- 设置来源：`plugin.json` `contributes.settings` 声明（宿主设置页渲染）或插件内弹层读写 `ctx.settings`（写入经宿主 preload `astravia.plugins.setSettings`，localStorage 降级）

## 8. AI 深度集成

- 发送前用 `ctx.conversation.on("conversation-changed")` 一次性探测**活跃会话**（3s 兜底）；无会话 toast「无活跃会话」并中止
- 权限预检：缺 `agent.session.read/write` 时 toast 指引到设置页授权
- 普通模式引导语：`The user picked web element(s) on the page and wants you to make code changes accordingly. Use the context below (each block may include an Instruction):\n\n{text}`
- 复刻模式引导语：`The user wants to recreate the following web element faithfully. Use the recreation report below:\n\n{text}`
- 两条入口：面板工具栏「发送给 AI」按钮（先 `getContext()` 取文本）与内核浮层「发送给 AI」按钮（内核直接 `post`）

## 9. 构建与打包

```bash
cd packages/plugins/externals/web-element-picker
bun run build          # = build:kernel（iife 内核）→ vite build（MF 远程模块）
bun run check          # tsc --noEmit 类型检查
```

`@astravia-org/plugin-vite` 在 `vite build` 后自动产出安装包 `release/web-element-picker-builtin-0.2.4.zip`，内容为 `plugin.json` + `dist/`（mf-manifest.json、remoteEntry.js、style.css、assets/*）+ `locales/*.json` + `scripts/build-kernel.mjs`。

## 10. 安装与使用流程

### 10.1 安装

1. 打开 Astravia Desktop → **设置 → 插件**
2. 安装 [web-element-picker-builtin-0.2.4.zip](/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/packages/plugins/externals/web-element-picker/release/web-element-picker-builtin-0.2.4.zip)（或 `plugins.manage` 的 `install-from-path` Action）
3. 授权弹窗中勾选：`ui.slot.activity-tab`、`ui.slot.input-action`、`agent.session.read`、`agent.session.write`、`settings.read`、`settings.write`、`storage.read`、`storage.write`、`shell.openExternal`
4. 启用插件。安装后文件位于 `~/.astravia/plugins/web-element-picker/versions/0.2.4/`

### 10.2 使用流程

> 前置条件：需处于**活跃会话**（对话/项目/CLI 场景）。无会话时插件 Tab 不显示，发送给 AI 会被拒绝。

1. **打开会话**（新开或进入已有对话）
2. 进入插件：活动 Tab 栏点「网页选择器」（`initiallyVisible: true`，无需从「+」手动添加；若未出现见 §10.3 排查），或对话输入栏点「**网页元素选择器**」action 直达（自动打开/聚焦 Tab 并进入选择态）
3. 地址栏输入网址（可省略协议，自动补 `https://`）回车打开
4. 点「**开始选择**」进入选择模式：
   - 悬停预览，单击选中，Shift+单击多选，拖拽框选，方向键微调
   - 面板右侧出现选中元素**信息列表**：可单删（✕）、可「清除全部」、可点行聚焦
   - 可选：对最后选中元素点「✎ 指令」写修改意图（popover 期间页面选择自动暂停，不会跳转）
   - 可选：开「写轮眼模式」让输出变为高保真复刻报告（完整 DOM + 全量样式 + 字体 + 动画）
   - 需要操作页面本身时按 `F2` 暂停（页面恢复可交互），再按 `F2` 继续
5. 收尾四选一：
   - **复制提示词**：`⌘/Ctrl + C`（或内核浮层「复制」）
   - **复制文字**：`⌘/Ctrl + Shift + C`（选中框内可见文字）
   - **发送给 AI**：`⌘/Ctrl + Shift + I`（提示词+选区截图）或点面板/内核浮层「发送给 AI」
   - **复制 Markdown**：`⌘/Ctrl + M`
6. `Esc` 清空选择，再按一次退出选择模式；导航后选择模式自动重注入，可连续工作

### 10.3 排查清单（Tab 未出现时）

1. 设置 → 插件：确认已启用且 `ui.slot.activity-tab` 已勾选
2. **先打开一个已存在的会话**再看 Tab 栏（无会话时 Tab 一律不显示，属 fail-closed 设计）
3. 确认当前场景在 `scope_use`（conversation/project/cli）内；IM 会话等场景不显示
4. 开发者工具 console 检查 `remoteEntry` / `web-element-picker` 相关报错
5. 检查 `~/.astravia/plugins/web-element-picker/versions/0.2.4/` 文件是否完整

## 11. 验证结果

- 插件 `tsc --noEmit` 通过，0 错误（含桌面端类型检查）
- `bun run build`（重建内核 iife + vite MF 打包）通过，`dist/` 产物完整
- 仓库根 `bun run check`（Biome + 全仓 tsgo + desktop-app tsc + quality guards）通过
- 内核 bundle 重建（`bun scripts/build-kernel.mjs`）通过，`kernel-bundle.generated.ts` 与源码同步
- 内核功能验证：选择模式点击不跳转（`selection-changed`）、destroy 清理、destroy 后二次挂载、自定义桥（`WepBridge`）注入生效；Electron 复现台验证 `target=_blank` 宿主 popup 重定向同窗跳转稳定（百度首页实测）

## 12. 已知限制与后续路线

### 已知限制

- 依赖 Electron `webview`（桌面端 `webviewTag: true` 已满足）
- 发送给 AI 需要活跃会话且已授权 `agent.session.read/write`
- 指令 popover 打开期间页面选择暂停（设计如此，防选择跳转）；F2 暂停期间复制/发送快捷键仍可用
- 「/」技能面板不出现插件名（未声明 skill，属平台语义，非缺陷；输入栏入口走 `registerInputAction` action 按钮）
- 内核快捷键仅在 webview 页面内生效（设计如此，不污染宿主键位）

### 二期已完成（v0.2.2，2026-08-29）

1. 输入栏入口：`registerInputAction("element-picker")` + `plugin-context.ts` intent 通道（`start-select` / `stop-select` 直达）
2. 稳定性：webview 二次打开渲染加固（单次事件绑定 + `reconcileLoad`）、`render-process-gone` 崩溃恢复、`mount-failed` 提示；webview 交互修复（`allowpopups` + 宿主 popup 重定向同窗加载——页面内 `location.href` 拦截实测 Electron 34 非确定性失败，已废弃）；CHANGELOG 已建
3. 设置迁移：`contributes.settings` + `ctx.settings` + 插件 storage 替代 localStorage（写轮眼开关 / `lastUrl`）
4. 内核桥解耦（三期前置）：`WepBridge` adapter，`mount({ bridge })` 注入，默认 `consolePost`

### 三期：浏览器扩展 + 商店发布 + 授权码买断（v0.3.0，2026-08-29 实现完成）

**实现状态：扩展实现与端到端验证已交付（8/8 通过）；商店上架与收款渠道为运营事项（见下）。**

**扩展形态用户使用流程**（Chrome/Edge 个人电脑浏览器）：
1. 从商店或爱发电页面安装 MV3 扩展（构建产物 `extension/release/web-element-picker-extension-0.3.2.zip`）。
2. 打开任意网页，点击扩展图标 → popup 弹出授权激活表单（未激活时「开始选择」会被拒绝）。
3. 输入爱发电购得的买断码激活（ECDSA P-256 离线验签，一码多机，含有效期）。
4. 激活后 popup 显示控制面：开始/停止选择、写轮眼开关、选择计数。
5. 页面内点选/框选/键盘导航（内核与桌面版同源），复制上下文（⌘C/⌘⇧C/⌘M/⌘⇧I）。
6. 「发送给 AI」采用方案 A 剪贴板交接：复制上下文到剪贴板并提示粘贴进 Astravia 对话。

**目录结构**（`extension/`）：
- `manifest.json`：MV3，v0.3.2；content script（`<all_urls>` document_start）+ background service worker + popup + `_locales` en/zh_CN
- `src/`：`license.ts`（ECDSA 验签）、`background.ts`（事件汇总 / 授权门控 / 截图下载 / 命令转发）、`content.ts`（内核注入中继 / 导航恢复 / 剪贴板兜底）、`inject-main.ts`（主世界桥，与内核拼接成 `kernel-inject.js`）、`popup/`（激活表单 + 控制面）
- `scripts/`：`license-keygen.mjs` / `license-sign.mjs`（密钥/签码）、`build-extension.mjs`（构建 + zip）、`e2e.mjs`（Playwright 端到端 8 步断言）、`generate-icon.mjs`
- 产物：`extension/dist/`（可装载目录）、`extension/release/web-element-picker-extension-0.3.2.zip`（商店包）

**构建与验证**：
```bash
bun extension/scripts/license-keygen.mjs   # 一次性：生成密钥对（私钥 .secrets/，务必离线备份）
bun extension/scripts/build-extension.mjs  # 构建 dist/ + release zip
bun extension/scripts/e2e.mjs              # Playwright 加载扩展，8/8 断言通过
```

**商业化定案（2026-08-29）**：扩展**整体买断收费**（全部能力需授权码）；一级离线签名码（ECDSA P-256，原方案 HMAC 已升级）、一码多机；**爱发电**渠道售卖；**桌面插件形态免费**（不设授权门控）；发布顺序 **Edge Add-ons 优先 → Chrome Web Store**（接受付费墙审核风险；被拒退路：商店版降级免费基础层 + 自托管分发）。

**运营待办（未实现）**：① Edge / Chrome 开发者账号与商店提交；② 爱发电商品创建与发码流程；③ 隐私政策 URL（商店必填）；④ 私钥正式备份与轮换；⑤ 商店被拒时退路执行。照做式执行清单见 [docs/selector/selector-plugin-store-submission.md](/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/docs/selector/selector-plugin-store-submission.md)。

详细方案、桥适配点与决策记录见 [docs/selector/selector-plugin-integration.md §十二](/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/docs/selector/selector-plugin-integration.md)。
## 13. 相关文档

- Astravia 插件规范：[docs/plugin/README.md](/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/docs/plugin/README.md)、[getting-started.md](/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/docs/plugin/getting-started.md)、[ui-slots.md](/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/docs/plugin/ui-slots.md)
- 集成评估与三期路线：[docs/selector/selector-plugin-integration.md](/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/docs/selector/selector-plugin-integration.md)
- 内核源码：[src/kernel/kernel.ts](/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/packages/plugins/externals/web-element-picker/src/kernel/kernel.ts)
- 面板源码：[src/WebElementPickerPanel.tsx](/Users/zhugeyue/Desktop/project/bigdate/source-code/astravia/packages/plugins/externals/web-element-picker/src/WebElementPickerPanel.tsx)
