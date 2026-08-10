# UI 扩展点

`ctx.ui` 提供 UI 注册点（消息卡片另见 [message-cards.md](./message-cards.md)）。每个注册都返回 `Disposable`（`{ dispose() }`）；插件卸载时宿主会统一处置，无需手动调用。

> 所有 slot 组件经 Module Federation 与宿主共享 React 单例，可直接用 hook、直接传组件实例。注意[顶层 JSX 陷阱](./styling-and-pitfalls.md#module-federation-顶层-jsx-陷阱)。

会话页相关 slot（活动 Tab、输入栏 toggle、Turn 卡）支持 **`scope_use`**：**fail-closed**——未声明或空数组 = **任何对话场景都不显示**；声明后仅在列出的场景出现（如 `["project", "conversation"]`）。场景 slug 见 [conversation-and-agent.md](./conversation-and-agent.md#scope_use按对话场景限定工具出现范围)。

## 全局通知 notify

向宿主右下角全局 Toast 推送一条通知，**无需权限**。用于把失败原因暴露给用户（比只写红字 / `console.error` 更可操作）。

- 权限：无
- 传入 `error` 时：variant 默认 `error`、Toast **不自动消失**，并提供 **「复制堆栈」** 一键复制（含 `pluginId@version`、Error.stack / 序列化详情）；同时 `console.error` 一份便于 DevTools
- React 组件拿不到 `ctx`：在 `activate` 里把 `ctx.ui.notify` 存到模块变量再调用

```ts
interface PluginNotifyOptions {
  message: string;                 // 用户可见摘要（必填）
  title?: string;                  // 默认插件展示名
  variant?: "info" | "success" | "warning" | "error";
  error?: unknown;                 // 有则附加「复制堆栈」
  durationMs?: number;             // 0 = 手动关闭；有 error 时默认 0
}
```

```tsx
// 模块级捕获，供预览 / 面板组件使用
let notify: import("@vetta-org/plugin-sdk").PluginUiApi["notify"];

function PptxPreview({ file }: PluginFilePreviewProps) {
  useEffect(() => {
    let cancelled = false;
    // 二进制预览优先 getUrl（见下文「大文件」），勿默认 readBytes
    const load = async () => {
      const url = file.getUrl();
      const bytes = url
        ? await (await fetch(url)).arrayBuffer()
        : await file.readBytes();
      return parse(bytes);
    };
    load()
      .then((_result) => {
        if (cancelled) return;
        // setSlides(_result) …
      })
      .catch((err) => {
        if (cancelled) return;
        notify({
          message: "无法解析此 PPTX 文件",
          error: err, // 用户可点「复制堆栈」
        });
      });
    return () => {
      cancelled = true;
    };
  }, [file]);
  // ...
}

export default definePlugin({
  activate(ctx) {
    notify = ctx.ui.notify;
    ctx.ui.registerFilePreview({ extensions: ["pptx"], component: PptxPreview });
  },
});
```

**何时必须 notify（推荐规范）**

| 场景 | 做法 |
| --- | --- |
| 读文件 / 解析 / 网络 / 外部库失败 | `notify({ message: 用户可读摘要, error })`，UI 仍可显示简短失败态 |
| 权限 / 配置缺失 | `warning` + 可引导 `openPluginSettings()`（若适用） |
| 纯成功反馈 | 可选 `variant: "success"`，短 `durationMs` |
| 可预期的空态（无数据） | **不要**当错误 notify，用组件内 empty UI |

禁止：只 `catch (() => setError("失败"))` 且不传 `error`——用户与 agent 都无法拿到堆栈。

## 全局浮层 registerGlobalSlot

在 App 根部渲染一个组件（全局浮层 / 对话框 / 常驻 UI）。

- 权限：`ui.slot.global`（缺权限 **warn+noop**）
- 组件：**零 props，自包含**。

```tsx
ctx.ui.registerGlobalSlot({ id: "panel", component: MyPanel });
```

```ts
interface PluginGlobalSlotContribution {
  id: string;                  // 插件内唯一；宿主命名空间化为 `${pluginId}:${id}`
  component: ComponentType;    // 零 props
}
```

典型用途：设置缺失引导弹窗、全局悬浮工具。一个插件可注册多个。

## 工作区视图 registerWorkspaceView

贡献一个**整页 surface**，与内置的「自动化」「知识库」同级：宿主给它一条自己的路由
`/workspace/<pluginId>/<viewId>` 和一个侧边栏导航入口，打开后整个内容区都归插件。

- 权限：`ui.slot.workspace-view`（缺权限 **warn+noop**）
- 导航入口默认落在侧边栏的「更多」收纳里；用户可以拖动排序，也可以 **pin 到左上方置顶区**（含「新会话」最多 5 个），布局按 key 持久化
- 组件收到 `{ pluginId, viewId }`，一个组件可以服务多个注册
- `icon` 是 **iconify class 字符串**（如 `"icon-[solar--widget-4-linear]"`），不是 ReactNode——宿主要把它渲染进自己的导航按钮，并按 key 持久化布局

```ts
interface PluginWorkspaceViewContribution {
  id: string;                       // 插件内唯一；进 URL，故限 [a-z0-9][a-z0-9._-]*
  label: string;                    // 侧边栏文案，支持 %catalogKey%
  icon?: string;                    // iconify class 字符串
  description?: string;             // 导航项 tooltip
  component: ComponentType<PluginWorkspaceViewProps>;
  navOrder?: number;                // 同一插件内多个视图的排序
}
```

```tsx
ctx.ui.registerWorkspaceView({
  id: "board",
  label: "%view.board.label%",
  icon: "icon-[solar--widget-4-linear]",
  component: BoardView,
});

// 程序化跳转到自己的视图
ctx.ui.openWorkspaceView("board");
```

**该用哪个插槽**

| 场景 | 用 |
| --- | --- |
| 跨会话、跨项目的工作台（看板、控制台、仪表盘） | **工作区视图** |
| 绑定当前对话的辅助面板 | [活动 Tab](#活动面板-tab-registeractivitytab) |
| 全局浮层 / 对话框 | [全局浮层](#全局浮层-registerglobalslot) |

**与面板类插槽的关键差别**：工作区视图**独占内容区**，所以它可以（也应该）自带
页面级 header 和滚动容器，不受「面板内禁止 viewport 级浮层」的约束。但它仍在宿主
窗口内——不要覆盖宿主 chrome（侧边栏、标题栏），顶部留一条 `drag-region` 高度以免
盖住窗口拖拽区。

插件被禁用时，它的导航入口消失；用户如果正停在该路由上，宿主会把他送回首页。
持久化的侧边栏布局按 key 保留，插件装回来后位置复原。

示例：`packages/plugins/presets/kanban`。

## 文件预览 registerFilePreview

按**文件扩展名**贡献预览组件，渲染在活动面板的文件预览区。

- 权限：`ui.slot.file-preview`（缺权限 **warn+noop**）
- **优先级=仅补空白**：内置已支持的扩展名（image / audio / pdf / docx / markdown / json / 常见文本）插件**抢不到**；只有内置不认、本会掉进文本兜底的扩展名才查插件注册表，**首个匹配胜**。
- 组件收到 `file` prop —— 宿主**不**预读、不替你猜编码。
- **布局边界（面板内）**：预览组件必须把 UI 限制在预览壳内。禁止 `fixed` / 视口级定位、禁止超高 `z-index` 抢宿主 chrome、禁止 `createPortal` 到 `document.body`。面板内浮层用根节点 `relative` + 子节点 `absolute`。全局浮层走 [`registerGlobalSlot`](#全局浮层-registerglobalslot)；错误/提示走 [`notify`](#全局通知-notify)。宿主会对 file-preview 壳做 fixed containing block + overflow 裁剪作为兜底——**仍须按规范写**。细则与正反例见 [styling-and-pitfalls.md → 面板类 slot 布局边界](./styling-and-pitfalls.md#面板类-slot-布局边界禁止-viewport-级浮层)。

```ts
interface PluginPreviewFile {
  path: string | null;
  name: string;
  extension: string;       // 小写、不含点
  mime: string;
  size: number;            // 字节；未知时可能为 0——不要假定很小
  readText(): Promise<string>;
  readBytes(): Promise<ArrayBuffer>;
  getUrl(options?: { mediaKind?: "audio" | "video" }): string; // Range 流式 URL
  /** 磁盘变更时回调（防抖）；无真实 path 时为 no-op。返回 Disposable。 */
  watch(listener: () => void): Disposable;
  /** 本地音频元数据（标题/封面等）；不支持时返回 null。 */
  getAudioMetadata?(): Promise<PluginAudioMetadata | null>;
}
```

```tsx
ctx.ui.registerFilePreview({ extensions: ["svg"], component: SvgPreview });
```

完整示例见 `packages/plugins/presets/svg-viewer`、`media-viewer`、`office-viewer`。

### 内容访问：三种 API 怎么选

| API | 适用 | 宿主行为 / 限制 |
| --- | --- | --- |
| **`getUrl()`** | **二进制 / 可能偏大 / 媒体 / 可流式解析**（PDF、Office zip、音视频、大图） | 返回 `vetta-media://…`（或远程 url）。**支持 Range**；`fetch(url)` 或交给原生 `<audio>`/`pdf.js` 等。**无整文件 10MB 封顶**（相对 IPC 全量读）。 |
| **`readBytes()`** | 仅当库**必须**拿到完整 `ArrayBuffer` 且你已接受体积风险 | 经 IPC 全量读盘。**硬上限约 10MB**——更大直接抛错（如 `File too large to preview (>10 MB)`）。base64 往返，内存与序列化成本高。 |
| **`readText()`** | 明确的小文本（svg 源、json、轻量 xml） | 同样走 IPC；**大文本同样不适合**。 |

**Agent / 作者硬规则（文件预览插件不要敷衍）**

1. **默认按「用户可能打开几十 MB～上百 MB」设计**，不要只拿 100KB 样例验收。
2. **能流式就流式**：优先 `const url = file.getUrl()`，再 `fetch(url)` / 交给支持 URL 的引擎。官方 `office-viewer` 模式：

   ```ts
   async function fetchFileBytes(file: PluginPreviewFile): Promise<ArrayBuffer> {
     const url = file.getUrl();
     if (!url) return file.readBytes(); // 仅 url-only 兜底
     const res = await fetch(url);
     if (!res.ok) throw new Error(`HTTP ${res.status}`);
     return res.arrayBuffer();
   }
   ```

3. **禁止**无脑 `readBytes()` 当唯一路径，然后 catch 成一句「无法解析」——大文件会先撞 10MB 墙，用户只看到含糊失败。
4. 若格式**必须**整包进内存（如整 zip 解压）：
   - 仍优先 `getUrl` + `arrayBuffer()`（绕开 IPC 10MB）；
   - 读 `file.size`：过大时**提前**友好提示（可给阈值，如「超过 N MB 仅支持元数据/前几页」），不要等 OOM；
   - 无法支持的巨大文件：组件内说明 + `notify({ message, error 或 说明 })`，**不要静默挂死**。
5. **加载态 / 取消**：`useEffect` 里 `cancelled` 标志；卸载后不 `setState`；长时间解析显示 loading，必要时分片/只解析需要的部分（如 pptx 只读 `ppt/slides/*`，不必把整包图片解码进 UI）。
6. **媒体类**（音/视频）直接用 `getUrl({ mediaKind })` 作 `src`，**禁止** base64 塞进内存。
7. 失败一律带原始错误：`notify({ message: "…", error })`（见 [notify](#全局通知-notify)）。

### 反例与正例

```tsx
// ❌ 敷衍：一律 readBytes，无 size 意识，吞错误
file.readBytes().then(parse).catch(() => setError("失败"));

// ✅ 优先流式 URL；大文件友好；错误可复制堆栈
const url = file.getUrl();
const bytes = url
  ? await (await fetch(url)).arrayBuffer()
  : await file.readBytes();
```

若引擎支持 URL/Range（PDF.js 等），**连整包 arrayBuffer 都可省**：

```tsx
// ✅ 最佳：引擎自己拉流
pdfjs.getDocument({ url: file.getUrl() });
```

## 活动面板 Tab registerActivityTab

向活动面板注册一个 tab。

- 权限：`ui.slot.activity-tab`（注册 **warn+noop**；`openActivityTab` / `setActivityTabVisible` **抛错**）
- **`scope_use` fail-closed**（必写，否则任何场景不显示）
- **默认注册即上栏**（`initiallyVisible` 缺省 `true`）。声明 `initiallyVisible: false` 表示「出现条件我自己管」：注册只入池，之后用 `setActivityTabVisible` 静默上栏/下栏（如 git 只在仓库目录上栏、工作台跟随输入栏 toggle），或用 `openActivityTab` 上栏并抢焦点打开（如图像生成完成后跳到历史）
- 显隐记录按 **会话 cwd** 持久化（ADR-0026）：插件表过态就听插件的，没表过态才看 `initiallyVisible`。用户随时可用减号手动隐藏
- 插件禁用时 tab 隐藏，重新启用可回来
- **布局边界（面板内）**：与 file-preview 相同——UI 留在 Tab 面板矩形内，禁止 viewport 级 `fixed` / 超高 z-index / portal 到 `document.body`。全局浮层用 `registerGlobalSlot`，Toast 用 `notify`。见 [styling-and-pitfalls.md → 面板类 slot 布局边界](./styling-and-pitfalls.md#面板类-slot-布局边界禁止-viewport-级浮层)。

```ts
interface PluginActivityTabContribution {
  id: string;
  label: string;              // 可用 %catalogKey%（见 i18n）
  icon?: ReactNode;
  component: ComponentType;   // 零 props
  scope_use?: readonly ConversationScenario[]; // fail-closed
  initiallyVisible?: boolean;  // 缺省 true：注册即上栏；false = 出现条件由插件自己驱动
}
```

```tsx
ctx.ui.registerActivityTab({
  id: "stats",
  label: "%tab.label%",
  icon: <StatsIcon />,
  component: StatsPanel,
  scope_use: ["project", "conversation"],
});
```

组件零 props。**面板作用域用 `useActivityTab()` 取 cwd**，不要用 `useActiveConversation().cwd` 代替（项目详情页面板 cwd 是项目的，活动会话可能属于别的项目）：

```tsx
import { useActivityTab } from "@vetta-org/plugin-sdk";

function StatsPanel() {
  const { cwd } = useActivityTab();
  // ...
}
```

### openActivityTab

```ts
ctx.ui.openActivityTab(tabId, options?: { width?: number | "max" });
```

编程方式 attach（如需）并激活本插件某个 tab；`width: "max"` 尽量拉满（宿主仍 clamp）。载荷经插件自己的内存状态传递。

`width` **只在该 tab 首次 attach 时生效**：tab 已 attach 的重复调用（含 reload/热更新导致的 `activate()` 重放）只做激活，不会覆盖用户手动拖出的面板宽度。

示例：`packages/plugins/presets/git`、`externals/mobile-ui-preview`。

### setActivityTabVisible

```ts
ctx.ui.setActivityTabVisible(tabId, visible: boolean);
```

只把 tab 放进/移出当前会话的标签栏，**不激活、不展开面板**——「它现在该不该在栏里」，而不是「用户此刻要看它」。这是插件表达自己出现条件的地方：

```ts
// git：只在 git 工作区里上栏。conversation.on 订阅后会立刻回放一次
// conversation-changed，所以不用等下次切会话。
ctx.conversation.on((event) => {
  if (event.type !== "conversation-changed") return;
  const { cwd } = event.conversation;
  if (!cwd) return;
  void isInsideGitWorkTree(ctx.command, cwd).then((inRepo) =>
    ctx.ui.setActivityTabVisible("changes", inRepo),
  );
});

// 插件工作台：跟随输入栏 toggle（硬隔离只负责关掉时藏起来，不会帮你上栏）。
ctx.ui.registerInputAction({
  id: "mode",
  hardIsolation: true,
  onToggle: (active) => ctx.ui.setActivityTabVisible("workbench", active),
  // ...
});
```

上栏记录按 cwd 持久化，所以**只需在条件变化时调用**；用户之后用减号手动隐藏的结果不会被重复调用覆盖。当前没有活动会话时是 no-op（无处记录），插件应在会话就绪后重新判定。异步判定要注意丢弃过期结果：写入落在**调用时**的活动会话上，探测期间切走了就别再写。

## 输入栏动作 registerInputAction

在 AI 输入栏下方加一个**开关型动作按钮**（toggle）。激活时，宿主在每次发送前调用 `decoratePrompt()`，把元数据和插件隐藏指令合并进外发 prompt。

- 权限：`ui.slot.input-action`（缺权限**抛错**）
- **`scope_use` fail-closed**；与 `requiresActiveTool` **取「与」**才显示

```ts
interface PluginInputActionContribution {
  id: string;
  label: string;
  icon?: ReactNode;
  defaultActive?: boolean;
  requiresActiveTool?: string;   // 仅当该 agent 工具在本会话激活时显示
  scope_use?: readonly ConversationScenario[];
  /** 见下文「插件贡献硬隔离」 */
  hardIsolation?: boolean;
  onToggle?(active: boolean): boolean | void;  // 返回 false 可否决激活
  decoratePrompt?(): {
    metadata?: Record<string, unknown>;
    instructions?: string[];
  } | void;
}
```

```tsx
ctx.ui.registerInputAction({
  id: "image-mode",
  label: "%action.imageMode.label%",
  icon: <IconImage />,
  scope_use: ["conversation", "project"],
  requiresActiveTool: "generate_image",
  onToggle: (active) => {
    if (active && notConfigured()) {
      showSettingsGuard();
      return false;
    }
  },
  decoratePrompt: () => ({
    instructions: ["Produce an actual image this turn by calling the appropriate plugin tool."],
  }),
});
```

### 软隔离 vs 硬隔离（内置对照）

- **图像生成（软）**：工具不因 toggle 关闭而剥离；插件通过 `instructions` 加强本轮图像意图。
- **知识检索（硬，宿主内置）**：未开 toggle 时本轮剥离 `kb-read` 工具。

### 插件贡献硬隔离 hardIsolation

`hardIsolation: true` 时（ADR-0041）：

- Toggle **默认关**时，该插件的 **tools / skills / MCP / systemPrompt 贡献**不进入 agent；**Activity Tab 也隐藏**。
- Toggle 打开后恢复贡献（宿主 `setContributionMode` + `reconfigureAgentPlugins`）。
- 可与清单 `contributionMode.hardIsolation` 联用（冷启动即 gate，见 [manifest](./manifest.md#contributionmode)）。
- **用户自建插件默认不要开**；模式型系统插件（如插件工作台）使用。

`requiresActiveTool`：badge 跟随工具 `scope_use`，避免工具被场景屏蔽时仍显示无效开关。

配套：`setPromptAttachment`（通用一次性 prompt 上下文胶囊）、`previewImage`（全屏图片预览）——见 [conversation-and-agent 私有存储 API](./conversation-and-agent.md#插件私有存储-api)。

## 工具行内渲染 registerToolCallSlot

按 **toolName** 替换宿主默认的工具调用行内 UI（transcript 内嵌渲染）。**首个注册胜**。

- 权限：`ui.slot.tool-call`（缺权限**抛错**）
- 与消息卡片互补：卡片挂在消息下方；本槽替换**工具调用那一行**的渲染
- 插件工具也可返回 `cards` 走消息卡片（见 [message-cards](./message-cards.md)）；需要行内富 UI 时用本 API

```ts
ctx.ui.registerToolCallSlot({
  id: "my-tool-ui",
  toolName: "my_tool",
  component: MyToolCallView, // props: { toolCall: { toolCallId, toolName, args, status, result?, isError? } }
});
```

## 本轮 Turn 卡 registerTurnCard

在消息列表底部（**最新一轮**）挂一张**不绑定 tool 调用**的卡片。宿主挂载组件；插件自行决定可见性（不适用时 `return null`）。

- 权限：`ui.slot.turn-card`（缺权限**抛错**）
- **`scope_use` fail-closed**
- 典型：git「本轮变更」卡（只在仓库有变更时显示）

```ts
ctx.ui.registerTurnCard({
  id: "changes",
  component: GitTurnCard,
  scope_use: ["project"],
});
```

示例：`packages/plugins/presets/git`。

## 键盘快捷键 registerShortcutScope

把绑定挂到宿主统一的 **ShortcutScopeStack**（与宿主 UI 同一条链路：`modal` > `overlay` > `surface` > `app`）。**不要**在插件里 `document.addEventListener("keydown")`。

- 权限：`ui.shortcuts.register`（缺权限**抛错**）
- 可用 kind：`surface` | `overlay` | `modal`（**不能**用 `app`——留给宿主可配置的全局动作）
- 键格式与宿主 `eventToShortcut` 一致，如 `"mod+s"`、`"escape"`、`"arrowleft"`、`"="`、`"-"`
- `when`：`always`（默认）| `editable` | `not-editable`
- 组件内优先用 `usePluginShortcutScope`（在 `activate` 里把 `ctx.ui.registerShortcutScope` 存到模块变量，再传给 hook）

```ts
// activate
let registerShortcutScope = ctx.ui.registerShortcutScope.bind(ctx.ui);
// 或：setRegisterShortcutScope((c) => ctx.ui.registerShortcutScope(c));

// React 组件
import { usePluginShortcutScope, type PluginShortcutBinding } from "@vetta-org/plugin-sdk";

const bindings: PluginShortcutBinding[] = [
  { key: "=", when: "not-editable", run: () => zoomIn() },
  { key: "-", when: "not-editable", run: () => zoomOut() },
  { key: "0", when: "not-editable", run: () => resetZoom() },
];

usePluginShortcutScope(registerShortcutScope, {
  id: "zoom",
  kind: "surface",
  bindings,
});

// 全屏时用更高 kind，避免被宿主 surface（如文件预览 Esc）抢走
usePluginShortcutScope(registerShortcutScope, {
  id: "fullscreen-esc",
  kind: "overlay",
  active: isFullscreen,
  bindings: [{ key: "escape", run: () => exitFullscreen() }],
});
```

命令式（`activate` 或副作用里）：

```ts
const handle = ctx.ui.registerShortcutScope({
  id: "panel-keys",
  kind: "surface",
  exclusive: false,
  enabled: () => panelOpen,
  bindings: () => [
    { key: "escape", run: () => closePanel() },
  ],
});
// 卸载时宿主会统一 dispose；也可手动 handle.dispose()
```

示例：`packages/plugins/presets/media-viewer`（缩放 / 全屏 Esc）。
