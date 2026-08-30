# @astravia/plugin-web-element-picker

## [Unreleased]

### Added

- 三期浏览器扩展形态（`extension/`，MV3）：授权码买断体系 + popup 控制面 + 内核注入。新增：
  - `license.ts`：一级离线授权码（ECDSA P-256/SHA-256 验签，base32 编码，`WEP-<payload>.<signature>`），浏览器/Node 通用 WebCrypto；`license-keygen.mjs` / `license-sign.mjs` 生成密钥对与签发；
  - `manifest.json`（v0.3.1）+ content script（document_start 注入内核）+ 主世界桥 `inject-main.js`（拼接内核成 `kernel-inject.js`）+ background service worker（事件汇总 / 授权门控 / 截图下载 / 命令转发，无接收端安全吞错）+ popup 控制面（激活表单 / 开始停止 / 写轮眼开关 / 状态轮询）；
  - `build-extension.mjs` 一键构建 + zip 商店包；`e2e.mjs` Playwright 端到端验证（注入 / 授权门控 / 激活 / 挂载 / 事件回流 / 设置 / 停止 / 导航恢复，8/8 通过）；
  - 权限最小集（storage / activeTab / clipboardWrite / downloads），无远程代码，符合商店「全部本地处理」声明；
  - 「发送给 AI」跨端采用方案 A 剪贴板交接（content script 兜底写剪贴板 + 门控校验）。

- 输入栏 action 入口（`registerInputAction("element-picker")`）：从对话输入栏直达/聚焦选择器并发送 `start-select` / `stop-select` 意图。
- 设置面板 `sharingan`（截图回传）开关，经 `ctx.settings` 读写，写入宿主 preload `astravia.plugins.setSettings`（localStorage 降级）。
- `lastUrl` 迁移到插件 storage（`storage.readJson/writeJson`），带 localStorage 升级路径。
- 宿主桥 adapter 抽象（`WepBridge`，`mount({ bridge })` 注入）：为三期浏览器扩展形态预留换桥点，默认 `consolePost` 与一期行为一致。

### Fixed

- 二次打开渲染失败：webview 重建后事件绑定改为单次 `useEffect([])` + `handlersRef` 映射；`reconcileLoad()` 在 `dom-ready`/`did-finish-load` 幂等补齐待加载 URL；选择模式下 `dom-ready` 重注内核；`render-process-gone` 恢复；停止选择时重置本地状态，不再依赖页面确认。
- 地址栏回车无响应（打包应用实测）：`handlersRef` 映射键使用 `onNavigate` 等 `onXxx` 命名，而事件绑定查询按 webview 事件名（`did-navigate` 等）取值，二者不匹配导致全部事件回调失效，面板对加载/导航零响应；改为直接以事件名作键，与 `useEffect` 绑定逻辑一致。
- 真实网页（如百度）点击链接无响应：webview 开启 `allowpopups`，`target=_blank` / `window.open` 经宿主 main 进程 popup 重定向（`setWindowOpenHandler` → 同 webview `loadURL`）同窗加载，与内置浏览器一致。曾用页面内 capture 拦截（`preventDefault` + `location.href`）改同窗跳转，实测 Electron 34 webview 中 `location.href` 赋值存在非确定性失败（赋值后不跳转），已废弃，跳转完全依赖宿主 popup 重定向。
- 内核 mount 失败回滚：监听器/UI 清理并上报 `mount-failed`，避免“僵尸内核”吞点击；`applyLang` 重建受保护。
- 扩展 popup 点「开始选择」无反馈：background 返回的失败原因（`no-inject` / `no-tab`）此前被丢弃，现显示明确错误提示（含中英文案），引导在普通网页上使用或刷新重试。
- 扩展 popup 截图结果文案错位：截图成功/失败时误显示「已复制到剪贴板」「授权码无效或已过期」，现分别显示「截图已保存到下载目录」「截图保存失败，请重试」（新增中英文案）。

### Changed

- 内置面板工具栏精简：地址栏右侧「开始选择 / 发送给 AI / 写轮眼模式」按钮改为纯图标（悬停提示保留，选中/开启态以颜色与图标区分），与「打开外部 / 设置」按钮风格统一。
- 扩展 popup 控制面 UI 重设计：品牌头部（渐变 Logo + 版本徽章）、状态卡（激活徽章 + 订单/有效期）、渐变主按钮、iOS 风格开关、快捷键提示卡，浅色/深色模式自适应。
- 内置面板图标自绘 SVG：弃用 iconify 魔法类（`icon-[mdi--…]`，构建 CSS 中缺失导致图标全部渲染为空白），改为内联 SVG 线性图标组件（24 网格 / 1.5px 线宽 / `currentColor` 着色，随按钮主题色）；地址栏工具栏「开始选择 / 发送给 AI / 写轮眼模式」按钮去掉背景填充（原 `bg-primary` / `bg-accent`），改为图标着色 + hover 浅底色，与导航按钮风格统一；停止图标由实心方块改线框，避免切换后看不出图标。

### Fixed

- 扩展 popup「写轮眼模式」开关无法切换：background 收到 `wep-settings` 后只转发给 content script，未把设置写回 session storage，popup 每 600ms 轮询 `get-state` 时读到 `settings: null` 把开关重置回旧值；现由 background 合并写入 session storage 作为回流来源，并保留 content script 的 sync 持久化（浏览器重启后 `get-state` 回退读取 sync）。
- 扩展在外部浏览器（如 Firefox）无法加载：manifest 声明 `"type": "module"` 的 module service worker 兼容性差（Firefox 不支持），而产物 `background.js` 实为自包含 bundle（无顶层 import/export），改为 iife 经典脚本并移除 `"type": "module"`，各浏览器均可直接加载。

## [0.1.0]

### Added

- 初始版本：网页元素选择器（桌面插件形态），内置选择/多选/截图/复制/发送等能力。
