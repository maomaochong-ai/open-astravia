---
title: 创建第一个插件
description: 创建、构建并安装一个最小 Vetta 桌面插件。
---

## 前置条件

- Bun、TypeScript 和 Vite。
- React 19。
- 用于安装和调试插件的 Vetta 桌面客户端。

## 项目结构

```text
my-plugin/
├── plugin.json
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── index.tsx
    └── style.css
```

## 配置构建

通过 `@vetta-org/plugin-vite` 配置 Module Federation：

```ts
import tailwindcss from "@tailwindcss/vite";
import { vettaPluginFederation } from "@vetta-org/plugin-vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		tailwindcss(),
		vettaPluginFederation({
			name: "my_plugin",
			entry: "./src/index.tsx",
			expose: "./plugin",
		}),
	],
	esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
```

## 创建入口

```tsx
import { definePlugin } from "@vetta-org/plugin-sdk";

function MyPanel() {
	return <div className="p-3 text-sm text-foreground">插件已加载</div>;
}

export default definePlugin({
	activate(ctx) {
		ctx.ui.registerGlobalSlot({ id: "root", component: MyPanel });
	},
});
```

:::caution[不要在模块顶层创建 JSX]
Module Federation 的共享 React 依赖在 bootstrap 后才可用。把 JSX 放在组件或 `activate()` 调用后的执行路径中。
:::

## 构建与安装

运行 `bunx vite build` 生成 `dist/mf-manifest.json`、`remoteEntry.js` 和样式文件。发布包应在归档根目录包含 `plugin.json` 和 `dist/`。

在 Vetta 的插件设置中选择本地 ZIP，授予清单声明的权限后启用插件。
