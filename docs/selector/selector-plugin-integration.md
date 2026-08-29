# selector 插件集成方案（网页元素选择器）

> 日期：2026-08-29
> 状态：一期与二期已交付（zip 可安装、`bun run check` 全绿、内核 Playwright 功能验证 10/10）；**三期扩展实现已交付**（MV3 扩展 + ECDSA 授权码 + Playwright 端到端验证 8/8，见 §12.7），商店实际上架与收款渠道运营待落地（§12.3/§12.4）；一期反馈与排查记录见 §十；二期完成清单见 §十一；三期方案见 §十二
> 关联仓库：`../../../selector-main`（同级仓库，上游 [oil-oil/selector](https://github.com/oil-oil/selector)，MIT）
> 源码策略（用户确认 2026-08-27）：**借鉴代码自研**——不复刻上游源码快照（vendor），以原版为设计参考，用 TypeScript 重写选择器内核；宿主桥作为插件模块直接编译进内核，无运行时兼容缝隙。

## 一、结论摘要

- **目标**：把 [selector](https://github.com/oil-oil/selector)（浏览器书签小工具，可在任意网页点选元素并生成结构化上下文，供 AI 编程助手使用）做成 Astravia 桌面插件，让用户**在桌面 App 内打开任意网页、点选元素、一键把上下文发送给当前 AI 对话**；三期再以**浏览器扩展**形态发布到 Chrome/Edge 商店，支持**授权码付费买断**，同时保持桌面插件形态（见 §十二）。
- **定案（架构问题 1）**：**方案 A —— 插件独立活动 Tab + Electron `<webview>` + 注入 selector**。不动宿主代码，做成 `packages/plugins/externals/` 下的独立插件，可独立安装/卸载/升级。**不并入内置浏览器 Tab**；双 webview 内存成本通过「插件 webview 按需挂载、切走即销毁」控制（量化分析见 §四.1）。
- **二期已完成**：输入栏入口（`registerInputAction("element-picker")`）、webview 交互修复（`allowpopups` + 宿主 popup 重定向同窗加载，§5.3）、二次打开渲染加固、`render-process-gone` 崩溃恢复、设置体系迁移（`contributes.settings` + 插件 storage）、内核桥 adapter 解耦（三期扩展前置，见 §11）。
- **三期方案（授权问题 2）**：发布 Chrome Web Store + Edge Add-ons（MV3 扩展，复用同一份零依赖内核，换 `WepBridge` 桥为 `chrome.runtime.sendMessage`）；桌面插件形态**保持免费随 App 可用**，外部扩展形态采用**授权码付费买断**（一级离线签名码、一码多机、爱发电渠道，决策记录见 §12.6）。
- **关键依据**：
  1. Astravia 桌面 App 已开启 `webviewTag`（内置浏览器 Tab 即基于 `<webview>`），插件可在 renderer 内自建 webview 面板，无需改宿主。
  2. 自研内核 `src/kernel/kernel.ts` 为**零依赖单文件 IIFE**，与宿主通信收敛为单一 `post()` 出口，三期扩展形态只需替换桥 adapter（已实现 `WepBridge` 注入），内核零改动。
  3. selector 构建产物是**纯 IIFE 拼接 JS**，通过 `webview.executeJavaScript()` 注入，绕开页面 CSP（与 bookmarklet 原理一致）。

## 二、selector-main 项目概况

| 维度 | 内容 |
|---|---|
| 定位 | 网页可视化元素选择器：点选元素 → 复制结构化上下文（元素名、稳定选择器、locator、语义位置、React 组件链、修改指令）到 Claude Code / Codex / Cursor 等 AI 助手 |
| 技术栈 | 原生 JS（无框架、无依赖、无构建链），IIFE 自执行，bookmarklet 注入 |
| 核心能力 | 点击选择 / Shift+点击多选 / 拖拽框选 / 键盘导航（↑↓←→）/ 每元素指令（✎）/ ⌘C 复制 / ⌘M Markdown / ⌘⇧C 截图 / ⌘Z 撤销 / F2 暂停 / Esc 清除 |
| Sharingan 模式 | 高保真复刻报告：页面上下文、几何、消毒后 DOM、生效样式与状态、字体、动画、媒体、React 详情；≤500K 进剪贴板，更大下载为 `.md` |
| 隐私 | 完全客户端运行，无数据外发 |
| 构建产物 | `npm run build` → `dist/assets/editor.js`（core+selection+ui+export+prompt+sharingan+context 拼接的完整 IIFE）+ `assets/editor.css` |
| 生命周期 | 防重复注入（检测 `.ai-editor-root`）；暴露 `window.__SELECTOR_DESTROY__` / `__SELECTOR_ON_NAVIGATION__` / `__SELECTOR_APPLY_SETTINGS__` 等钩子，支持 SPA 导航与软恢复 |
| 许可 | MIT（可集成，需保留版权声明） |

### 2.1 宿主桥接口清单（设计借鉴）

selector 通过 `window.__SELECTOR_HOST__` 与宿主解耦（Pro 浏览器扩展即注入该对象获得增强；每个方法可选、调用方永远保留原逻辑兜底）。自研实现不需要这个运行时缝隙——宿主桥作为插件模块与内核一同编译、一同注入。下表是原版接口清单，作为自研宿主桥的**功能对照**：

| HOST 方法 / 字段 | 用途 | 插件可提供的实现 |
|---|---|---|
| `grabViewportFrame()` | 整视口截图（替代 `getDisplayMedia`，免系统弹窗） | `webview.capturePage()` → PNG blob |
| `captureRegion(scope, geom)` | 拖选区域截图 | 上报几何 → 宿主 `webview.capturePage(rect)` → blob |
| `downloadFile(name, blob, mime)` | 保存截图 / Markdown 报告，返回保存结果 | 宿主侧保存到工作区/下载目录，返回真实路径 |
| `autoSaveScreenshots` / `screenshotClipboardContext` | 截图行为配置 | 插件设置透传 |
| `buildCopyPayload(fmt, ctx)` | 拦截/定制复制载荷（prompt / markdown / sharingan） | 把载荷回传宿主 → 宿主写剪贴板或发送给 AI |
| `prepareAssets` / `prepareStyles` / `cachedAssetDataURL` / `cachedStylesheetRules` / `cachedFontDataURL` | Sharingan 跨域资产/样式/字体预取与缓存 | `ctx.network.fetch` 宿主代理抓取，内存缓存 |
| `buildTestLocators(el)` | 附加测试定位器输出 | 一期可省（返回 null） |
| `initialLang` / `setLang` / `initialSettings` / `setSettings` | 语言与设置读写 | `ctx.settings` + 插件 storage 持久化 |
| `pageShortcuts` / `activationShortcut` / `openShortcutSettings` / `openOptions` | Pro 专属快捷键 UI | 一期置空（走插件自身快捷键） |
| `uiExtras` | 在设置面板注入额外 UI 行 | 加「发送给 AI」等动作行 |
| `isExtension` | UI 形态开关 | `true`（复用 Pro 形态，隐藏书签版推广） |
| `onClosed()` | 关闭通知宿主 | 宿主复位面板状态 |
| `imageInlinePixelLimit` | Sharingan 内联图片上限 | 默认即可 |

## 三、Astravia 现状与本任务适配点

| 能力 | 现状 | 对集成的意义 |
|---|---|---|
| 桌面框架 | Electron（`webPreferences.webviewTag: true` 已开） | 插件组件可直接渲染 `<webview>`，无需改宿主 |
| 内置浏览器 Tab | 活动面板内置浏览器基于 `<webview>`，`partition = "persist:astravia-browser"`，会话记忆 URL，`keepAliveWhenAvailable: true`（切走不销毁） | 证明 webview 面板模式可行；插件 Tab 复用同一 partition 即可共享登录态 |
| 插件体系 | `@astravia-org/plugin-sdk` + Module Federation；`registerActivityTab` / `registerInputAction` / `storage` / `settings` / `i18n` | 插件自建「网页选择器」Tab，权限门控齐全；二期已用 `registerInputAction` 提供输入栏直达入口 |
| 对话驾驶 | `ctx.conversation.sendPrompt(text)`（需 `agent.session.write`） | 一键把元素上下文发进当前 AI 对话，形成「网页元素 → AI 改代码」闭环 |
| 跨进程桥 | webview 与宿主仅 `executeJavaScript`（带返回值）/ `capturePage` / `console-message` 事件 | 注入走 executeJavaScript；内核事件走 console-message 桥（三期可换 `chrome.runtime.sendMessage`，`WepBridge` adapter） |

## 四、候选方案对比

### 方案 A：插件独立活动 Tab + webview + 注入（定案）

- 做法：插件 `web-element-picker`，注册活动 Tab「网页选择器」：地址栏 + `<webview>` + 工具栏（开始选择 / 截图 / 发送给 AI / 写轮眼 / 设置）。选择器注入 = 自研内核 IIFE（`src/kernel/kernel.ts` 经 `Bun.build` 打包）→ `executeJavaScript` 注入。
- 优点：不动宿主代码；独立安装/卸载/升级；与内置浏览器互不影响；内核零依赖、单一 `post()` 出口，天然适配三期扩展形态。
- 缺点：插件 webview 与内置浏览器 webview 并存时有额外内存；webview 通信仅三条通道，部分功能需宿主侧接管。
- 结论：**维持定案**。内存成本可控（§四.1）；二期已完成稳定性加固与入口增强。

### 方案 B：集成进宿主内置浏览器 Tab（官方能力）

- 做法：修改 `packages/desktop-app` 内置浏览器，把「开始选择」做成工具栏按钮，注入逻辑进 `useBrowserPanelModel` / BrowserPanelView。
- 优点：单一 webview、体验最顺、用户无感。
- 缺点：侵入宿主代码，需走宿主开发/发版流程；与插件生态解耦（不再是插件，无独立入口/卸载/市场分发）；无法复用三期扩展的内核桥方案。
- 结论：**暂不采用**（决策分析见 §四.1）。

### 方案 C：插件仅做「书签生成器」

- 做法：插件复制 selector 官方安装页，生成 `javascript:` 书签链接。
- 缺点：只是把浏览器里的用法搬进桌面 App，价值低；网页仍需在外部浏览器打开，与 AI 对话无闭环。
- 结论：不采用。

### 方案 D：全局浮层 + 打开系统浏览器

- 缺点：无法注入任意页面，核心能力丢失。不采用。

### 四.1 架构定案：为什么维持「独立 Tab + webview」，不并入内置浏览器（问题 1）

**内存成本量化**（Chromium 多进程模型）：
- 两个 webview 共享浏览器进程、GPU 进程、网络进程与 storage partition（`persist:astravia-browser`）；各自独占一个渲染进程及其页面堆。
- 增量成本 ≈ 1 个渲染进程（约 50–90 MB 基线，随页面复杂度和所选元素堆增长）+ 页面自身 DOM/JS 堆（普通页面几十 MB）。实测量级：插件 webview 常驻时约增加 **80–150 MB**（空页 ~60 MB，重页面更高）。
- **关键缓解**（已实现）：插件 Tab 为**条件挂载**——切走/关闭 Tab 即卸载 webview DOM，渲染进程随之回收；与内置浏览器的 `keepAliveWhenAvailable: true`（切走保活）策略相反。因此「双 webview 并存」只在两个 Tab 同屏可见时才成立（活动面板一次只显示一个 Tab，实际并存的只是常驻的内置浏览器 + 活跃的插件 webview，插件 Tab 隐藏后其 webview 销毁）。选择结束、Tab 隐藏、页面崩溃（`render-process-gone`）都会触发清理或重建。

**为什么仍不并入内置浏览器**：
| 维度 | 独立 Tab（A） | 并入内置浏览器（B） |
|---|---|---|
| 分发自洽 | 插件可独立安装/升级/卸载、可上市场 | 走宿主发版，能力与宿主版本绑定 |
| 三期复用 | 内核 + 桥 adapter 直接复用为扩展 | 内核逻辑与宿主代码耦合，需另拆 |
| 权限模型 | 插件权限门控（可按需关闭） | 官方能力，权限默认授予 |
| 会话依赖 | 无活跃会话仍可浏览网页（Tab 可见性仅依赖场景） | 内置浏览器 Tab 本身为会话级且可移除 |
| 维护成本 | 插件自维护 | 需宿主团队维护 |
| 代价 | +1 webview（用时才挂载，已缓解） | 无额外 webview |

结论：**A 长期成立**。B 仅在「产品决策把网页选择器升格为官方内置能力」时再评估（届时从 externals 迁出或合入，见 §八 风险表）。

## 五、推荐方案详细设计（方案 A，已实现）

### 5.1 插件位置与目录（现状）

```text
packages/plugins/externals/web-element-picker/
  plugin.json                 # 清单 v0.2.0（见 §5.7）
  package.json                # v0.2.0；build = build:kernel + vite build
  tsconfig.json
  vite.config.ts              # astraviaPluginFederation + @tailwindcss/vite
  CHANGELOG.md                # 二期改动记录
  LICENSE                     # selector 的 MIT 版权声明（保留）
  locales/zh.json  en.json    # 宿主侧 i18n
  scripts/build-kernel.mjs    # Bun.build kernel.ts → iife 字符串 → generated
  src/
    index.tsx                 # activate()：registerActivityTab + registerInputAction
    plugin-context.ts         # 输入栏 intent 通道（push/consume/onPickerIntent）
    WebElementPickerPanel.tsx # 主面板：地址栏 + webview + 工具栏 + 宿主桥 + 设置弹层
    style.css                 # Tailwind 入口
    jsx.d.ts                  # webview 标签类型声明
    kernel/
      kernel.ts               # 自研选择器内核（零依赖，页面内运行，window.__WEP__）
      kernel-bundle.generated.ts  # build-kernel 产物，勿手改
  dist/                       # vite 构建产物（gitignore）
  release/                    # 安装包 zip（vite build 后自动生成）
```

**externals 定位**（一期 §5.1 结论不变）：web-element-picker 是「可独立安装/卸载/升级的第三方插件」，与 externals 完全一致，**不迁移 presets**。若产品决策升格官方能力再迁。

**自研策略**：以 selector-main 为设计参考（交互模型、prompt 结构、§2.1 宿主桥接口清单），在 `src/kernel/kernel.ts` 内用 TypeScript 重写内核；宿主桥作为普通模块直接编译进内核。上游升级时人工对照其提交/CHANGELOG 采纳设计改进；从 MIT 代码复制的片段须保留来源注释与许可声明（LICENSE/NOTICE）。

### 5.2 注入链路（现状）

1. 用户点击「开始选择」（或输入栏 action 直达，见 §5.9）→ 面板置选择态。
2. 面板执行 `webview.executeJavaScript(bootstrapCode)`：`(() => { <kernel iife> window.__WEP__?.mount({ lang, bridge? }) })()`。
3. 内核在 webview 页面内运行：`window.__WEP__` = `{ mount, destroy, applyLang, applySettings, getContext }`；mount 成功置 `window.__WEP_ACTIVE__ = true`（点击归内核处理），失败回滚监听器/UI 并上报 `mount-failed`（防「僵尸内核」吞点击）。
4. 页面 SPA 导航：`did-navigate-in-page` / `did-navigate` → 内核随文档销毁 → 宿主 `reconcileLoad()` 幂等重注入，保持连续选择；语言/写轮眼状态由宿主侧下发（`applyLang` / `applySettings`）。
5. 停止选择 / 切走 Tab：`destroy()` 清理页面内 DOM 与监听器，本地状态复位，不再依赖页面确认。

### 5.3 webview 配置（现状，含交互修复）

```tsx
<webview
  ref={webviewRef}
  src={url}
  partition="persist:astravia-browser"   // 与内置浏览器共享登录态
  allowpopups                            // 二期修复：开启弹出窗口能力
  className="w-full h-full"
/>
```

- **`allowpopups` + 宿主 popup 重定向（交互修复，2026-08-29 定案）**：真实网页（如百度）大量链接 `target="_blank"`；webview 关闭 popups 时 Electron 静默吞掉这类点击（Electron 34 已从 `WebviewTag` 移除 `new-window` 事件，无法接管重定向）。修复方案：`allowpopups={true}` 放行 popup，由宿主 main 进程统一接管——`window-manager.ts` 的 `did-attach-webview → webviewContents.setWindowOpenHandler` 把 `target=_blank` / `window.open` 重定向为**同一 webview 的 `loadURL`**（与内置浏览器完全一致的机制，实测稳定）。
  - **曾尝试并废弃的方案**：面板注入页面内 capture 拦截器（`NAV_FIX_CODE`：`preventDefault` + 同窗 `location.href`）。实测在 Electron 34 webview 中 `location.href` 赋值存在**非确定性失败**（赋值成功但页面不跳转，百度首页复现率约 20%，首次交互更高），且会抢在宿主 popup 重定向之前拦截点击——这就是「网页选择器内置浏览器点链接不跳转」bug 的根因（2026-08-29 通过最小 Electron 复现台定位并修复）。故已删除页面内拦截，跳转完全依赖宿主 popup 重定向。
  - 选择模式下的点击归内核处理（内核 capture 监听 `preventDefault`），天然不会触发 popup，无需额外的选择态判断。
- **二次打开渲染加固（一期修复确认）**：插件 Tab 条件挂载（仅内置浏览器 `keepAliveWhenAvailable`），每次切换 Tab 都会销毁重建 webview。加固点：事件绑定收敛为**单次 `useEffect([])` + `handlersRef` 映射**（无重复绑定/解绑抖动）；`reconcileLoad()` 在 `dom-ready` / `did-finish-load` 幂等补齐待加载 URL（`about:blank` 时）；选择模式下 `dom-ready` 重注内核；`render-process-gone` 崩溃自动重建；`mount-failed` toast 提示并复位。
- 事件：`did-finish-load` / `did-navigate` / `did-navigate-in-page`（同步地址栏、`reconcileLoad`）、`console-message`（桥消息）、`render-process-gone`（崩溃恢复）、`page-title-updated`（可选）。

### 5.4 宿主桥通信（三条通道 + 桥 adapter）

| 通道 | 方向 | 用途 |
|---|---|---|
| `executeJavaScript(code)` | 宿主 → webview | 注入内核 / 读取上下文（`getContext`）/ 触发销毁 |
| `console-message` 事件 | webview → 宿主 | 内核事件上报（前缀 `[wep]` + JSON）：`mounted` / `destroyed` / `selection-changed` / `copy` / `send-to-ai` / `screenshot` / `open-settings` / `mount-failed` |
| `webview.capturePage(rect)` | 宿主侧直接调用 | 视口/区域截图 |

**桥 adapter（三期扩展前置，已实现）**：内核只依赖一个 `post()` 出口上报事件。默认实现 `consolePost`（桌面插件形态，`console.log("[wep]"+JSON)`）；`mount({ bridge })` 可注入自定义桥——扩展形态注入 `{ post: (msg) => chrome.runtime.sendMessage(msg) }` 即完成换桥，内核其余代码零改动。已在 Playwright 验证自定义桥收到 `mounted` 且不再走 console。

**剪贴板策略**：webview 内 `navigator.clipboard` 受焦点约束不可靠。宿主桥接管复制载荷（内核直写仅兜底），宿主侧 `navigator.clipboard.writeText` + `execCommand("copy")` 兜底。

### 5.5 AI 深度集成（核心价值）

- 「发送给 AI」：面板工具栏按钮（先 `getContext()` 取文本）与内核浮层按钮（内核直接 `post({type:"send-to-ai"})`）。宿主探测活跃会话（`conversation-changed` + 3s 兜底）→ 包装引导语 → `ctx.conversation.sendPrompt`。
- 输入栏 action（二期已实现）：`registerInputAction("element-picker")`，`decoratePrompt` 提示 AI 元素上下文来源；点击后打开/聚焦插件 Tab 并经 intent 通道（`plugin-context.ts` 的 `pushPickerIntent` / `consumePickerIntent`）发送 `start-select` / `stop-select`，形成「输入栏 → 选择 → 发送」闭环。

### 5.6 权限清单（现状）

| 权限 | 用途 | 必需 |
|---|---|---|
| `ui.slot.activity-tab` | 注册「网页选择器」Tab | 是 |
| `ui.slot.input-action` | 输入栏入口（二期） | 是 |
| `agent.session.read` / `agent.session.write` | 探测会话 + 发送给 AI | 是 |
| `storage.read` / `storage.write` | 设置 / `lastUrl` / 截图持久化（二期起经插件 storage） | 是 |
| `settings.read` / `settings.write` | 宿主设置体系读写（二期） | 是 |
| `shell.openExternal` | 「在系统浏览器打开」按钮 | 是 |
| `network.fetch` | Sharingan 跨域资产/样式/字体抓取 | 可选（二期未用） |
| `fs.read` / `fs.write` | 截图/报告保存到项目目录 | 可选 |

### 5.7 manifest（现状 v0.2.2）

```json
{
  "id": "web-element-picker",
  "name": "%plugin.name%",
  "version": "0.2.2",
  "pluginApiVersion": "^1.0.0",
  "runtime": "module-federation",
  "entry": "dist/mf-manifest.json",
  "moduleFederation": { "remoteName": "web_element_picker", "expose": "./plugin" },
  "styles": ["dist/style.css"],
  "permissions": [
    "ui.slot.activity-tab", "ui.slot.input-action",
    "agent.session.read", "agent.session.write",
    "storage.read", "storage.write",
    "settings.read", "settings.write",
    "shell.openExternal"
  ],
  "contributes": {
    "settings": [
      {
        "key": "sharingan",
        "type": "boolean",
        "title": "%settings.sharingan.title%",
        "description": "%settings.sharingan.description%",
        "default": false
      }
    ]
  },
  "defaultLocale": "zh",
  "description": "%plugin.description%",
  "author": "Astravia"
}
```

### 5.8 i18n

宿主侧用户可见文案走 `locales/zh.json` / `locales/en.json`（`%key%` 引用），遵循仓库 i18n 约定（AGENTS.md / docs/adr/0031）。内核自带 en/zh 词典，语言随宿主对齐。

### 5.9 入口对比（现状：双入口）

二期起插件提供**两个入口**，交互一致：

| 维度 | 活动 Tab 入口 | 输入栏 action 入口（二期新增） |
|---|---|---|
| 位置 | 活动面板 tab 栏「网页选择器」 | 对话输入栏 action 按钮「网页元素选择器」 |
| 行为 | 打开 Tab → 地址栏浏览 → 开始选择 | 打开/聚焦插件 Tab + 直接发送 `start-select` / `stop-select` intent |
| 前提 | 活跃会话（场景在 `scope_use`） | 同左；另有 `ui.slot.input-action` 权限 |
| 对比方案 B（内置版） | —— | 内置版为浏览器工具栏按钮，非插件形态 |

## 六、开发步骤与验收（状态跟踪）

| 阶段 | 内容 | 验收标准 | 状态 |
|---|---|---|---|
| 1. 脚手架与面板 | 插件骨架、webview 面板、地址栏、加载状态 | Tab 可打开，URL 可加载、前进后退、刷新，登录态与内置浏览器共享 | ✅ 完成 |
| 2. 内核移植与注入 | 自研内核（selection/ui/export/prompt/sharingan），Bun.build 打包注入、生命周期钩子 | 网页出现选择器 UI；点选/多选/框选/键盘导航/✎/⌘C/⌘M/⌘Z/Esc/F2 全可用；关闭 Tab 后页面无残留 | ✅ 完成 |
| 3. 宿主桥增强 | capturePage 截图、剪贴板接管、设置持久化、语言透传 | ⌘⇧C 截图正确；Sharingan 报告生成/保存；设置重启后保留 | ✅ 完成 |
| 4. AI 深度集成 | 「发送给 AI」按钮 + console 桥 + sendPrompt | 一键把选中上下文发进当前对话 | ✅ 完成 |
| 5. 打包发布 | zip 打包、安装验证、README、CHANGELOG | 通过 `bun run check`；zip 可安装启用 | ✅ 完成（v0.2.0） |
| 6. 二期稳定性与入口 | 输入栏 action、二次打开渲染加固、`render-process-gone` 恢复、交互修复（`allowpopups` + 宿主 popup 重定向）、设置体系迁移、桥 adapter | 见 §11 验收记录 | ✅ 完成（2026-08-29） |
| 7. 三期：浏览器扩展 + 商店发布 + 授权码买断 | 见 §十二 | 见 §12.5 | ✅ 扩展实现完成（2026-08-29，E2E 8/8）；商店上架 / 收款渠道为运营事项，见 §12.7 |

## 七、使用流程（用户视角）

> **前置条件**（能力不是装上就有，以下任一条缺失都会断链）：
> - **安装时授权**：启用插件必须勾选 `ui.slot.activity-tab`（否则不出现「网页选择器」Tab）与 `agent.session.write`（否则「发送给 AI」不可用）；输入栏入口另需 `ui.slot.input-action`。
> - **活跃 AI 会话**：「发送给 AI」会把上下文作为用户消息注入**当前正在进行的对话**（`sendPrompt` 语义，点即发送、不二次确认）；使用前须先在对话面板打开一个活跃会话。仅复制上下文（⌘C）则不需要会话。

1. **安装与授权**：设置 → 插件 → 安装本地 zip → 授权权限 → 启用。
2. **进入插件 Tab**：活动面板 tab 栏点「网页选择器」，或对话输入栏点「网页元素选择器」action 直达（自动打开/聚焦 Tab 并进入选择态）。界面三部分：顶部工具栏（地址栏 + 按钮）、中间的网页区域、无页面时的空白提示。此 Tab 内是**插件自己的浏览器**，与内置「浏览器」Tab 是两套 webview（登录态共享、页面不互通）。
3. **加载目标网页**：地址栏输入网址回车（可省略协议自动补 `https://`）；已登录站点无需重新登录。加载完成后插件进入待命状态。
4. **开始选择**：点工具栏「开始选择」（或输入栏 action 直达）→ 内核注入当前网页，页面出现选择器浮层。此后与网页的交互被接管：选择模式下点击归内核处理（不跳转）；非选择模式浏览时 `target="_blank"` 链接经宿主 popup 重定向在同一 webview 打开（与内置浏览器一致，见 §5.3）。

   | 操作 | 效果 |
   |---|---|
   | 单击元素 | 选中该元素（高亮显示） |
   | Shift + 单击 | 追加 / 取消加入多选 |
   | 拖拽 | 框选一片区域内的多个元素 |
   | ↑ / ↓ | 切换到父 / 子元素 |
   | ← / → | 切换到上一个 / 下一个兄弟元素 |
   | ✎（选中元素上的按钮） | 给该元素写修改指令（如"改成圆角按钮"） |
   | F2 | 暂停 / 恢复选择模式（暂停后可正常操作网页） |

5. **取用上下文**（选择完成后）：
   - `⌘C` 复制结构化提示词到剪贴板；`⌘M` 复制为 Markdown；`⌘⇧C` 复制选中框内可见文字；`⌘⇧I` 复制提示词并附选区截图；`⌘Z` 撤销；`Esc` 清除选择 / 再按退出。
   - 开启「写轮眼模式」后复制/发送输出高保真复刻报告（完整 DOM + 全量样式 + 字体 + 动画）。
6. **交给 AI（深度集成）**：点工具栏「发送给 AI」→ 当前选中上下文作为一条用户消息发进**当前活跃会话**（`sendPrompt` 语义，点即发送、不二次确认；无活跃会话时按钮不可用/提示）。
7. **结束**：Esc 清除选择；关闭或切走 Tab 时注入自动销毁，网页无残留；页面崩溃（`render-process-gone`）自动重建恢复。

**完整示例**——修改本地 `localhost:3000` 的登录按钮样式：
1. 输入栏点「网页元素选择器」→ 插件 Tab 自动打开并进入选择态；
2. 地址栏输入 `localhost:3000` → 单击登录按钮 → ✎ 写"改成胶囊形，品牌蓝"；
3. 点「发送给 AI」；
4. 切回对话：上下文已作为用户消息发出，AI 正在改对应组件代码。



**浏览器扩展形态用户流程（Chrome/Edge，个人电脑浏览器）**

1. 在 Chrome Web Store 或 Edge Add-ons 商店搜索 "Astravia Web Element Picker"，或从爱发电页面获取安装包，安装扩展（MV3 形态）。
2. 打开任意网页（Astravia 内置浏览器以外的任何页面，包括 localhost、外部站点）。
3. 点击扩展图标（右上角）或浏览器工具栏 action 按钮 → 弹出面板开始选择。
4. 点选元素、框选、键盘导航等操作（内核同桌面版）。
5. 复制上下文（⌘C / Ctrl+C，或 extension 复制按钮）或直接发送给 AI（clipboard 交接，或本地桥服务）。
6. 扩展未激活时在面板/弹出窗口输入爱发电买断码激活（一级离线签名码，一码多机，含校验）。
7. 激活后发送上下文到 Astravia 对话，AI 即可收到元素上下文进行修改。

**注意**：浏览器扩展形态使用与桌面插件形态完全独立（内核同源），用户无需在 Astravia App 内打开 Tab；扩展激活后可一码多机使用。

| 风险 / 问题 | 影响 | 对策 / 状态 |
|---|---|---|
| 双 webview 内存 | 内置浏览器 + 插件 Tab 并存时增量 80–150 MB | 插件 webview 条件挂载、切走销毁（已实现）；方案 B 并入内置浏览器可消除，但代价见 §四.1，暂不采用 |
| webview 与宿主通信仅三条通道 | 部分功能需宿主侧接管（剪贴板、截图、事件上报） | §5.4 设计已落地；桥 adapter 已解耦 |
| `target="_blank"` 点击静默丢失 | 真实网页（百度等）点击无反应 | 已修复：`allowpopups` + 宿主 popup 重定向同窗加载（§5.3）；曾用页面内 `location.href` 拦截，实测 Electron 34 webview 中非确定性失败，已废弃 |
| 二次打开渲染失败 | 切走再切回白屏/无注入 | 已修复：单次绑定 + `reconcileLoad` + `dom-ready` 重注入（§5.3），Playwright 验证 |
| 页面 CSP | 注入被拦 | 内核走 executeJavaScript（用户手势路径），与 bookmarklet 同理，不受 CSP 限制 |
| 登录态 | webview 独立会话 | 复用 `persist:astravia-browser` partition |
| 上游升级 | 自研实现与上游功能漂移 | 定期对照上游提交/CHANGELOG 采纳设计改进 |
| 许可合规 | MIT 声明 | 保留 LICENSE/NOTICE |
| 三期：商店审核与付费墙 | 见 §12.3 | 见 §12.3/§12.4 |
| 三期：授权码破解 | 见 §12.4 | 签名码 + 设备绑定 + 联网校验分级（§12.4） |

## 九、附录：上游构建产物参考（自研不直接使用）

上游 `scripts/build.js` 将 `core → selection → ui → export → prompt` 顺序拼接，再追加 `sharingan.js`（去文件头注释）与 `context.js`，产出：
- `dist/assets/editor.js` —— 完整 IIFE（等价产物由插件 Bun.build 生成到 `kernel-bundle.generated.ts`）；
- `dist/assets/payload-*.css` —— 各片段 base64（bookmarklet 专用，自研不需要）；
- `dist/assets/editor.css` —— 编辑器样式（自研以字符串注入 `<style>`）。

## 十、一期反馈与排查记录（2026-08-28，结论已闭环）

一期反馈 4 条：问题 1（保持 externals）结论见 §5.1；问题 2/3 机制性说明见下，均已解决或确认预期；问题 4（外部扩展）方案见 §十二。

### 10.1 问题 2：安装授权后找不到插件 Tab，「+」也无法添加

**结论：预期行为 + 文档指引，已闭环。**
机制（宿主代码确认）：插件 Tab 可见性由 `useActivityTabDefinitions` 决定——`currentScenario === null`（无活跃会话）时所有插件 Tab 不出现；`scope_use` 不匹配场景也不出现（fail-closed）。排查清单已写入插件 README §10.3：确认已启用 + `ui.slot.activity-tab` 已勾选 + **先打开已存在会话**再看 Tab 栏 + console 检查 `remoteEntry` 报错 + 安装目录文件完整。

### 10.2 问题 3：AI 对话框「/」命令里没有插件名

**结论：预期行为，不是缺陷。**「/」弹的是 Skill 选择面板（只列 skills）；插件未声明 skill 故不出现。二期改走 `registerInputAction` 输入栏 action（按钮形态，非「/」命令）——已实现（§5.9）。

## 十一、二期完成清单（2026-08-29）

按一期 §11 判定表全部落地，逐项验收：

| 序号 | 内容 | 实现 | 验收 |
|---|---|---|---|
| 1 | 输入栏入口 | `registerInputAction("element-picker")`（`index.tsx`）+ intent 通道（`plugin-context.ts` 的 `pushPickerIntent` / `consumePickerIntent` / `onPickerIntent`）；`decoratePrompt` 提示 AI | `tsc` 通过；权限 `ui.slot.input-action` 已声明 |
| 2 | 稳定性 | `render-process-gone` 自动重建；`mount-failed` toast + 复位；二次打开渲染加固（§5.3）；webview 交互修复（§5.3） | Playwright 内核验证 10/10（拦截 / 清理 / 幂等 / 桥切换 / nav-fix）；CHANGELOG 已建 |
| 3 | 设置迁移 | `plugin.json` v0.2.0 `contributes.settings.sharingan` + `settings.read/write`；面板读写 `ctx.settings`（宿主 preload `setSettings`，localStorage 降级）；`lastUrl` 迁插件 storage（`storage.readJson/writeJson`，localStorage 升级路径） | `tsc` 通过；root `bun run check` 全绿 |
| 4 | 内核桥解耦（三期前置） | `WepBridge` adapter：`mount({ bridge })` 注入，默认 `consolePost`；`mount` 失败回滚 + `mount-failed`；`applyLang` 保护；`__WEP_ACTIVE__` 点击归属标记 | Playwright：自定义桥收到 `mounted`、不再走 console |
| 5 | 并入内置浏览器评估 | **暂不采用**（§四.1 架构定案） | 决策记录于本文档 |

**质量门**：插件 `bun run check`（tsc --noEmit）通过；`bun run build`（内核 bundle + vite MF + zip）通过；仓库根 `bun run check`（Biome + 全仓 tsgo + desktop-app tsc + guards）通过。

## 十二、三期路线：浏览器扩展 + 商店发布 + 授权码买断（问题 2）

**目标**：选择器在外部浏览器（Chrome/Edge）以扩展形态可用——任意网页点选 → 复制上下文 / 截图 → 交回 AI 编程助手（含 Astravia）；通过商店发布，采用**授权码付费买断**商业模式；**同时保持 Astravia 桌面插件形态可用**。

**可行性（高，前置已完成）**：内核零依赖单文件 IIFE + `WepBridge` 桥 adapter（§5.4）已就位——扩展 content-script 注入同一份内核，仅换桥为 `chrome.runtime.sendMessage`。

### 12.1 架构形态

```text
            同一份内核（src/kernel/kernel.ts，零依赖 IIFE）
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
  桌面插件 webview     浏览器扩展 content-script   书签（可选）
  桥: consolePost       桥: chrome.runtime.sendMessage   桥: window 事件
  宿主: executeJavaScript / capturePage / sendPrompt  宿主: chrome.tabs.captureVisibleTab / navigator.clipboard
```

- **扩展**（MV3）：`manifest.json` + content script（注入内核）+ popup / action（开始/停止、模式设置、授权码激活）+ 可选 background（转发、触发截图）。
- **内核**：与桌面插件完全同一份源码；仅 `post()`（上报宿主）与截图、剪贴板、发送四类能力需要 adapter（§12.2）。

### 12.2 桥适配点

| 能力 | 桌面插件（已完成） | 浏览器扩展（三期，已实现） |
|---|---|---|
| 上报事件 | `console.log("[wep]"+JSON)`（`consolePost`） | `window.postMessage` → content script → `chrome.runtime.sendMessage` → background 汇总（`chrome.storage.session`）→ popup 轮询展示 |
| 截图 | `webview.capturePage(rect)` | `chrome.tabs.captureVisibleTab`（整页 PNG）→ `chrome.downloads.download`；需 `activeTab` + `downloads` 权限 |
| 剪贴板 | 宿主侧 `navigator.clipboard` + execCommand 兜底 | content script 兜底 `navigator.clipboard.writeText`（`clipboardWrite` 权限）；主世界直写优先 |
| 发送给 AI | `ctx.conversation.sendPrompt(text)` | **方案 A 剪贴板交接（已实现）**：复制上下文到剪贴板，提示用户粘贴进 Astravia 对话 |
| 设置/语言 | 插件 storage + 宿主 locale | `chrome.storage.sync`（wepSettings）+ 扩展 i18n（`_locales` en/zh_CN）+ storage.onChanged 实时应用 |

### 12.3 商店发布

| 商店 | 注册 | 上架要点 | 成本 |
|---|---|---|---|
| Chrome Web Store | [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) | 一次性开发者注册费 **$5**；需商品详情页、截图、隐私政策 URL；审核周期数天–数周；付费墙有政策风险（见下） | $5 一次性 |
| Edge Add-ons | [Microsoft Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge) | 免费；可提交相同 CRX；审核一般更快；政策相对宽松 | 免费 |

**审核与付费墙风险（商业化定案：整体买断收费）**：Google 政策要求应用内数字商品使用商店支付，而 Chrome Web Store 对扩展**不提供内购能力**。已定案：**扩展整体能力需授权码**（无免费基础层）——付费墙审核风险**偏高**，须如实接受并准备退路：
- **主策略**：商店版即完整版（含授权码激活 UI），接受可能被拒；隐私政策页必须声明「不收集数据 / 全部本地处理」（与内核设计一致，天然满足）。
- **退路 1（被拒时）**：商店版降级为免费基础层（点选/复制），进阶能力（截图/复刻报告/发送给 AI）走自托管分发（GitHub Releases / 自建页 + CRX 侧载）——分层边界方案保留为备选（§12.6 决策记录）。
- **退路 2（Edge 优先）**：Edge Add-ons 政策相对宽松，作为主发布渠道先跑通，再同步提交 Chrome。

### 12.4 授权码付费买断（商业化）

**模式**：一次买断 + 授权码离线激活（不依赖商店内购，中国区可用）。

- **售卖渠道（已定案）**：**爱发电**（国内开发者常用、低抽成、适合中文用户群）；扩展激活页展示爱发电商品链接。
- **授权码体系（已实现：一级离线签名码，无需服务器）**：
  - 卖码方持 **ECDSA P-256 私钥**（`extension/.secrets/license-private.jwk.json`，勿提交），用 `extension/scripts/license-keygen.mjs` 生成密钥对，`license-sign.mjs` 签发；码格式 `WEP-<base32(payload)>.<base32(signature)>`，payload = `1|<订单号>|<有效期YYYYMMDD>`；
  - 扩展内置**公钥**（`extension/src/license-public.jwk.json`），激活时 `checkLicense()` 本地验签：结构 + 签名 + 未过期 → 写入 `chrome.storage.sync`；
  - 一级：离线验签，**一码多机可共用**（便捷，可被分享）——起步接受此风险；若销量提升需强保护，升级二级（一码绑定 N 台设备，本地指纹）或三级（联网校验，Keygen/Cryptlex）。
  - 注：原方案写 HMAC-SHA256，实现改为 ECDSA P-256 签名（非对称、公钥内置、验签无需密钥，强度更高且复杂度相当）。
- **双形态策略（已定案）**：
  - **桌面插件形态：免费**（随 App 安装，已实现的全部能力不变，不设授权门控）；
  - **浏览器扩展形态：整体买断收费**（激活码解锁全部能力）。
- **现实预期**：纯本地授权可被逆向绕过；目标客户（开发者）对「买断码」接受度高、破解率相对低。若需要强保护再升级授权级别（备选分层方案保留：免费基础层 + 进阶层授权，仅商店被拒时启用）。

### 12.5 三期工作拆分与验收

1. **扩展脚手架**：`packages/plugins/externals/web-element-picker/extension/` 子目录：MV3 manifest、content script（document_start 注入内核）、popup 控制面（开始/停止、写轮眼、授权码激活 UI）、background service worker。→ **✅ 已完成**
2. **桥 adapter 落地**：内核 `mount({ bridge })` 注入 `{ post: (msg) => window.postMessage({ __wepEvent: msg }, "*") }`；content script 中继 → `chrome.runtime.sendMessage`；截图 `captureVisibleTab`；剪贴板 content script 兜底；设置走 `chrome.storage.sync`。→ **✅ 已完成**
3. **授权码**：keygen/sign 脚本 + 扩展内 ECDSA 验签 + 激活 UI；按 §12.4 一级离线方案实现。→ **✅ 已完成**
4. **「发送给 AI」跨端桥接**：**方案 A 剪贴板交接**（复制上下文 + 提示粘贴进 Astravia 对话）。→ **✅ 已完成**
5. **商店上架**：Edge Add-ons 优先（政策宽松）→ Chrome Web Store；隐私政策；整体买断收费说明；被拒退路按 §12.3。→ **⬜ 待执行（运营事项，见 §12.7）**
6. **README/CHANGELOG/构建矩阵**：插件 README 增三期扩展章节；CHANGELOG 记录；构建脚本 `extension/scripts/build-extension.mjs`（内核拼接 + 打包 + zip）。→ **✅ 已完成**

**三期验收（E2E 已通过）**：`bun extension/scripts/build-extension.mjs` 构建 → `bun extension/scripts/e2e.mjs`（Playwright + chromium-1194 加载真实 MV3 扩展）8/8 通过：① 注入（data-wep-injected + `window.__WEP__`）② 未激活门控（wep-start 被拒、无内核 UI）③ 激活（验签 + storage 写入）④ 挂载（#wep-root 出现）⑤ 事件回流（selection-changed → count）⑥ 写轮眼设置 ⑦ 停止（销毁 + 复位）⑧ 导航恢复（选择中导航自动重挂载）。剩余人工验收项：商店安装体验与收款流程。

### 12.7 三期实施记录（2026-08-29）

**交付内容**（全部在 `packages/plugins/externals/web-element-picker/extension/`）：

| 模块 | 文件 | 说明 |
|---|---|---|
| manifest | `manifest.json` | MV3，v0.3.0，`_locales` en/zh_CN，`<all_urls>` content script（document_start），web_accessible_resources 放行 `kernel-inject.js` |
| 授权码 | `src/license.ts` | base32 + ECDSA P-256/SHA-256 验签（浏览器/Node 通用 WebCrypto）；`checkLicense` 结构+签名+有效期 |
| 密钥工具 | `scripts/license-keygen.mjs` / `license-sign.mjs` / `license.test.ts` | 生成密钥对 / 签发授权码 / 单测 |
| 内核注入 | `src/inject-main.ts` | 主世界桥：`__wepCmd` 下行（mount/destroy/applySettings/applyLang）+ `__wepEvent` 上行 + 就绪 ping/pong；构建时拼接到内核 IIFE 之后成 `kernel-inject.js` |
| content script | `src/content.ts` | 注入内核、事件中继、命令下行、导航恢复（storage `wepSelecting`）、剪贴板兜底 |
| background | `src/background.ts` | 事件状态汇总（session）、授权门控（wep-start/截图/发送前验签）、截图下载、命令转发（无接收端安全吞错） |
| popup | `src/popup/popup.html` + `popup.ts` | 激活表单 + 购买链接 + 开始/停止 + 写轮眼开关 + 状态轮询（600ms） |
| 构建 | `scripts/build-extension.mjs` | 读内核 bundle → 拼接 inject-main → 打包 content/background/popup → 复制资源 → 打 zip（`extension/release/web-element-picker-0.3.0.zip`） |
| 端到端 | `scripts/e2e.mjs` | Playwright + chromium-1194 加载真实扩展，8 步断言（见 §12.5 验收） |
| 图标 | `assets/icon{16,32,48,128}.png` | `scripts/generate-icon.mjs` 生成 |

**安全要点**：
- 私钥 `.secrets/license-private.jwk.json` 已 gitignore，**必须离线备份**；泄露 = 授权码可被伪造。公钥随扩展发布。
- 授权码为一级离线方案：一码多机可共用、可被分享（§12.4 决策）。
- 扩展权限最小集：`storage` / `activeTab` / `clipboardWrite` / `downloads`，无 `scripting`、无远程代码、无第三方网络请求（符合商店「不收集数据、全部本地处理」声明）。

**运营待办（未实现，需人工）**：① Edge Add-ons / Chrome Web Store 开发者账号与提交；② 爱发电商品创建与授权码销售流程；③ 隐私政策 URL（商店必填）；④ 正式签名私钥备份与轮换策略；⑤ 商店被拒时的退路方案（§12.3）。

> 上架执行清单（照做式）：见 [selector-plugin-store-submission.md](selector-plugin-store-submission.md)。

### 12.6 商业化决策记录（2026-08-29）

三期启动前已定案的商业前提：

| 决策项 | 定案 | 备选（仅商店被拒时启用） |
|---|---|---|
| 免费/付费分层 | **扩展整体买断收费**（全部能力需授权码） | 商店版免费基础层（点选/复制）+ 进阶能力自托管分发 |
| 授权码防共享 | **一级：离线签名码、一码多机**（无服务器） | 升级二级（一码绑 N 台设备）/ 三级（联网校验） |
| 售卖渠道 | **爱发电** | Gumroad / 自建落地页 |
| 双形态定价 | **桌面免费 + 扩展收费**（桌面插件不设授权门控） | 两端统一收费（需动桌面能力门控，不推荐） |
| 发布渠道顺序 | **Edge Add-ons 优先 → Chrome Web Store** | 被拒退路见 §12.3 |

> 依据以上决策，三期工作范围 = §12.5 全部 6 项；「发送给 AI」跨端桥接按 §12.5 第 4 项三选一（推荐 A 剪贴板交接起步）。
