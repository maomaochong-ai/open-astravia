# Plugin Development Rules

本目录中的包统一属于仓库根 workspace。创建或修改以下内容时，必须遵守本文件：

- `plugin-sdk/`：插件运行时 API 和类型契约。
- `plugin-vite/`：插件 Vite、Module Federation 和 zip 打包工具。
- `presets/<id>/`：随 Vetta Desktop 发布的系统插件。
- `externals/<id>/`：不随 App 打包、供用户安装的外置插件。
- `tenants.json`：按业务租户划分系统插件的打包清单（见下）。

修改子目录文件前仍需继续读取更具体的同级或下级说明文件（如存在）。

## 相关文档

- [Module Federation 共享依赖约定](./docs/module-federation.md)：说明 `vettaPluginFederation` 的宿主共享依赖、构建期本地依赖要求、顶层求值限制和验证方式。

## 租户化打包（tenants.json）

系统插件按业务租户动态构建/打包。`tenants.json` 定义每个租户要包含的
preset 插件 id 完整列表：

```json
{
  "default": "common",
  "tenants": {
    "common": ["vetta-actions", "image-gen", "svg-viewer"],
    "tenantb": ["vetta-actions", "image-gen", "svg-viewer", "demo-map"]
  }
}
```

- `default`：未指定租户时使用的租户名。
- 每个租户写**完整**插件 id 列表（不是增量）。新增 preset 后，需要它的
  租户都要在各自数组里补上对应 id。

构建/开发时通过 `VETTA_TENANT` 环境变量选择租户（缺省取 `default`）：

```bash
# dev：仅构建并 staging 当前租户的系统插件
cd packages/desktop-app
VETTA_TENANT=tenantb bun run dev

# 构建/打包 App：build:presets 与 prepare-pack 都读取同一 VETTA_TENANT
VETTA_TENANT=tenantb bun run build
```

`build-presets.mjs` 只构建/staging 该租户的插件，切换租户时会自动清理
`.artifacts/system-plugins` 下不属于该租户的旧插件；`prepare-pack.js` 只把该
租户的 zip 制品打入 `Resources/system-plugins`。同一次构建务必使用一致的
`VETTA_TENANT`，否则打包阶段会因缺少对应 zip 而报错。

若租户包含 `plugin-workbench`，`build-presets.mjs` 在算缓存哈希之前会先跑
`presets/plugin-workbench/scripts/sync-plugin-docs.mjs`，将 monorepo
`docs/plugin` 同步到该插件包内 `agent/docs/plugin/`（dev / dist 共用此路径）。

## Preset 与外置插件的区别

| 项目 | Preset 系统插件 | 外置插件 |
| --- | --- | --- |
| 源码位置 | `packages/plugins/presets/<id>/` | `packages/plugins/externals/<id>/` |
| 仓库内依赖管理 | 根 workspace 和根 `bun.lock` | 当前仓库示例同样属于根 workspace |
| Vetta 开发包依赖 | 可使用 `workspace:*` 或与本地包匹配的 semver | 仓库内同左；移出仓库后必须使用已发布版本 |
| 安装方式 | 随 Desktop 发布，不需要用户安装 | 构建 zip 后由用户安装 |
| 开发加载 | 构建 zip 后解压到 Desktop `.artifacts/system-plugins`；`bun dev` 默认叠加当前租户全部 preset 的内存 dev 链接 | 从 `~/.vetta/plugins` 读取已安装版本；显式 dev 链接可覆盖 |
| App 打包 | 从 `release/<id>-<version>.zip` 解压到 `Resources/system-plugins` | 不随 App 打包 |
| 插件制品 | `@vetta-org/plugin-vite` 在构建后生成 zip | `@vetta-org/plugin-vite` 在构建后生成安装 zip |
| 权限 | manifest 中声明的权限自动授予，不可撤销 | 安装后由用户授权 |
| 生命周期 | 默认启用，可停用，不可卸载，版本随 App | 可安装、更新、重载和卸载 |

Preset 不进入 `~/.vetta/plugins`，也不写 `plugins-manifest.json`。

`plugin-sdk`、`plugin-vite`、`presets/*` 与 `externals/*` 都列在根 workspace
中，共用根依赖图与锁文件；各插件仍保留独立的 `package.json` 和构建制品。

## 创建插件

目录至少包含：

```text
packages/plugins/<presets|externals>/<id>/
  .gitignore
  package.json
  plugin.json
  tsconfig.json
  vite.config.ts
  src/
    index.tsx
```

Preset 可参考 `presets/svg-viewer`；外置插件可
参考 `externals/global-slot-demo` 和 `externals/mobile-ui-preview`。

### package.json

Preset 和 external 插件直接纳入根 `package.json` 定义的 workspace。仓库内
需要持续跟随 SDK、构建包或其它本地包源码时，使用 `workspace:*`：

```json
{
  "name": "@vetta/plugin-example",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "bunx vite build",
    "check": "bunx tsc --noEmit"
  },
  "devDependencies": {
    "@types/react": "^19.1.1",
    "@types/react-dom": "^19.1.1",
    "@vetta-org/plugin-sdk": "workspace:*",
    "@vetta-org/plugin-vite": "workspace:*",
    "react": "19.1.1",
    "react-dom": "19.1.1"
  }
}
```

强制规则：

- 使用 `workspace:*` 时，两个开发包修改后无需发布，下一次 preset 构建直接
  使用本地源码。
- 也可使用与本地包版本匹配的 semver，例如当前版本可写
  `^0.0.1`。在根 workspace 内安装时，Bun 会链接满足该版本范围的本地
  workspace 包；插件移出本仓库后，同一声明会从 registry 安装已发布版本。
- 使用 semver 前必须确认 `plugin-sdk`、`plugin-vite` 的本地版本满足范围；
  独立构建或发布外置插件前，还必须确认对应版本已经发布到可访问的 registry。
- 不要使用 `file:`、相对路径或手工复制开发包，避免插件与仓库目录结构绑定。
- 修改插件依赖后重新生成根 workspace 锁文件。
- React、React DOM 及其类型版本应与根 workspace 保持兼容。
- 第三方运行时依赖放在 `dependencies`，构建工具放在
  `devDependencies`。

### 锁文件

- 全仓库统一提交根目录 `bun.lock`，不再维护 `packages/plugins/bun.lock`。
- 修改插件依赖后，在仓库根目录执行 `bun install`。
- preset 和 external 插件不提交自己的 `bun.lock`。
- 根 `bun.lock` 包含 `plugin-sdk`、`plugin-vite`、preset、external 示例插件
  及其第三方依赖。

### plugin.json

使用 Module Federation：

```json
{
  "id": "example",
  "name": "Example",
  "version": "0.1.0",
  "pluginApiVersion": "^1.0.0",
  "runtime": "module-federation",
  "entry": "dist/mf-manifest.json",
  "moduleFederation": {
    "remoteName": "example",
    "expose": "./plugin"
  },
  "styles": ["dist/style.css"],
  "permissions": ["ui.slot.global"],
  "author": "Vetta"
}
```

- `id` 必须与目录名一致，并且不能与其他插件重复。
- `remoteName` 使用合法的 JavaScript 标识符风格，例如下划线形式。
- 只声明实际使用的权限。
- 权限列表和 API 说明见 `docs/plugin/`（开发手册：清单 `manifest.md`、权限 `permissions.md`、各扩展点 `ui-slots.md` / `message-cards.md` / `conversation-and-agent.md`）。

### Vite 配置

Module Federation 的共享依赖约定和常见构建警告见
[docs/module-federation.md](./docs/module-federation.md)。新增或修改插件的
`vite.config.ts`、共享依赖或 `package.json` 时，必须同步检查该文档中的依赖和验证清单。

```ts
import { vettaPluginFederation } from "@vetta-org/plugin-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    vettaPluginFederation({
      name: "example",
      entry: "./src/index.tsx",
    }),
  ],
});
```

React、React DOM 和 `@vetta-org/plugin-sdk` 由宿主共享。模块顶层禁止创建
依赖共享模块的 JSX；将 JSX 放在组件或 `activate()` 内。

`@vetta-org/plugin-vite` 会在构建产物中自动用原生 `@scope` 把 CSS 限定到 manifest
声明的插件 id 根节点，并将 `:root` / `:host` 映射为 `:scope`。插件作者可以正常使用
Tailwind 或业务 CSS，不要手写插件 id 前缀，也不要依赖修改 `body`、`html` 或宿主私有 class。

## 测试要求

各子包遵循根目录的风险分级，并按插件层级选择测试方式：

- `plugin-sdk` 的公开类型、manifest/权限 Schema、注册与释放合同发生变化时，必须使用 Vitest 合同测试覆盖合法输入、拒绝输入和兼容路径。
- `plugin-vite` 的 Module Federation 配置、CSS scope、manifest、zip 路径或构建产物发生变化时，必须使用临时 fixture 做构建/制品集成测试；只断言内部函数或大面积快照不足以证明产物可加载。
- Preset/External 的 React UI 行为使用该插件包显式声明的 Vitest + `jsdom`/`happy-dom` + React Testing Library；点击、表单、异步状态、权限导致的显示差异和宿主回调必须按用户行为测试。没有测试基线的插件在首次重要 UI 变更时应在同一任务补齐，不得依赖 workspace 偶然提升的依赖。
- `activate()`/deactivate、资源注册/撤销、权限、宿主 Slot、命令和生命周期变化必须测试成功、拒绝、重复调用和清理；宿主 API 在 Plugin SDK 边界使用窄 fake。
- 修改 `plugin.json`、共享依赖、Vite 配置或打包脚本时，除定向测试外必须运行目标插件实际 build 并检查生成 manifest/zip；纯样式且无交互变化时可以不新增单元测试，但应完成适用的视觉检查。

插件测试应放在对应子包并由其 `test` script 独立运行，避免测试反向依赖 Desktop 私有实现。需要验证宿主集成的行为由 Desktop 包补充合同或 E2E 测试，不在插件测试中复制宿主实现。

## 安装、构建与验证

在仓库根 workspace 安装依赖，再进入目标插件目录构建：

```bash
bun install

cd packages/plugins/<presets|externals>/<id>
bun run build
```

验证所有 Preset 和仓库：

```bash
cd packages/desktop-app
bun run build:presets
bunx tsc --noEmit

cd ../..
bun run check
```

`build:presets` 会先按根 `bun.lock` 为根 workspace
执行一次 `bun install --frozen-lockfile`，构建根 workspace 中的 SDK/构建包，
再遍历 `presets/` 构建。每个插件构建会生成 `dist/` 和
`release/<id>-<version>.zip`，随后 zip 会经过路径、manifest 和入口校验，
解压到 `packages/desktop-app/.artifacts/system-plugins/<id>/` 供开发加载。

## 提交前检查

- 系统插件位于 `packages/plugins/presets/<id>/`，外置插件位于
  `packages/plugins/externals/<id>/`。
- preset 和 external 插件已纳入根 workspace。
- 根 `bun.lock` 已更新。
- `@vetta-org/plugin-sdk` 和 `@vetta-org/plugin-vite` 使用 `workspace:*`，或使用
  可由当前本地包满足且已按发布场景验证的 semver。
- `dist/`、`release/`、`node_modules/` 已加入 `.gitignore`，没有提交。
- `plugin.json` 的入口与实际构建产物一致。
- `release/<id>-<version>.zip` 根目录包含 `plugin.json` 和完整运行时文件。
- `bun run build:presets`、`bun run check` 和 Desktop TypeScript 检查通过。
