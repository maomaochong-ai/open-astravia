# 样式与陷阱

把这页当 checklist：以下几条都踩过坑，足以让插件「加载失败」「元素不可见」「改了不生效」「污染宿主 UI」。

## 样式隔离：正常写 Tailwind 或 CSS

使用 `@vetta-org/plugin-vite` 构建时，插件 CSS 会自动包进以
`[data-vetta-plugin-root="<id>"]` 为根的原生 `@scope`，`:root` / `:host` 会自动映射为
`:scope`。
插件作者不需要手写插件 id 前缀或 cascade layer，可以正常使用 Tailwind，也可以编写业务 CSS。

宿主加载插件 CSS 时还会统一放入低优先级 `vetta-plugins` layer，兼容旧版构建产物，
避免插件样式覆盖 Desktop。插件仍与宿主共享同一 document，不要依赖修改 `body`、`html`
或宿主私有 class；这些选择器在新版构建中不会匹配到插件根以外的元素。

| 允许 | 禁止 |
| --- | --- |
| JSX：`className="flex h-8 gap-2 rounded-lg bg-background text-foreground"` | 依赖修改 Desktop 私有 class |
| `.panel button { padding: 8px }` 等插件业务样式 | 用 `body` / `html` 定制 App 外壳 |
| 在 `:root` 定义插件内部变量（构建后映射到插件根） | `createPortal(..., document.body)` 逃出插件根 |

主题色优先用 **宿主 CSS 变量**对应的 Tailwind 语义类（或 `var(--foreground)` 仅出现在不可避免的例外里）：`--foreground` / `--background` / `--border` / `--primary` / `--muted` 等。

### Tailwind 入口

需要 Tailwind 时，`src/style.css` 可以直接导入完整 Tailwind；preflight 和 utilities 都会被自动限制在插件根：

```css
@import "tailwindcss";
```

- Vite 配 `@tailwindcss/vite`；入口 `import "./style.css"` 一次即可。
- `vettaPluginFederation` 会在 Tailwind 编译前自动注入
  `@vetta-org/plugin-sdk/tailwind-theme.css` 的纯 Token 契约；插件不需要导入
  Desktop CSS、SDK 主题 CSS，也不需要重复声明 `@theme`。
- `plugin.json`：`"styles": ["dist/style.css"]`。
- 如不需要 preflight，也可以继续只导入 `theme.css` + `utilities.css` 以减小产物。

`text-foreground`、`text-card-foreground`、`text-muted-foreground/60`、
`bg-card`、`border-border` 等语义工具类会引用宿主运行时 CSS 变量并随主题切换；
插件制品不包含 Desktop 的实际颜色值或组件样式。

### JSX 示例

```tsx
// ✅ 仅 Tailwind className
function Panel() {
  return (
    <div className="flex h-full flex-col gap-2 p-3 text-sm text-foreground">
      <button type="button" className="rounded-md border border-border bg-accent px-2 py-1">
        刷新
      </button>
    </div>
  );
}

// ✅ 也可以 import 插件自己的业务 CSS，构建工具会自动加作用域
// import "./panel-styles.css";
```

Agent 写插件时可以按普通 React 项目使用 `className` 或 CSS；不要为了隔离手写插件 id 前缀。

---

## 面板类 slot 布局边界（禁止 viewport 级浮层）

插件 UI 与宿主**共享同一 document / 同一 React 树**（无 iframe / Shadow 沙箱）。面板类扩展点渲染在活动面板的有限矩形内，**不得**做成贴浏览器/App 视口的全局浮层。

### 哪些算「面板类」

| 扩展点 | 布局预期 |
| --- | --- |
| **`registerFilePreview`** | 内容铺满预览区；所有 UI 留在预览壳内 |
| **`registerActivityTab`** | 内容铺满 Tab 面板；所有 UI 留在面板内 |
| **`registerInputAction` 面板内容**（若有） | 同面板约束 |
| **`registerGlobalSlot`** | **例外**：这是全局浮层扩展点，可相对视口布局 |
| **`ctx.ui.notify`** | **例外**：全局 Toast，由宿主渲染，不要自己造右上角固定条 |

### 硬规则（agent / 作者）

1. **禁止**在面板类 slot 内用 Tailwind `fixed` / `sticky` 去贴窗口（如 `fixed right-4 top-4`、`fixed inset-0` 当全屏遮罩）。
2. **禁止**超高 z-index 抢宿主 chrome（如 `z-[2147483647]`）。面板内层级用普通 `z-10` / `z-20` 即可。
3. 面板内需要「浮在内容上」的工具条 / 调试按钮：根节点 `relative`，子节点用 **`absolute`**（相对面板，不是视口）。
4. 需要真正的**全局** UI（设置引导、跨页面悬浮球）→ 用 **`registerGlobalSlot`**（权限 `ui.slot.global`），不要塞进 file-preview / activity-tab。
5. 需要错误/提示 → **`ctx.ui.notify`**，不要自己 `fixed` 一个 Toast。
6. **不要** `createPortal(..., document.body)` 把节点挂到 body 逃出面板；弹层留在组件树内，或 portal 到本面板根节点（若必须 portal）。

### 正反例

```tsx
// ❌ 相对视口：会跑到 App 窗口角落 / 盖住宿主 chrome
<button type="button" className="fixed right-4 top-4 z-[2147483647] ...">
  测试
</button>

// ✅ 相对预览/面板根：工具条贴在内容区右上角
function Preview() {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <button
        type="button"
        className="absolute right-3 top-3 z-10 rounded-md border border-border bg-background px-2 py-1 text-xs"
      >
        测试
      </button>
      {/* 预览主体 */}
    </div>
  );
}
```

### 宿主侧兜底（file-preview）

`registerFilePreview` 的挂载壳会建立 **fixed containing block**（`transform`）并 `overflow: hidden` + stacking `isolate`：即便误写了 `fixed`，也会被收进预览矩形，而不是贴 App 视口。  
**这是兜底，不是许可证**——实现仍须按上面规则写 `absolute` / 走 global / notify。activity-tab 等其它面板目前主要靠约定；不要依赖「写 fixed 宿主会修好」。

详见 [ui-slots.md → 文件预览](./ui-slots.md#文件预览-registerfilepreview)。

---

## Module Federation 顶层 JSX 陷阱

**模块顶层不要使用共享依赖（含 JSX）。**

MF 的共享模块（`react` / `react/jsx-runtime`）是**异步填充**的——bootstrap 完成前为 `undefined`。模块顶层的 JSX 字面量会在模块求值时立即执行，此时 `jsx` 运行时还没就位：

```tsx
// ❌ 顶层 JSX：模块求值即抛 TypeError: ... is not a function，整个插件加载失败
const ICON = <svg viewBox="0 0 24 24" />;

// ✅ 放进组件函数体或 activate() 内（求值被推迟到运行时，依赖已就位）
function Icon() {
  return <svg viewBox="0 0 24 24" />;
}
```

同理，别在模块顶层直接调用任何共享依赖的运行时值。图标、常量化的 JSX、`React.createContext(...)` 等都放进函数体内或 `activate()`。

## React 是宿主单例

`react` / `react-dom` 运行时由**宿主作为共享单例**提供，不打进你的 bundle（`vettaPluginFederation` 已设 `singleton + import:false`）。因此：

- 你的插件与宿主用**同一个 React**，hook、context、状态都跨得过去（这正是 `useActiveConversation` 等能工作的前提）。
- `package.json` 里的 `react` 只用于类型与本地构建，别试图 bundle 一份自己的 React。
- `@vetta-org/plugin-sdk` 同样 external，运行时由宿主提供。

## 可选：`@vetta/ui` 宿主 primitives

插件**可以**直接使用宿主的设计系统 primitives，与 App chrome 对齐：

```tsx
import { Button, Switch, Slider, Dialog, DialogContent, cn } from "@vetta/ui";
```

约定：

| 项 | 说明 |
| --- | --- |
| 运行时 | 由宿主单例提供（MF share + `vetta-host://ui`），**不要**打进插件 bundle |
| 构建 | `vettaPluginFederation` 已把 `@vetta/ui` 设为 `shared.singleton + import:false`，并 rollup external |
| `package.json` | 仅作类型 / 本地 tsc：`devDependencies` 里 `@vetta/ui`（仓库内 `workspace:*`，仓库外按发布版本） |
| 样式 | 组件 class 走宿主全局 token / Tailwind；插件 scoped CSS **管不到** Dialog 等 portal 到 `document.body` 的浮层（浮层依赖宿主已加载的全局样式，这是预期行为） |
| 宿主版本 | 需要宿主提供 `vetta-host://ui` shim：desktop-app **>= 0.5.31**，且 `@vetta-org/plugin-vite` **>= 0.0.5**。旧宿主上 import `@vetta/ui` 会在加载插件时解析失败（模块找不到，整个插件不激活）——若你的插件要兼容更早的 App，就别用这条通道，自写 JSX + 语义 class |
| 稳定性 | **半稳定、可选**。宿主会尽量不无故破坏，但不对跨 App 大版本做 semver 承诺；props / 导出变更时官方插件随 monorepo 同改 |
| 不在此列 | `@vetta/theme-ui`（业务 View）**尚未**作为插件共享依赖；需要时再另开通道 |

默认路径仍是：自写 JSX + 语义 class（`bg-background` / `text-foreground`…）。`@vetta/ui` 适合按钮、开关、对话框等控件统一，不是强制。

顶层不要对 `@vetta/ui` 做立即求值（与 React 相同，见上文「MF 顶层 JSX 陷阱」）——在组件函数内使用即可。

## 缓存刷新

插件 bundle 经 `vetta-plugin://` 协议加载，**Chromium 会缓存 `remoteEntry.js`**——你改了代码重装，**重启 App 也未必清掉旧缓存**，表现为「改动不生效」。

可靠的强刷办法：**把 `plugin.json` 的 `version` 往上 bump**，宿主当作新版本重新拉取。配合在设置页 `reload(id)`（或重开 App）。调试期每次有效改动都建议 bump 一下 patch 版本。

**开发期更省事的做法：插件工作台面板的「热更新」开关**。对已安装过一次的插件打开后，宿主把该插件 dev 链接到工程目录并常驻 `vetta-plugin dev`：React / CSS 走 HMR，清单与 agent 等资源定向重载，无需 bump / 重打 zip / 手动 reload。关闭开关（或重启 App）后回落安装目录。dev 会话内新增的普通权限仅在内存中放行；要在关闭热更新或重启后保留，仍需重新应用插件。

## 清理副作用

`ctx.ui.register*` 返回的 `Disposable` 由宿主在卸载时统一处置，**无需**手动 dispose。但你自己起的副作用（`setInterval`、`window.addEventListener`、订阅等）要在 `deactivate()` 里清掉。

> 注意 React StrictMode 下宿主可能 double-invoke load/dispose；别在 `deactivate()` 里把模块级共享引用永久置空（会让随后 re-activate 的实例读到空引用）。如需缓存模块级 `ctx`，让下一次 `activate()` 覆盖它，而不是在 `deactivate()` 里 null 掉。

## 权限缺失的两种后果

复习 [permissions.md](./permissions.md)：部分注册点缺权限**抛错**（中断该次调用）、部分**跳过+警告**（不影响其它能力）。把可选能力的注册各自独立，避免一处 throw 掉整段 `activate()`。

## 错误必须上报用户（notify）

预览解析、工具执行、读盘、调用外部库等**可能失败**的路径：

- **禁止**只 `catch` 成一句「失败了」写在组件里、不把原始 `error` 交给宿主。
- **必须**调用 `ctx.ui.notify({ message: 用户可读摘要, error })`（无权限）。宿主右下角 Toast 提供 **「复制堆栈」**，便于用户粘贴给 agent / 反馈。
- 组件内仍可保留简短失败 UI；notify 与内联文案互补，不是二选一。
- 在 `activate` 里把 `notify` 赋给模块变量，供组件闭包使用（组件 props 不含 `ctx`）。

完整约定与示例见 [ui-slots.md → 全局通知 notify](./ui-slots.md#全局通知-notify)。

## 文件预览必须考虑大文件

做 `registerFilePreview` 时**禁止**「小样例能开就交差」：

- **优先 `file.getUrl()`**（Range 流式），需要整包时用 `fetch(url).arrayBuffer()`；不要默认 `readBytes()`。
- `readBytes` / `readText` 经 IPC **约 10MB 硬上限**，再大直接抛错——只靠它们的预览在真实 pptx/pdf/音视频上会大面积失败。
- 读 `file.size`、做 loading/取消、超大时降级或明确提示；失败走 `notify({ message, error })`。

细则、选型表与正反例见 [ui-slots.md → 文件预览 / 大文件](./ui-slots.md#文件预览-registerfilepreview)。
