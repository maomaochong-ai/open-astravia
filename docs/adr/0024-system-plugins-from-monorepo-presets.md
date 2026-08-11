# 系统插件源在 monorepo presets，统一使用 zip 制品，不 seed-copy 进 ~/.vetta

需要一类**随 App 发布、用户不可删改**的插件（[[系统插件]]）。仓库已有「内置 vendor 首启拷进 `~/.vetta` 托管目录」的 seed 先例（ADR-0011），但那是因为运行时需要可写的执行位置；插件无此需要。

决定：[[系统插件]]的源以 [[预置插件]]形式放在 `packages/plugins/presets/<id>/`（monorepo 内维护），与插件 SDK、构建工具及其它 monorepo 包统一纳入根 workspace，共用根 `bun.lock`。插件开发通过 `workspace:*` 直接链接 `@vetta-org/plugin-sdk`、`@vetta-org/plugin-vite` 等本地包。每个插件独立构建 `release/<id>-<version>.zip`。Desktop 在开发准备和应用打包阶段都只消费 zip：校验归档路径、manifest、id/version 和入口文件后，分别解压到 `packages/desktop-app/.artifacts/system-plugins/<id>/` 与打包 staging 的 `system-plugins/<id>/`。稳定运行时只读取解压后的只读目录，**不读取 preset 源码目录、不拷贝进 `~/.vetta`、不写 `plugins-manifest.json`**。未打包 Desktop 可按 ADR-0066 建立纯内存开发 overlay；staging 仍是其身份、信任和失败回退基线，源码目录只有在项目本地开发服务器完成版本化 ready 握手后才生效。`vetta-plugin://` 解析器按记录的 `source` 选 base 目录（打包 `process.resourcesPath/system-plugins`、dev `.artifacts/system-plugins`），`listPlugins()` 在运行时发现系统插件并与用户插件注册表合并返回。

配套语义：
- **来源**：`InstalledPlugin.source` 新增 `"system"`，与 `"archive" | "remote"` 并列。
- **id 冲突**：系统插件优先、id 保留——用户安装同 id 被拒，已存在的同 id 用户插件被系统遮蔽。守住「用户不可修改系统插件」不变量。
- **权限**：manifest 声明的权限启动即全量视为 granted，用户不可撤（一方随包发的可信代码，再走授权弹窗无意义）。
- **停用**：默认启用，用户可在设置里关闭（偏好持久化进 `~/.vetta/system-plugin-prefs.json`），但不可卸载、不可改文件、不可改权限。
- **更新**：版本随 App，不走用户插件的 `availableVersion / pendingVersion` 更新流。

## Considered Options

- **seed 进 `~/.vetta/plugins`（复刻 ADR-0011 vendor 模式）**：把内置插件 zip/dist 首启拷进用户插件目录、写进 `plugins-manifest.json`、打 `source:"system"`。复用现有协议解析与加载链最多、零 resolver 改动。被否：① 物理落进用户可写目录，「不可修改」只能靠每次启动重新 seed 覆盖兜底，存在篡改窗口；② 系统与用户文件混在一处，污染 `manifest.json`（本应只存用户态）与卸载/覆盖逻辑；③ 与「插件无需可写执行位」的事实不符——seed 是为 vendor 的可写需求设计的，照搬属过度机制。
- **把 zip 原样带进安装包并在启动时解压**：被否。Module Federation 运行时仍需要访问 manifest、remote entry、CSS 和 chunks；启动时解压会增加可写托管目录和启动成本。zip 只作为统一的构建制品，在开发准备和打包阶段解压。
- **App 启动时现场 build presets**：运行时需带 node/vite 工具链，慢且脆，直接否。

## Consequences

- `vetta-plugin://` 解析器要从「单一 `pluginsBaseDir`」改为「按 source 选 base 目录」，且需持有一份运行时发现的系统插件 id 集合（解析器只拿到 pluginId）。
- `plugins-manifest.json` 只记录用户插件；系统插件停用偏好单独写入 `system-plugin-prefs.json`。系统插件本体不入用户目录，每次启动从对应 `system-plugins` staging 重新发现。
- `build:presets` 先构建根 workspace 中的 `plugin-sdk`、`plugin-vite`，再逐个构建插件 zip，并将 zip 校验解压到 Desktop 开发 staging；应用开发启动不再直接读取 preset 的 `dist/`。
- preset 进入根 workspace 和根 `bun.lock`；`build:presets` 根据根依赖清单与锁文件按需执行一次冻结安装。
- `prepare-pack.js` 从每个 preset 的 `release/<id>-<version>.zip` 重新校验解压到打包 staging，再经 `extraResources` 随包。
- zip 缺失、manifest 与源码不一致、包含路径穿越条目或缺少入口/样式文件时，开发准备和打包直接失败，避免使用陈旧或不完整的 `dist`。
- 既有 `svg-viewer` 示例迁入 `packages/plugins/presets/svg-viewer` 成为首个系统插件；`global-slot-demo` 留作纯示例不随包。
- 安全面：系统插件自动全量授权且不可停文件级修改，其可信度完全由「随 App 发布 + 代码评审」这道闸保证，与 [[可信插件]]（ADR-0023）同一信任前提的延伸。
