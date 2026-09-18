# 快速开始

从零搭建、构建、安装、调试一个 Vetta 桌面插件。

## 0. 在仓库外开发（推荐给 Agent）

你不需要 Vetta 的源码仓库，也不需要插件工作台。任意空目录里：

```bash
npx @vetta-org/plugin-cli init --id my-plugin --name "My Plugin"
cd my-plugin && npm install
```

脚手架会落下一份 `AGENTS.md`，把「先读手册再写代码」这条规矩和构建安装闭环交代清楚。

**手册就在工程里**——它随 `@vetta-org/plugin-sdk` 一起装进 `node_modules`：

```bash
npx vetta-plugin-cli docs      # 装完依赖后可用；未装时用 npx @vetta-org/plugin-cli docs + 它对应的 SDK 版本
```

**不要硬编码那个路径**：工作区可能把依赖提升到仓库根，一仓多插件时各插件还可能钉不同的
SDK 版本。这条命令按 Node 的解析规则找，拿回来的永远是当前工程实际编译所针对的那一份。

这一点很重要：手册与 SDK 同版本发布，因此它描述的合同**就是你即将编译的合同**。从网络现取
最新文档做不到这一点——那会教你写出用户宿主还不支持的东西，而 UI 槽位这类缺失不会在构建期
暴露，装上去只是静默跳过。

装进正在运行的 Vetta：

```bash
npm run install:vetta          # = vite build && vetta-plugin pack && vetta-plugin-cli add .
npx vetta-plugin-cli reload my-plugin   # 提示有 pending 版本时
```

`add` 传目录即可（`add .`）：它向上找到最近的 `plugin.json`，再定位该工程打出来的归档，
交给正在运行的 Desktop 校验、授权、安装，**不直接写** `~/.vetta/plugins`。

### 一仓多插件（能力市场 hub）

仓库根有 `.vetta/marketplace.json` 时（如官方能力市场那种布局），命令一律作用于「最近的那个
插件」，所以先 `cd` 进目标插件目录。在 hub 里 `init` 还会把新插件登记进那份索引——手动维护它
是最容易漏的一步，插件建好了能装能跑、市场上却看不到。

站在 hub 根执行 `add .` 会被拒绝并要求指明插件：一仓多插件时猜一个出来比报错更糟。

## 前置条件

- Node / Bun（仓库统一用 [Bun](https://bun.sh)）。
- 一个 Vetta 桌面 App（用于安装调试）。
- 插件用 React 19 + TypeScript + Vite，经 **Module Federation** 打成 remote。

## 1. 项目结构

一个最小插件项目：

```text
my-plugin/
  plugin.json          # 清单（见 manifest.md）
  ability.json         # 可选：能力详情页（见 ability-details.md）
  presentation/        # 可选：详情页 Markdown 与图片
    README.md
  package.json
  tsconfig.json
  vite.config.ts       # Module Federation + Tailwind
  src/
    index.tsx          # 插件入口：export default definePlugin(...)
    style.css          # Tailwind 入口，也可包含插件业务 CSS
```

构建产物（`dist/`）形如：

```text
dist/
  mf-manifest.json     # MF 清单（plugin.json 的 entry 指向它）
  remoteEntry.js       # MF remote 入口
  style.css            # Tailwind 生成的 utilities（由入口 import 产出）
```

## 2. package.json

```json
{
  "name": "my-plugin",
  "private": true,
  "type": "module",
  "scripts": {
	"dev": "vetta-plugin dev",
    "build": "bunx vite build",
    "check": "bunx tsc --noEmit"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.12",
    "@types/react": "^19.1.1",
    "@types/react-dom": "^19.1.1",
    "@vetta-org/plugin-sdk": "workspace:*",
    "@vetta-org/plugin-vite": "workspace:*",
    "react": "19.1.1",
    "react-dom": "19.1.1",
    "tailwindcss": "^4.1.12",
    "typescript": "^5.9.2",
    "vite": "^7.1.7"
  }
}
```

> `react` / `react-dom` 仅用于类型与本地构建——运行时由**宿主作为共享单例提供**，不会打进你的 bundle（见 [styling-and-pitfalls.md](./styling-and-pitfalls.md)）。`@vetta-org/plugin-sdk` 同理：构建时被 external 化，运行时由宿主提供。可选 UI primitives `@vetta-org/ui`（`Button` / `Dialog` / `Switch`…）需要同时设置 `hostUi: true` 并在 `devDependencies` 声明；没有使用时两者都不要添加。仓库内插件用 `workspace:*` 直链源码；仓库外插件改用发布版本号。

## 3. vite.config.ts

用 `@vetta-org/plugin-vite` 的 `vettaPluginFederation` 封装 Module Federation；**UI 插件请始终接 Tailwind**（样式只走 className，见 [styling-and-pitfalls.md](./styling-and-pitfalls.md)）：

```ts
import tailwindcss from "@tailwindcss/vite";
import { vettaPluginFederation } from "@vetta-org/plugin-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    vettaPluginFederation({
      name: "my_plugin",        // MF remoteName，与 plugin.json.moduleFederation.remoteName 一致
      entry: "./src/index.tsx", // 入口（默认即此）
      expose: "./plugin",       // 暴露名（默认 "./plugin"，与 plugin.json.moduleFederation.expose 一致）
      // hostUi: true,           // 仅在导入 @vetta-org/ui 时开启
      // package: true,         // 见 §5：构建后自动产出 release/<id>-<version>.zip
    }),
  ],
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
```

`vettaPluginFederation` 默认把 `react` / `react-dom` / `@vetta-org/plugin-sdk` 设为 `singleton`、`import:false`（用宿主的），生产构建时 external 化 SDK。设置 `hostUi: true` 后才会以相同方式共享并 external 化 `@vetta-org/ui`。构建产出 `mf-manifest.json` + `remoteEntry.js`，CSS 落 `dist/style.css`。

它还会在插件 Tailwind 编译前自动接入 plugin-sdk 的宿主主题 Token 契约，因此
`text-foreground`、`text-muted-foreground/50`、`bg-card` 等语义类可以直接使用；
无需在插件中导入 Desktop CSS 或手写 `@theme` 映射。

## 4. 样式入口 src/style.css

插件 CSS 会由 `vettaPluginFederation` 自动限定到插件根节点，并由宿主放入低优先级 layer；
不需要手写插件 id 前缀或 `@layer`。需要 Tailwind 时可以直接：

```css
@import "tailwindcss";

/* 可选：正常编写插件业务 CSS */
.panel button {
  min-width: 6rem;
}
```

## 5. 入口 src/index.tsx

```tsx
import { definePlugin } from "@vetta-org/plugin-sdk";
import { useState } from "react";
import "./style.css";

function MyPanel() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  // 可以使用 Tailwind className，也可以使用插件自己的 CSS
  return (
    <div className="flex flex-col gap-2 p-3 text-sm text-foreground">
      <button
        type="button"
        className="rounded-md border border-border bg-accent px-2 py-1"
        onClick={() => setOpen(false)}
      >
        关闭
      </button>
    </div>
  );
}

export default definePlugin({
  activate(ctx) {
    // ctx 提供全部能力出口，按需注册贡献 / 调用能力
    ctx.ui.registerGlobalSlot({ id: "root", component: MyPanel });
    const subscription = createMySubscription();
    // cleanup 只属于本次 activation；热更新的新旧实例不会互相清理。
    return () => subscription.dispose();
  },
});
```

`definePlugin` 只是身份函数。`activate()` 可返回 cleanup 函数或 `Disposable`；有状态资源优先使用这种 activation-scoped cleanup。旧插件的模块级 `deactivate()` 仍兼容。也可不用它、直接 `export function activate(ctx) {}` —— 宿主两种形态都认。

> **顶层禁用共享依赖（含 JSX）**：MF 的 react / jsx-runtime 是异步填充的，bootstrap 完成前为 `undefined`。模块顶层写 `const ICON = <svg/>` 会在求值时抛 `TypeError: ... is not a function`，整个插件加载失败。把这类 JSX 放进 `activate()` 或组件函数体内。详见 [styling-and-pitfalls.md](./styling-and-pitfalls.md)。

## 6. 构建与打包

```bash
bunx vite build      # 产出 dist/（mf-manifest.json + remoteEntry.js + style.css）
```

发布需要一个 **zip**：根目录放 `plugin.json`，其下 `dist/`。两种方式：

- **自动**：`vettaPluginFederation({ ..., package: true })`，`vite build` 后自动产出 `release/<id>-<version>.zip`（打包 `plugin.json` + `dist/` + 清单声明的 `styles` / `agent.promptPaths` / `agent.skillPaths`；存在 `ability.json` 时也打包它和 `presentation/`）。
- **手动**：自行把 `plugin.json` 与 `dist/` 一起 zip：

  ```text
  my-plugin.zip
    plugin.json
    ability.json                 # 可选
    presentation/               # 使用 ability.json 时可选
      README.md
    dist/
      mf-manifest.json
      remoteEntry.js
      style.css
  ```

> 归档根目录必须有 `plugin.json`，或只含**一个**顶层文件夹、`plugin.json` 在其中。
> 能力详情是可选的；需要 showcase、功能网格、图片或长篇 Markdown 时见 [ability-details.md](./ability-details.md)。

GitHub 能力市场有两种分发合同：schema v1/v2 从 `source.path` 目录直接安装，
所以该目录必须包含构建后的 `dist/`；schema v3 从 `releases[]` 指向的固定 ZIP
安装，市场仓库的 `source.path` 只放详情资源，`dist/` 和 ZIP 留在制品存储。
每个新版本写明已经发布的最低 App 版本、实际使用的 `pluginApiVersion`、ZIP URL
和 SHA-256；市场会按用户 App 与宿主 API 版本选择可安装的版本。见仓库的
[`docs/open-marketplace.md`](../open-marketplace.md#pluginmcp-与-bundle) 和
[ADR-0120](../adr/0120-plugin-marketplace-releases-are-versioned-artifacts.md)。

## 7. 安装

### GUI

通过桌面 App **设置 → 插件**（或独立插件页）安装：

- **本地 zip**：选择本地 `.zip` 文件（`installFromArchive`）。
- **远程 URL**：填写 zip 下载地址（`installFromUrl`）。

安装后用户插件落在：

```text
~/.vetta/plugins/<id>/versions/<version>/
```

`listPlugins()` 中每条记录含 **`rootPath`**（该版本包的绝对根路径）。

随后在该页**授予声明权限**并启用（缺权限时 API 会抛错或 warn，见 [permissions.md](./permissions.md)）。

### Agent / 脚本：`install-from-path`（ADR-0042）

宿主 Action `plugins.manage`：

```json
{
  "operation": "install-from-path",
  "path": "/abs/path/to/my-plugin-0.1.2.zip"
}
```

- 路径：本机可读 **`.zip` 绝对路径**（不限 cwd）。
- 用户确认后：按 `plugin.json` **一次授予声明权限**并默认**启用**。
- Desktop API：`window.vetta.plugins.installFromPath(path, { grantedPermissions?, enable? })`。
- 不可覆盖系统插件 id。

> **系统插件（presets）**不经此安装流，见 [system-plugins.md](./system-plugins.md)。

### 依赖注意（用户机）

仓库内 preset / external 可用 `workspace:*` 链本地 SDK。**用户自建工程**应使用发布到 registry 的 `@vetta-org/plugin-sdk` / `@vetta-org/plugin-vite` **semver**（sdk `^0.3.1`，手册随该版本进 node_modules；版本化热更新协议对应 vite `^0.2.0`，两者版本独立）。推出包含该脚手架的 Desktop 前，必须先发布对应的 vite 版本并确认 registry 可达。

## 8. 调试闭环（dev loop）

1. 插件工作台制作的用户插件首次先点「应用到 Vetta」；安装、授权和启用完成后，工作台会等待工程内的 `vetta-plugin dev` 真正就绪，再把热更新标为运行中。
2. 后续可在插件工作台开关热更新；开发进程由 Desktop 主进程持有，关闭工作台面板不会中止，不需要另开 `vite build --watch`。
3. 修改 React 组件或 CSS 后由 Vite HMR 直接更新，组件状态在 Fast Refresh 可保留时不会丢失。
4. 修改插件入口、`plugin.json`、locale 或 agent 资源时，宿主只替换当前插件的 activation，其他插件不重载。
5. permissions、commands 等安装态能力需要正式同步时，再重新构建并安装 zip。

宿主会一直保留安装版或系统插件 staging 作为稳定基线；工程内开发服务器确认 manifest 可访问并完成插件本地入口模块图转换后，才发送版本化 ready 握手并原子切换到源码 overlay。ready 前的依赖编译失败不会替换当前插件，运行中的服务器异常退出会先回退稳定版本并有限重启。React 等宿主共享依赖仍在 Renderer 的真实 share scope 中加载。

`bun run dev` 可单独启动同一个开发服务器并输出 NDJSON 状态，主要用于宿主或工具集成；使用插件工作台时不要重复启动。安装更新版本仍会记为 **pending**，直到 `reload` 才切换正式安装态的 `activeVersion`。

开发 Desktop 仓库内的 preset 时，不需要打开插件工作台。`apps/desktop` 的开发启动器默认会为当前
`VETTA_TENANT` 包含的全部 preset 启动开发服务器；直接运行即可：

```powershell
bun run --cwd apps/desktop dev
```

需要缩小启动范围时，可显式指定逗号分隔的插件 id；显式设置为空字符串则关闭插件开发服务器，回落到
staging 制品：

```powershell
$env:VETTA_PLUGIN_DEV="git,content-creation"
bun run --cwd apps/desktop dev
```

仓库外工程使用 `VETTA_PLUGIN_DEV_ROOTS`，多个绝对路径以当前平台的 PATH 分隔符分开。该入口只在未打包的 Desktop 中生效；显式选择但尚未安装的 external 使用纯内存开发记录，退出 App 后不会写入插件注册表。

## 下一步

- 清单全字段：[manifest.md](./manifest.md)
- 权限：[permissions.md](./permissions.md)
- UI 扩展点：[ui-slots.md](./ui-slots.md)
- 消息卡片：[message-cards.md](./message-cards.md)
- 对话 / 命令 / 文件 / 图像 / i18n：[conversation-and-agent.md](./conversation-and-agent.md)
- **MCP 三源聚合**：[mcp.md](./mcp.md)
- 样式与陷阱：[styling-and-pitfalls.md](./styling-and-pitfalls.md)
