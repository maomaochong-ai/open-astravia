# 消息卡片系统（ADR-0030）

消息列表里每条 assistant 消息**下方**可以渲染一组「卡片」。本系统把卡片做成**声明式描述符 + 按 `type` 的动态渲染器注册表**：

- **谁产数据**：工具在其结果的 out-of-band `details.cards` 上声明卡片描述符（模型永不可见）。
- **谁画**：插件经 `ctx.ui.registerCardRenderer({ type, component, ... })` 注册渲染器，按描述符的 `type` 匹配。
- **谁编排**：宿主（card host）持有每条消息真实的卡片列表，按 `type` 查渲染器、按 `key` 跨轮去重，并在 ≥2 张时套上[收纳 UI](#收纳-ui)。

> 这是相对旧模型（「每条消息 mount 全部 slot、各自 `return null` 自隐」）的反转：旧模型宿主不知道某条消息到底渲染了哪几张卡片，tab 收纳与标签都算不出来；现在宿主**声明式地**知道卡片列表。

## 数据流

```
工具执行
  └─ 结果带 details.cards: CardDescriptor[]   (模型不可见的 out-of-band 通道)
        │
        ▼
宿主 card host（每条消息）
  ├─ 收集本条消息所有 tool_call block 的 details.cards（settled 卡）
  ├─ 对 pending 的 tool_call，调每个渲染器的 pendingFor() 合成 pending 卡（骨架）
  ├─ 按 descriptor.key 跨轮去重（同 key 只在最新一条消息渲染）
  ├─ 按 descriptor.type 查 registerCardRenderer 注册的渲染器
  └─ 0 张→不渲染；1 张→裸渲染；≥2 张→收纳 UI（tab/列表）
        │
        ▼
你的渲染器组件  <Component descriptor pending message />
```

## 描述符 CardDescriptor

```ts
interface CardDescriptor {
  type: string;       // 选渲染器（全局唯一、插件自拥，约定以插件 id 前缀，如 "image-gen:preview"）
  key?: string;       // 跨轮去重：同 key = 同一逻辑卡片，只在最新锚点渲染
  payload?: unknown;  // 稳定引用（如 image id / rootId），不是内容快照——渲染器据此解析实时状态
  title?: string;     // tab 标签（覆盖注册时的默认 title）
  icon?: string;      // icon symbol 字符串（跨 agent→宿主边界序列化，故不是 React 节点）
}
```

- **`payload` 存引用而非快照**：例如只存 image id，渲染器再据此异步取最新 lineage——这样卡片内容能跟随后续编辑变化。
- **`key` 驱动跨轮去重**：见 [跨轮去重](#跨轮去重)。
- **序列化约束**：描述符从工具结果跨进程而来，`title` 是字符串、`icon` 是 symbol 串；**注册时**的默认 `icon` 才可以是 React 节点（它活在插件 bundle 内）。

## 注册渲染器 registerCardRenderer

```ts
interface PluginPendingToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

interface PluginCardProps {
  descriptor: CardDescriptor;  // 这张卡的数据
  pending: boolean;            // true=从在途工具合成的骨架卡（画 skeleton）
  message: ConversationMessage;// 锚定的消息 { id, role, text, timestamp? }
}

interface PluginCardRendererContribution {
  type: string;                          // 与描述符 type 完全一致
  component: ComponentType<PluginCardProps>;
  title?: string;                        // 默认 tab 标签
  icon?: ReactNode;                      // 默认 tab 图标；省略时用插件自己的图标
  pendingFor?: (toolCall: PluginPendingToolCall) => CardDescriptor | null;
}
```

- 权限：`ui.slot.message`（缺权限**抛错**）。
- `type` **不被宿主命名空间化**（与 slot id 不同）——它是插件自拥、全局唯一的 key，描述符与注册必须用**完全相同**的字符串。约定以插件 id 前缀。
- 一个插件可注册多个渲染器（多种卡片 type）。

```tsx
ctx.ui.registerCardRenderer({
  type: "image-gen:preview",
  component: ImagePreviewCard,        // (props: PluginCardProps) => JSX | null
  title: "图像",
  icon: <IconImage className="h-3.5 w-3.5" />,
  pendingFor: pendingPreviewCard,     // 见下
});
```

`plugin.json#icon` 是 renderer 的缺省 tab 图标；注册时传入 `icon` 可为这一类卡片设置专用图标，
单个 `CardDescriptor.icon` 又可覆盖 renderer 默认值。描述符跨 agent → 宿主边界传递，因此该字段使用
Iconify 名或 `icon-[…]` 字符串，而不是 React 节点。

## 生成中骨架 pendingFor

`details.cards` 只在工具**完成后**才有。为了让「生成中」也占一张卡片/一个 tab，宿主对每个 **pending 的** tool_call 调用每个渲染器的 `pendingFor(toolCall)`：

- 返回一个**预备描述符** → 宿主用同一渲染器渲染它（`pending=true`），你画 skeleton。
- 返回 `null` → 该渲染器不处理这个工具。
- `pendingFor` 在 render 期间被调用，必须**纯/廉价**（可读插件内存缓存，别做异步）。

工具完成后，pending 卡随 block 状态翻为 success 而消失，`details.cards` 的 settled 卡同时接管——**同一 block 上 pending 与 settled 时间互斥**，不会双份。

```tsx
function pendingPreviewCard(toolCall: PluginPendingToolCall): CardDescriptor | null {
  if (toolCall.toolName !== "generate_image" && toolCall.toolName !== "edit_image") return null;
  if (toolCall.toolName === "edit_image") {
    const sourceId = typeof toolCall.args.sourceImageId === "string" ? toolCall.args.sourceImageId : undefined;
    // 同步从插件缓存解析 lineage rootId 作 key，使「上一轮那张卡」在编辑期间隐藏
    const key = sourceId ? cachedRootId(sourceId) : undefined;
    return { type: "image-gen:preview", ...(key ? { key } : {}), payload: { editingImageId: sourceId } };
  }
  return { type: "image-gen:preview", payload: {} }; // 全新生成：独立骨架，无 key
}
```

## 跨轮去重

`key` 标识「同一张逻辑卡片」。同 `key` 跨轮（跨消息）出现时，宿主**只在其最新锚点**（最后产生该 key 的消息）渲染，旧锚点自动隐藏。

典型：图片 A（第 1 轮）→ 编辑成 A′（第 2 轮）。两轮的卡片都 `key = 该 lineage 的 rootId`，于是第 1 轮卡片隐藏、第 2 轮卡片显示完整版本。无 `key` 的卡片不去重、各显各的。

> 编辑在途时要让「上一轮卡」立刻隐藏，pending 卡必须带**与 settled 卡相同的 key**（rootId）。`pendingFor` 只能拿到工具 args，需自行从插件缓存把 `sourceImageId → rootId` 同步解析出来。

## 收纳 UI

宿主按本条消息的可见卡片数自动决定形态：

- **0 张**：不渲染。
- **1 张**：裸渲染该卡片，无任何操作区。
- **≥2 张**：卡片区上方出现**操作区**——左侧 tab 切换卡片、右侧「列表 / 收纳」两个图标切布局：
  - **收纳（默认）**：tab 切换，一次只显示一张。
  - **列表**：所有卡片纵向平铺。
  - 布局是**临时态、不持久化**：列表是临时形态，卸载 / 切会话即回落收纳。

tab 顺序按卡片在消息里出现的顺序，默认激活第一个；tab 标签取 `descriptor.title` → 注册默认 `title` → 回退插件名。

## 渲染器组件写法

组件是 `descriptor` 的纯函数——**不要**自己探测「是否在生成中」，由 `pending` 决定画 skeleton 还是内容：

```tsx
import type { PluginCardProps } from "@vetta-org/plugin-sdk";

function ImagePreviewCard({ descriptor, pending }: PluginCardProps) {
  const payload = (descriptor.payload ?? {}) as { images?: ImageRef[]; editingImageId?: string };
  if (pending && payload.editingImageId) return <Swiper sourceId={payload.editingImageId} leadingSkeleton />;
  if (pending) return <GenerationSkeleton />;
  const images = payload.images ?? [];
  if (images.length === 0) return null;
  return <Swiper images={images} />;
}
```

## 第三方插件如何拿到卡片数据

卡片的 **settled 数据源是工具结果的 `details.cards`**。三条路径：

1. **插件自注册工具返回 `cards`（推荐给插件作者）**：`ctx.agent.registerTool` 的 handler 在返回值里带一个 `cards: CardDescriptor[]` 字段，宿主自动把它**提升**到 `details.cards`，并从模型可见的结果文本里**剔除**（不污染 LLM 上下文）。这样插件**用自己的工具**就能产出消息下方卡片。

   ```ts
   ctx.agent.registerTool({
     id: "show-regions",
     description: "...",
     parameters: { /* JSON schema */ },
     handler: async (input) => ({
       count: matches.length,
       results: matches.map(summarize),                 // 模型可见（结果摘要）
       cards: [{ type: "my-plugin:regions", payload: { ids } }], // 被提升到 details.cards，模型不可见
     }),
   });
   ```

   `demo-map` 即用此法：`demo_map_focus` / `demo_map_present_regions` 返回 `cards`，渲染在当前 turn 消息下方。

2. **协同设计的内置工具**：coding-agent 内置工具的 `execute` 直接在 `details.cards` 放描述符（image-gen 的 `generate_image` / `edit_image` 即如此）。内置工具与插件渲染器**成对维护**（「内置 tool 出能力 + plugin 出界面」）。

   ```ts
   // coding-agent 内置工具 execute 返回
   return {
     content: [{ type: "text", text: "已生成图像" }],
     details: { cards: [{ type: "image-gen:preview", key: rootId, payload: { images } }] },
   };
   ```

3. **`pendingFor` 合成的骨架卡**：对**任意**在途 tool_call，你的渲染器都能合成 pending 卡（它只看 `toolName` / `args`），为执行过程提供骨架反馈。

> 三条路径产出的描述符进入**同一个** `details.cards` 通道，由 host 按 `type` 查渲染器、按 `key` 去重、渲染在消息下方（≥2 张走收纳 UI）。`details.cards` 始终模型不可见。

## 与 registerToolCallSlot

- **消息卡片**（本节）：挂在**消息下方**，数据来自 `details.cards` / `cards` 提升。
- **Tool-call 槽**（[ui-slots.md](./ui-slots.md#工具行内渲染-registertoolcallslot)）：按 `toolName` **替换工具调用行内**默认 UI。
- 插件工具**可以**产卡片（返回 `cards`）；需要行内自定义 UI 时再用 `registerToolCallSlot`。两者可并用。

## 完整参考实现

- `packages/plugins/presets/demo-map`：插件自注册工具返回 `cards` + `registerCardRenderer` 渲染——**插件全自包含**的端到端范例。
- `packages/plugins/presets/image-gen`：`registerCardRenderer` + `pendingFor`，配合 coding-agent 内置 `generate_image` / `edit_image` 在 `details.cards` 产出描述符。
- `packages/plugins/presets/git`：`registerTurnCard`（本轮变更，非 tool 绑定）——见 [ui-slots Turn 卡](./ui-slots.md#本轮-turn-卡-registerturncard)。
