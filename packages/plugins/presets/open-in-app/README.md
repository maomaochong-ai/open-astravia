# 从外部应用打开（open-in-app）

随 Astravia Desktop 发布的系统插件，也是声明式 `registerHeaderAction`（`useAction` hook）的官方示例。

会话页顶栏的统一按钮组里多一格（用户可以把它收纳或拖到别的位置），点开是下拉菜单，把当前项目目录交给本机探测到的：

- 代码编辑器（VS Code、Cursor、Trae、Zed、JetBrains 系列……）
- 文件管理器（访达 / 文件资源管理器 / Nautilus……）
- 终端（Terminal / Windows Terminal / iTerm……）

菜单里列出的就是宿主在本机探测到的应用，图标取自应用本身；末尾固定一项「用系统默认应用打开」，探测不到任何应用时也能用。

平台差异全部由宿主的 `ctx.shell` 吸收（macOS 的应用目录与 LaunchServices、Windows 的注册表与安装目录扫描、Linux 的 `.desktop`），插件本身只做菜单与文案——它不拼命令行，也不判断平台。SSH 远程项目的目录不在本机，整个按钮不显示；没有活动目录时同样不显示。`useAction` 返回 `null` 时宿主不显示它，也不占顶栏名额。

权限：`ui.slot.header-action`、`shell.open-external-app`，要求 Plugin API `^2.10.0`。

```bash
bun run build   # 生成 dist/ 与 release/open-in-app-<version>.astraviapkg
bun run test
bun run check
```
