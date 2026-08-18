# 系统插件（presets）

除用户自行安装的插件外，还有**系统插件**——随 App 一起发布、用户**不可删除/修改**（ADR-0024）。它与普通插件用**完全相同**的 SDK 与清单，区别只在分发方式与运行时语义。

## 源码位置

源码放在 monorepo 的 `packages/plugins/presets/<id>/`，结构与普通插件包一致：

```text
packages/plugins/presets/
  svg-viewer/
    plugin.json
    vite.config.ts
    src/index.tsx
  image-gen/
    plugin.json
    vite.config.ts
    src/index.tsx
```

放进该目录会让它成为可选的系统插件 preset；还必须把 id 加入
`packages/plugins/tenants.json` 中需要它的 profile/租户清单，才会进入对应开发或打包流程。

## 构建与集成

- **构建制品**：`bun run build:presets` 先构建根 workspace 中的插件 SDK / 构建包，再逐个产出 `release/<id>-<version>.zip`。`dev` / `start` / 打包流程都会先跑它。
- **依赖管理**：presets 与其它 monorepo 包统一属于根 workspace、共用根 `bun.lock`；`@vetta-org/plugin-sdk`、`@vetta-org/plugin-vite` 等本地包经 `workspace:*` 直链仓库源码。
- **校验**：Desktop 按 preset 的 `plugin.json` 精确定位 zip，拒绝路径穿越、id/version 不一致、入口或样式缺失的归档。
- **dev**：zip 解压到 `apps/desktop/.artifacts/system-plugins/<id>/`，主进程只读该 staging，不直接读 preset 源码或 `dist/`。
- **打包**：`prepare-pack.js` 从 zip 解压到打包 staging 的 `system-plugins/<id>/`，再随 `extraResources` 进入 `Resources/system-plugins/<id>/`。

## 环境与租户打包（tenants.json）

`packages/plugins/tenants.json` 先按开发/生产 profile，再按业务租户定义
**preset id 完整列表**（非增量）。环境变量 **`VETTA_TENANT`** 选择租户
（缺省取 `default` 指向的租户名）。

- `build:presets:dev` 使用 `development` profile；`prepare:desktop-pack` 及所有 `pack` /
  `dist` 入口使用 `production` profile。
- `build:presets` / `prepare-pack` 只构建并打入当前 profile + 租户列表中的插件。
- 新增 preset 后，需要它的 profile/租户组合都要在各自数组里补上 id。

详见 `packages/plugins/AGENTS.md`。

## 运行时语义

- `source: "system"`，`listPlugins()` 运行时发现并与用户插件合并；每条含 **`rootPath`**（staging / Resources 下的插件根）。
- **不落用户态目录**：不进 `~/.vetta/plugins`、不写 `plugins-manifest.json`；每次启动从只读 staging 重新发现。
- **id 冲突**：系统插件优先、id 保留——用户安装同 id 被拒，已存在的同 id 用户插件被遮蔽。
- **权限**：`plugin.json` 声明的权限**自动全量授予**，用户不可撤。
- **停用**：默认启用，用户可在设置里关闭（偏好存 `~/.vetta/system-plugin-prefs.json`），但**不可卸载、不可改文件/权限**。
- **更新**：版本随 App，不走用户插件的 pending/reload 更新流。
- **硬隔离**：若声明 `contributionMode.hardIsolation`，agent 贡献仍受 mode gate（如插件工作台），与用户授权无关。

## 何时做成系统插件

- 想随 App 默认提供、对所有用户开箱即用、且权限敏感（自动全量授予）→ 系统插件。
- 想由用户自行选择安装、独立于 App 发版迭代 → 普通插件（[getting-started.md](./getting-started.md) 的 zip / `install-from-path`）。
