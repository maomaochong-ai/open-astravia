# Module Federation 共享依赖约定

本文档适用于使用 `@vetta-org/plugin-vite` 的 preset 和 external 插件。

## 默认共享依赖

`vettaPluginFederation()` 会把以下模块配置为 Module Federation 的
`singleton: true` 和 `import: false`：

| 模块 | 插件 `package.json` 中的要求 | 运行时来源 |
| --- | --- | --- |
| `react` | `devDependencies` 必须声明 | Desktop 宿主 share scope |
| `react-dom` | `devDependencies` 必须声明 | Desktop 宿主 share scope |
| `react-dom/client` | 不单独安装；由 `react-dom` 提供 | Desktop 宿主 share scope |
| `@vetta-org/plugin-sdk` | `devDependencies` 必须声明 | Desktop 宿主 shim/share scope |
| `@vetta/ui` | 当前默认配置下必须声明 | Desktop 宿主 share scope / `vetta-host://ui` |

依赖版本应与仓库其他插件保持一致。当前仓库使用 `react` / `react-dom`
`19.1.1`，本地包使用 `workspace:*`。

最小声明示例：

```json
{
  "devDependencies": {
    "@vetta-org/plugin-sdk": "workspace:*",
    "@vetta-org/plugin-vite": "workspace:*",
    "@vetta/ui": "workspace:*",
    "react": "19.1.1",
    "react-dom": "19.1.1"
  }
}
```

## `import: false` 的含义

`import: false` 只表示插件生产 bundle 不提供该共享模块的本地运行时副本，
运行时必须由宿主先注册。它不表示构建阶段可以省略依赖。

Module Federation 仍会在构建阶段解析本地包并检测命名导出。例如：

```ts
import { Button } from "@vetta/ui";
```

如果包没有安装，构建器会输出：

```text
Shared dependency "..." has import: false but is not installed locally.
```

此时构建可能仍然完成，但生成的远程模块无法可靠地导出命名导入，生产加载
可能失败。`react-dom/client` 是 `react-dom` 的子路径，不应添加同名独立依赖。

## 顶层求值限制

共享模块由宿主异步注入。不要在模块顶层立即创建依赖共享运行时的值，尤其是
JSX、`React.createContext()`、或基于 `@vetta/ui` 组件的常量：

```tsx
// 错误：插件 bootstrap 完成前可能读取到未初始化的共享模块。
const EmptyState = <div />;
```

把这类值放进组件函数、`activate()` 或其他确认宿主初始化完成后的路径中。

## 新增或修改插件时的清单

1. 使用 `vettaPluginFederation()` 时，先检查上述默认共享依赖是否都在
   `devDependencies` 中。
2. 修改依赖后在仓库根目录运行 `bun install`，只提交根 `bun.lock`。
3. 在插件目录运行生产构建，确认日志中没有 `Shared dependency` 警告。
4. 修改 `shared` 配置时同步检查 Desktop 宿主的 share scope 和
   `plugin-shared-modules` 导出列表。
5. 若插件是 resource-only，不需要 renderer Module Federation 入口时，不要
   引入 `vettaPluginFederation()`；否则仍需遵守本页的共享依赖契约。

## 警告排查

- `react` / `react-dom` 缺失：插件通常是非 UI 入口，但仍使用了默认 Federation
  配置；补充对应开发依赖，或改用 resource-only 构建路径。
- `@vetta/ui` 缺失：补充 `workspace:*` 开发依赖，并确认宿主版本提供
  `vetta-host://ui` shim。
- 警告重复出现：通常表示多个 preset 被并行构建；按插件目录逐一检查，
  不要只修复第一个输出警告的包。
