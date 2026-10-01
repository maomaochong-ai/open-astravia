> **Status: superseded by ADR-0035。** 后续改回「双击功能键」并接受引入原生监听依赖，本 ADR 的「普通组合键」方案已废弃，仅留作决策轨迹。

# 快捷面板触发器用普通全局组合键，不做「双击功能键、分左右」

快捷面板（Quick Panel）的原始需求是「双击功能键启动、区分左/右功能键」。落地时改为用 Electron `globalShortcut` 注册的**普通全局组合键**（用户在「快捷键设置」录制，默认不启用、无预设键）。

原因：双击裸功能键 + 区分左右功能键超出 `globalShortcut` 能力，必须写原生 OS 级键盘监听（macOS NSEvent `flagsChanged` / Windows `SetWindowsHookEx WH_KEYBOARD_LL`），意味着原生 addon 或捆绑 helper、可能的 macOS Accessibility 权限、以及两套平台代码长期维护。权衡后取普通组合键：跨平台免费、零原生代码、无权限弹窗；代价是触发手势不如双击功能键顺手。

## Consequences

- 配置存 main 进程 desktop config（`~/.astravia/config.json`），不走 renderer `localStorage`——`globalShortcut.register()` 仅 main 可调。
- 若日后要补「双击功能键」，是新增原生监听通道的独立工作，不影响本期组合键路径。

## Status

accepted
