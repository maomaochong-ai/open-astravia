# ADR-0067：npm 作为 Desktop 插件的分发信封

## 状态

Accepted

## 背景

Desktop 已有经过资源校验、权限审批、版本暂存与 reload 激活的 zip 安装链路。外置插件作者希望利用 npm 的版本、tag、缓存和访问控制，并让用户通过一条 `npx ... add` 命令完成安装。若让 npm 包直接执行安装脚本或直接写 `~/.vetta/plugins`，会绕过宿主的清单校验、系统插件保护、权限审批和生命周期管理；若再定义一套 npm 专用插件布局，则会产生第二个安装事实源。

同时，无作用域包名 `vetta` 已被注册，新的公开安装器不能依赖该名称。

## 决策

1. npm 只承载现有 Desktop 插件 zip，不定义第二种运行时布局。公开安装器包名为 `@vetta-org/plugin-cli`，调用方式为 `npx @vetta-org/plugin-cli add <package-spec>`。
2. npm 插件包在 `package.json#vetta` 声明版本化元数据：`schemaVersion: 1`、`type: "desktop-plugin"`、`pluginId` 与包内 zip 相对路径。npm 包版本、元数据和 zip 中 `plugin.json` 的版本与 id 必须一致。
3. `@vetta-org/plugin-vite` 通过显式 `npmArchive: true` 同时生成原有版本化 zip 和稳定的 `release/vetta-plugin.zip`。稳定文件与版本化文件字节一致，便于写入 npm `files`，不会改变未启用该选项的插件构建。
4. CLI 只接受 npm registry 的 package、tag、version 或 range，不接受 git、目录和远程 tarball spec。它使用 `npm pack --ignore-scripts`，不运行包的 lifecycle script；解包时只接收 regular file，并只提取 `package.json` 与声明的 zip。CLI 计算 zip SHA-256 后通过本机 Action RPC 请求 `plugins.manage`，不直接修改 Desktop 状态目录。
5. Desktop 是最终信任边界。主进程在复制文件前重新校验 zip SHA-256、`plugin.json` id/version 与 CLI 提交的期望值；npm 来源按 community trust 处理，不能由包自身提升权限。系统插件 id 保护、权限审批、默认启用、升级 pending/reload 等继续复用既有安装路径。
6. npm provenance 以结构化 `distribution` 数据随安装记录保存，包括 package name、requested spec、resolved version 与可选 registry integrity；用户可见来源和 App Monitor 使用独立的 `npm` 来源值。

## 备选方案

| 方案 | 未采纳原因 |
| --- | --- |
| 发布无作用域 `vetta` CLI | 名称已被注册，且不能表达它只是插件安装器 |
| npm `postinstall` 直接写 Desktop 目录 | 会执行不可信代码并绕过宿主校验、审批和生命周期 |
| CLI 自己实现插件注册表写入 | 与 Desktop 主进程形成两个状态所有者，运行中的应用也无法安全刷新 |
| npm 包直接作为插件根目录 | 需要维护第二种布局、资源校验和升级语义 |
| 使用 `npm view` 后自行下载 tarball | 会重复实现 registry 配置、认证、代理、缓存和完整性处理 |

## 后果

- 安装要求 Vetta Desktop 正在运行且本机 Action RPC 可用；CLI 不提供离线写注册表模式。
- 发布者需要同步维护 npm package version、`package.json#vetta` 与 `plugin.json` 身份，构建期会在不一致时失败。
- `@vetta-org/plugin-cli` 的发布制品必须是自包含 Node ESM bundle，运行时不能依赖 monorepo workspace 包。
- npm 解决的是分发与版本选择，不代表插件已被官方审核；权限和 trust 仍由 Desktop 决定。
