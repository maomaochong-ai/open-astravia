# ADR-0134：Git 只检测与引导安装，不随安装包内置，系统版优先

## 状态

已接受。

## 背景

Git 面板插件与 Agent 执行的 git 命令都依赖本机 git，但设置 → 环境只管理 Node 与 Python（ADR-0011）。没装 git 的用户看不到任何提示：Git 标签卡因为探测失败而不上栏，Agent 的 git 命令直接报错。macOS 更糟：没装命令行开发者工具时 `/usr/bin/git` 是占位程序，每次执行都会弹出系统安装框，插件在切换会话时的仓库探测就会反复触发它。

直觉做法是照搬 ADR-0011，把 git 也内置进安装包。

## 决策

1. **不内置，只检测并按平台引导安装。** 设置 → 环境新增「开发工具」小节显示 git 状态：
   - macOS：调起 `xcode-select --install`，由系统安装窗口接手，完成后用户点「重新检测」。
   - Windows：可一键下载 MinGit 到 `~/.vetta/runtimes/git/<version>/`（npmmirror 优先、GitHub 兜底，按 manifest 中的 sha256 校验）；另给出官方安装包链接，用于在系统范围安装。
   - Linux：按 `/etc/os-release` 给出包管理器命令供复制。
2. **系统 git 优先，与 Node/Python 相反。** 托管 MinGit 的 `cmd` 目录追加在 PATH **末尾**，只在系统没有 git 时生效，只作用于 Vetta 进程树（桌面会话、插件命令、IM sidecar），不写注册表或用户 PATH。之后装上的系统 git 会自然盖过它。
3. **检测不能执行 macOS 占位程序。** PATH 上第一个 git 是 `/usr/bin/git` 时，先用 `xcode-select -p` 确认开发者目录里真有 git，再执行 `git --version`。插件命令调用 `git` 前宿主做同样检查，缺工具时直接按 `ENOENT` 失败，插件据此显示引导而不是弹系统框。

## 取舍

- ADR-0011 内置 Python 的前提是「国内没有可达的可移植发行」。git 不满足这个前提：Git for Windows 在 npmmirror 有镜像，macOS 与 Linux 由系统渠道提供。
- macOS 没有官方可移植 git，内置就要自编译并为每个 Mach-O 签名公证；git 的安全更新也会变成随安装包发版的责任。
- 用户的系统 git 带着自己的 `~/.gitconfig`、凭据助手与 SSH 配置。托管版若像 Node/Python 那样前置，会让同一仓库在 Vetta 内外行为不一致。

## 备选方案

- 随安装包内置 git：体积与签名成本高、需要跟进安全更新、会盖过用户配置，未采用。
- 把 MinGit 写入用户 PATH，让终端也能用：属于未经同意修改系统环境，卸载 Vetta 后会留下失效路径，未采用；需要系统范围 git 的用户走官方安装包。
- 只在文档里说明需要 git：普通用户看不到，也挡不住 macOS 的反复弹窗，未采用。

## 后果

- 新装 macOS 且没有命令行工具的用户，在 Git 面板与设置页都能看到安装入口，不再被系统框反复打断；Agent 在 shell 里直接执行 git 仍会触发系统框，本 ADR 不改变 shell 行为。
- Windows 托管 MinGit 装好后立即写入主进程 PATH，新开的 shell 与插件命令可用；已启动的 IM sidecar 需重启 Vetta 才会拿到。
- 升级 MinGit 版本只需改 `apps/desktop/src/main/runtimes/manifest.json` 的 `git` 段（版本、tag、文件名与 sha256）。
