# 快捷面板触发器改回「双击功能键」，引入 uiohook-napi 原生全局监听

推翻 ADR-0034。快捷面板呼出方式改为**双击一个功能键**（设置页单选：不启用 / 双击 ⌘·Ctrl / 双击 ⌥·Alt / 双击 ⇧），全局生效（APP 未聚焦/隐藏时也能唤出）。配置存 `~/.astravia/config.json` 的 `quickPanel.trigger`（`none`|`mod`|`alt`|`shift`，缺省 `none`）。

双击裸功能键超出 Electron `globalShortcut` 能力，故引入 `uiohook-napi`（N-API 原生全局键盘监听，含各平台 prebuild）。`src/main/quickpanel-trigger.ts` 在 main 进程检测「干净点按」（目标功能键按下→抬起且期间无其它键），两次点按间隔 ≤350ms 即 toggle 面板。仅在 `trigger !== "none"` 时 `uIOhook.start()`，默认关=不监听、零开销、不申请权限。

ADR-0034 当初为「零原生依赖/零权限」而把需求缩水成普通组合键；现明确接受原生依赖换取「双击功能键」的产品手感。

## Consequences

- **首个原生模块**：electron-builder 自动 unpack `*.node` 并打入 prebuild；`vite.main.config.ts` 把 `uiohook-napi` 列入 `external`（不进 bundle，运行时从 node_modules 解析）。
- **macOS 权限**：首次启动监听触发系统「输入监控」授权；未授权则收不到事件。设置页对 mac 显示授权提示。Windows 的低级键盘 hook 无需权限。
- 触发回调在 main 进程运行，直接调 Electron 窗口 API 安全。

## Status

accepted（supersedes ADR-0034）
