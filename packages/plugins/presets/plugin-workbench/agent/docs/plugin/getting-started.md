# 快速开始

从零搭建、构建、安装、调试一个 Vetta 桌面插件。

## 前置条件

- Node / Bun（仓库统一用 [Bun](https://bun.sh)）。
- 一个 Vetta 桌面 App（用于安装调试）。
- 插件用 React 19 + TypeScript + Vite，经 **Module Federation** 打成 remote。

## 1. 项目结构

一个最小插件项目：

```text
my-plugin/
  plugin.json          # 清单（见 manifest.md）
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

> `react` / `react-dom` 仅用于类型与本地构建——运行时由**宿主作为共享单例提供**，不会打进你的 bundle（见 [styling-and-pitfalls.md](./styling-and-pitfalls.md)）。`@vetta-org/plugin-sdk` 同理：构建时被 external 化，运行时由宿主提供。可选 UI primitives `@vetta/ui`（`Button` / `Dialog` / `Switch`…）同样由宿主单例提供，需要时在 `devDependencies` 加类型依赖即可。仓库内插件用 `workspace:*` 直链源码；仓库外插件改用发布版本号。

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
      // package: true,         // 见 §5：构建后自动产出 release/<id>-<version>.zip
    }),
  ],
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
```

`vettaPluginFederation` 自动：把 `react` / `react-dom` / `@vetta/ui` 设为 `singleton`、`import:false`（用宿主的），把 `@vetta-org/plugin-sdk` 与 `@vetta/ui` 设为 external，产出 `mf-manifest.json` + `remoteEntry.js`，CSS 落 `dist/style.css`。

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
  },
  deactivate() {
    // 可选：清理你自己起的副作用（定时器、监听等）。
    // 注册返回的 Disposable 已由宿主在卸载时统一处置，无需手动 dispose。
  },
});
```

`definePlugin` 只是身份函数，返回 `{ activate, deactivate? }`。也可不用它、直接 `export function activate(ctx) {}` —— 宿主两种形态都认。

> **顶层禁用共享依赖（含 JSX）**：MF 的 react / jsx-runtime 是异步填充的，bootstrap 完成前为 `undefined`。模块顶层写 `const ICON = <svg/>` 会在求值时抛 `TypeError: ... is not a function`，整个插件加载失败。把这类 JSX 放进 `activate()` 或组件函数体内。详见 [styling-and-pitfalls.md](./styling-and-pitfalls.md)。

## 6. 构建与打包

```bash
bunx vite build      # 产出 dist/（mf-manifest.json + remoteEntry.js + style.css）
```

发布需要一个 **zip**：根目录放 `plugin.json`，其下 `dist/`。两种方式：

- **自动**：`vettaPluginFederation({ ..., package: true })`，`vite build` 后自动产出 `release/<id>-<version>.zip`（打包 `plugin.json` + `dist/` + 清单声明的 `styles` / `agent.promptPaths` / `agent.skillPaths`）。
- **手动**：自行把 `plugin.json` 与 `dist/` 一起 zip：

  ```text
  my-plugin.zip
    plugin.json
    dist/
      mf-manifest.json
      remoteEntry.js
      style.css
  ```

> 归档根目录必须有 `plugin.json`，或只含**一个**顶层文件夹、`plugin.json` 在其中。

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

仓库内 preset 可用 `workspace:*` 链本地 SDK。**用户自建工程**应使用已发布的 `@vetta-org/plugin-sdk` / `@vetta-org/plugin-vite` **semver**（当前 sdk `^0.1.1` / vite `^0.0.5`，两者版本独立），并保证 registry 可达。

## 8. 调试闭环（dev loop）

1. 改代码 → `bunx vite build`（或工作台 `build-and-pack.mjs`）。
2. 重装 zip / `install-from-path`（presets 走 `build:presets` staging）。
3. **强制刷新缓存**：bump `plugin.json` 的 `version`，再 `reload(id)`（或重开 App）。
4. 设置页或 `window.vetta.plugins.reload(id)`。

> 安装更新版本常记为 **pending**；持续加载 `activeVersion`，直到 `reload` 才切 UI。

## 下一步

- 清单全字段：[manifest.md](./manifest.md)
- 权限：[permissions.md](./permissions.md)
- UI 扩展点：[ui-slots.md](./ui-slots.md)
- 消息卡片：[message-cards.md](./message-cards.md)
- 对话 / 命令 / 文件 / 图像 / i18n：[conversation-and-agent.md](./conversation-and-agent.md)
- **MCP 三源聚合**：[mcp.md](./mcp.md)
- 样式与陷阱：[styling-and-pitfalls.md](./styling-and-pitfalls.md)
