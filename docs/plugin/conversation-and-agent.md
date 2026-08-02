# 对话 / Agent / 命令 / 文件 / 网络 / 存储 / 设置 / i18n API

`ctx` 上除 UI 注册外的能力出口，以及配套 React hook。

```ts
interface PluginContext {
  plugin: { id: string; version: string };
  permissions: { has(p): boolean; require(p): void };
  ui: PluginUiApi;            // 见 ui-slots.md / message-cards.md
  conversation: PluginConversationApi;
  agent: PluginAgentApi;
  command: PluginCommandApi;  // 见「命令执行」
  fs: PluginFsApi;
  network: PluginNetworkApi;
  storage: PluginStorageApi;
  settings: PluginSettingsApi;
  i18n: PluginI18nApi;        // 见「插件 i18n」
  getAgentMode(): AgentMode;  // 当前工作模式，见「工作模式」
  onAgentModeChanged(listener: (mode: AgentMode) => void): Disposable;
}
```

> **MCP 不在 `ctx` 上**：插件内聚 MCP 是 **清单声明式**（`agent.mcpServers`），由宿主聚合进会话，见 [mcp.md](./mcp.md)。

所有对话 API 都作用于**当前活动会话**（桌面同时只展示一个）；插件不能枚举或持有任意会话句柄。

## 对话：读状态

hook 直接从 `@vetta-org/plugin-sdk` import、在组件里调用，读当前活动对话并自动 rerender。需要 `agent.session.read`。

```tsx
import { useActiveConversation, useConversationMessages } from "@vetta-org/plugin-sdk";

function Sidebar() {
  const convo = useActiveConversation();
  // ConversationState: { id, cwd, sessionPath, model, isStreaming }（无会话时各为 null / false）
  const messages = useConversationMessages();
  // ConversationMessage[]: { id, role: "user"|"assistant"|"compaction", text, timestamp? }
  return <div>{convo.isStreaming ? "生成中…" : `${messages.length} 条消息`}</div>;
}
```

## 对话：事件

`ctx.conversation.on(listener)` 推实时事件，返回 `Disposable`。需要 `agent.session.read`。

```ts
const sub = ctx.conversation.on((event) => {
  switch (event.type) {
    case "turn-start": break;
    case "turn-end": event.stopReason; break;            // "stop" | "aborted" 等
    case "message-added": event.message; break;           // ConversationMessage
    case "message-updated": event.delta; break;           // 流式文本增量
    case "tool-call-start": event.toolCallId; event.toolName; break;
    case "tool-call-end": event.toolCallId; event.toolName; event.isError; break;
    case "conversation-changed": event.conversation; break; // 活动会话切换（ConversationState）
  }
});
// 之后：sub.dispose();
```

## 对话：驾驶

需要 `agent.session.write`。

```ts
await ctx.conversation.sendPrompt("总结一下这个 diff"); // 发起一轮用户对话（渲染成用户气泡）
ctx.conversation.insertText("草稿文本");                 // 仅填输入框，不发送，供用户编辑
await ctx.conversation.abort();                          // 中断当前轮
```

## 注册 Agent 工具

`ctx.agent.registerTool` 让插件用 JS 注册一个 **agent 可见的工具**：coding-agent 只看到工具 shell（schema + 描述），实际执行经 IPC 回到你的 renderer handler。需要 `agent.tools.register`（注册）+ `agent.toolHandler.execute`（执行）。返回 `Disposable`。

```ts
interface PluginAgentToolRegistration<TInput = unknown> {
  id: string;                 // 插件内唯一
  name?: string;              // LLM 可见工具名（默认取 id）
  label?: string;             // 宿主 UI 展示名（Work 工具头等）。可用 %catalogKey%；不发给模型
  description: string;        // 进系统提示词的 Available tools，写清楚何时用
  parameters: object;         // JSON Schema（可用 TypeBox 产出）
  scope_use?: string[];       // 允许出现的对话场景（见下）。fail-closed：缺省/空 = 任何场景都不出现
  requires?: string[];        // 需要的会话能力（如 "knowledge"），一般插件无需设置
  agent_mode?: string[];      // 允许出现的工作模式（"work"/"coding"），缺省/空 = 通用。见「工作模式」
  timeoutMs?: number;
  context?: { conversation?: "summary" | "messages" }; // 大上下文 opt-in，缺省只传消息数
  handler: (context: PluginAgentHandlerContext<{
    kind: "tool-call";
    timestamp: number;
    toolCallId: string;
    toolId: string;
    toolName: string;
    input: TInput;
  }>) => unknown | Promise<unknown>;
}
```

```ts
ctx.agent.registerTool({
  id: "word-count",
  description: "统计一段文本的字数。当用户想知道字数时调用。",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  scope_use: ["conversation", "project"],
  handler: async ({ trigger: { input } }: { trigger: { input: { text: string } } }) => {
    return { count: input.text.length };
  },
});
```

- handler 的**返回值**会被宿主格式化成工具结果文本回给模型；该工具结果的 `details` 为 `{ pluginId, toolId, result }`（`result` = 你的返回值）。
- **返回 `cards` 即可产消息卡片**：若返回值含 `cards: CardDescriptor[]`，宿主会把它**提升**到 `details.cards`（消息卡片的 settled 数据源）并从模型可见文本里**剔除**。配合 `ctx.ui.registerCardRenderer` 即可让插件**用自己的工具**在消息下方渲染卡片——见 [message-cards.md](./message-cards.md#第三方插件如何拿到卡片数据)。
- 插件激活会等待工具 schema 注册完成；注册 / 注销 / 权限或启停变化会刷新空闲的对话 session。

### `scope_use`：按对话场景限定工具出现范围

工具是否暴露给 agent 由 `scope_use` 决定——它和内置工具完全同一套机制。**fail-closed**：不声明 `scope_use`（或给空数组）= 该工具在**任何场景都不出现**。所以注册 agent 工具时**务必显式声明** `scope_use`。

会话场景 slug（7 个）：

| slug | 场景 |
|---|---|
| `conversation` | 普通对话（`~/.vetta/conversation`） |
| `project` | 普通项目中对话 |
| `im-claw` | Claw IM 对话（飞书/微信网关） |
| `batch` | 批量任务 |
| `automation` | 自动化/定时任务 |
| `kb-processing` | 知识库加工 |
| `cli` | 裸 CLI / SDK（fallback） |

要点：

- 只声明工具**真正适用**的场景。例如业务查询工具一般给 `["conversation", "project"]`；批量/加工是非交互后台场景，通常不该出现。
- `scope_use` 只能“减”——它从“宿主已注入的工具”里过滤，不能让工具凭空出现在未注入插件的场景。
- 输入栏的开关 badge 也会跟随对应工具的 scope：工具在当前场景不出现时，对应 badge 自动隐藏（见 [ui-slots.md](./ui-slots.md#输入栏动作-registerinputaction) 的 `requiresActiveTool`）。
- `requires` 是另一条正交轴（会话能力，如 `"knowledge"`）；与 `scope_use` 取交集才激活。一般插件无需设置。
- `agent_mode` 是第三条正交轴（工作模式，`"work"`/`"coding"`）；缺省/空 = 通用（所有模式可见）。若插件级 [manifest `agent_mode`](./manifest.md#agent_mode工作模式白名单) 也声明了，两者取交集。见 [工作模式](#工作模式agent_mode)。

## 注册动态系统提示词 Provider

`ctx.agent.registerSystemPromptProvider()` 注册一个 TypeScript handler，在每次 **Agent run 开始、`before_agent_start` 扩展执行前**求值。它适合按插件设置、模型、会话场景、当前消息或工具状态动态生成和修改提示词。需要 `agent.systemPrompt.write`；修改非本插件 block 还需要 `agent.systemPrompt.fullControl`。

```ts
ctx.agent.registerSystemPromptProvider({
  id: "domain-guidance",
  timeoutMs: 3000,
  context: { systemPrompt: "full", conversation: "messages" }, // 大上下文 opt-in
  handler(context) {
    const { plugin, session, model, conversation, runtime, trigger, systemPrompt, actions, host } = context;
    return [{
      type: "addBlock",
      block: {
        id: `plugin.${plugin.id}.domain-guidance`,
        content: [
          String(plugin.settings.instructions ?? ""),
          `scenario=${session.scenario}`,
          `model=${model.provider}/${model.id}`,
          `messages=${conversation.messageCount}`,
          `tools=${runtime.activeToolNames.join(",")}`,
          `run=${runtime.runIndex}@${trigger.timestamp}`,
        ].join("\n"),
        priority: 850,
      },
    }];
  },
});
```

handler 上下文按稳定职责分组：

- `plugin`：插件 id、provider id、主进程读取的最新插件设置快照。
- `session`：session id、cwd、对话场景。
- `model`：provider、model id、API、输入能力、context window、最大输出 token。
- `conversation`：本次调用实际使用的消息快照和消息数（通过 `registration.context.conversation` 控制传 summary 还是 messages）。
- `runtime`：当前激活/可用工具名、当前 session 的 Agent run 序号。
- `trigger`：触发类型和时间戳。
- `systemPrompt`：**可选**。当前 system prompt 快照（base/current 的 blocks 和 rendered 文本）。通过 `registration.context.systemPrompt` 控制传入粒度：`"none"`（缺省，无此字段）、`"blocks"`、`"rendered"`、`"full"`。
- `actions`：**副作用操作集**，调用后累积到 handler 返回值一并提交，见下表。
- `host`：宿主简化版 API（`{ fs, conversation }`）。

`registration.context` 控制宿主以什么粒度序列化上下文发过来：

```ts
{
  systemPrompt?: "none" | "blocks" | "rendered" | "full"; // 缺省 "none"
  conversation?: "summary" | "messages";                    // 缺省 "summary"
}
```

### 副作用操作集（`actions`）

所有 handler 均可调用，操作暂存到 effects 数组，handler 返回后宿主统一处理：

| 方法 | 效果 |
|------|------|
| `actions.systemPrompt.addBlock(block)` | 新增 system prompt 块 |
| `actions.systemPrompt.replaceBlock(id, block)` | 替换块内容 |
| `actions.systemPrompt.updateBlock(id, patch)` | 更新块的部分字段 |
| `actions.systemPrompt.removeBlock(id)` | 删除块 |
| `actions.systemPrompt.setBlockEnabled(id, enabled)` | 开关块 |
| `actions.tools.setEnabled(name, enabled)` | 开关工具 |
| `actions.tools.enable(name)` | 启用工具 |
| `actions.tools.disable(name)` | 禁用工具 |
| `actions.continuation.request(result)` | 请求续跑（下一轮注入用户消息） |

返回 operation 按数组顺序执行，支持 `addBlock`、`replaceBlock`、`updateBlock`、`removeBlock`、`setBlockEnabled`、`setToolEnabled`、`requestContinuation`。`write` 权限只能操作 `plugin.<本插件 id>.*`；宿主会校验所有返回值并补齐可信的 block source。handler 异常或超时只跳过该 provider，不阻止模型调用。

## 注册 Agent 自动续跑策略

`ctx.agent.registerContinuationProvider()` 注册一个在 Agent 到达自然停止点时执行的策略。它与
`conversation.sendPrompt()` 不同：不会立即发起新对话，而是在当前 Agent Loop 没有更多工具、
steering 或 Todo continuation 后，决定是否注入一条用户消息继续下一轮。需要
`agent.continuation.register`。

```ts
ctx.agent.registerContinuationProvider({
  id: "workflow-next-step",
  timeoutMs: 3000,
  context?: { conversation?: "summary" | "messages" }; // 大上下文 opt-in
  async handler({ session, plugin, actions }) {
    const task = findPendingTask(session.id);
    if (!task) return null; // 允许 Agent 正常结束
    return {
      text: `继续处理工作流任务：${task.description}`,
      idempotencyKey: task.id,
    };
  },
});
```

- Todo continuation 优先；只有 Todo 不要求继续时才检查插件策略。
- 多个策略按插件 id 和 provider id 稳定排序，每个停止点最多采用一个结果。
- `idempotencyKey` 在会话内去重，避免同一任务被重复注入。
- handler 默认 3 秒超时；异常、超时、空文本都按“无需继续”处理，不阻止 Agent 正常结束。
- 单次 Agent run 最多接受 8 次插件 continuation，防止插件造成无限循环。
- 返回的 `Disposable`、插件停用、重载或卸载都会注销该策略。

## 命令执行 command

`ctx.command.run` 在**宿主主进程**用 `execFile` 跑命令（**不走 shell**，参数数组传递，无注入）。需：

1. 权限 `agent.command.run`
2. `plugin.json` 的 `commands` 声明该二进制名
3. 用户未在设置里关闭该命令

```ts
interface PluginCommandApi {
  run(
    file: string,
    args?: string[],
    options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
}
```

```ts
const { stdout, exitCode } = await ctx.command.run("git", ["status", "--porcelain"], {
  cwd: projectRoot,
  timeoutMs: 30_000, // 宿主会 clamp（当前上限约 120s）
});
```

- 未声明 / 用户关闭 / 无权限：拒绝（关闭时宿主会通知用户）。
- 非零 exit：**resolve** 并带 `exitCode`，不 throw（spawn 失败才 reject）。
- 粒度 = **可执行文件名**（`git` 的所有子命令共用一条声明）。见 ADR-0032、[manifest commands](./manifest.md#commands)。

示例：`packages/plugins/presets/git`。

## 长驻进程 command.spawn

`ctx.command.spawn` 启动**长驻**进程（如本地 dev server，ADR-0054）。治理与 `run` 同模式：清单 `commands` 声明二进制 + 用户可关；但权限是独立的 `agent.command.spawn`。

```ts
interface PluginCommandApi {
	spawn(
		file: string,
		args?: string[],
		options?: {
			cwd?: string;
			env?: Record<string, string>;
			/** 宿主分配空闲端口，并替换 args/env 值中的字面量 `{{PORT}}`。 */
			allocatePort?: boolean;
		},
	): Promise<PluginCommandSpawnHandle>;
}

interface PluginCommandSpawnHandle {
	spawnId: string;
	pid: number;
	port?: number; // allocatePort 时有值
	stop(): Promise<void>; // SIGTERM 进程树，宽限后 SIGKILL；幂等
	status(): Promise<{ running: boolean; pid: number; port?: number; exit?: { exitCode: number | null; signal: string | null }; recentOutput: string }>;
	onExit(listener: (exit: { exitCode: number | null; signal: string | null }) => void): Disposable;
}
```

- 子进程运行在**独立进程组**：`stop()` 杀整棵树（vite 的 esbuild 子进程等不会残留）。
- 宿主兜底回收：插件禁用/卸载/重载、App 退出时统一清扫；每插件并发 spawn 上限 8。
- `recentOutput` 是 stdout+stderr 合并环形缓冲（约 64KB 尾部），用于诊断/进度。
- 端口竞争极小概率存在：配合 `--strictPort` 类参数，启动失败（onExit）后重试一次即可。

示例：`packages/plugins/presets/vetta-ui-design`（设计引擎 vite dev server 与 `npm install`）。

## 文件 API

`ctx.fs` 受权限门控读写文件（`fs.read` / `fs.write`，缺权限**抛错**）。

```ts
interface PluginFsApi {
  readDir(dirPath): Promise<PluginFsEntry[]>;                 // fs.read
  readFile(filePath): Promise<{ content: string; encoding: "utf8" | "base64" }>; // fs.read
  readBinaryFile(filePath): Promise<{ data: string; mimeType: string; size: number }>; // fs.read
  writeFile(filePath, content: string, encoding?: "utf8" | "base64"): Promise<void>; // fs.write；base64 写二进制
  stat(filePath): Promise<{ size; modifiedAt; createdAt } | null>; // fs.read
  rename(oldPath, newPath): Promise<void>;                   // fs.write
  delete(targetPath): Promise<void>;                         // fs.write
  move(sourcePath, destDir): Promise<void>;                  // fs.write
  createDirectory(dirPath): Promise<void>;                   // fs.write
  listFilesRecursive(rootPath): Promise<{ name; path; relPath }[]>; // fs.read
}
// PluginFsEntry: { name, path, isDirectory, size, modifiedAt }
```

同一份 `fs` API 也通过工具 handler 的 `host.fs` 暴露给 agent 工具 handler。

## 网络 API

`ctx.network.request` 通过宿主主进程发起 HTTP(S) 请求，避免 renderer CORS 差异。需要 `network.fetch`；请求与响应各最多 32 MiB，超时最多 300 秒。调用绑定当前插件的 capability session，插件 id 不由 renderer 传入。

```ts
const response = await ctx.network.request<{ data: unknown[] }>({
  url: "https://api.example.com/v1/items",
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}` },
  body: { type: "json", value: { query: "example" } },
  responseType: "json", // "json" | "text" | "base64"
  timeoutMs: 30_000,
});
```

`body.type` 也可取 `"multipart"`，通过 `fields` 和 base64 `files` 组装表单。API 返回 `{ ok, status, statusText, headers, body }`，非 2xx 不自动抛错；JSON 错误响应若不是合法 JSON，会以文本返回。响应按流读取，超过上限会立即中止。

## 插件私有存储 API

`ctx.storage` 是按插件 id 隔离的持久化命名空间，物理目录为 `~/.vetta/plugin-data/<plugin-id>/`。JSON 和普通文件路径均为插件根目录下的相对路径；路径穿越会被宿主拒绝。调用绑定当前插件的 capability session，不能伪造其他插件 id。

```ts
await ctx.storage.writeJson("records/item.json", { id: "item" }); // storage.write
const record = await ctx.storage.readJson("records/item.json");   // storage.read
const keys = await ctx.storage.list("records");

const blob = await ctx.storage.putBlob({
  data: base64Bytes,
  mimeType: "image/png",
});
// blob: { id, mimeType, url }；url 可直接给宿主媒体组件使用
const bytes = await ctx.storage.readBlob(blob.id);
const ref = await ctx.storage.getBlobRef(blob.id);
```

- `storage.read` 门控 `readJson`、`list`、`readFile`、`readBlob`、`getBlobRef`。
- `storage.write` 门控 `writeJson`、`writeFile`、`putBlob`。
- JSON 与 blob 元数据使用原子替换写入；blob 字节不进入 LLM 上下文。
- blob 按声明的 MIME 类型通过宿主媒体 URL 提供，不限定为图片。

图片生成、供应商协议、编辑谱系等属于插件业务，应由插件基于 `ctx.network`、`ctx.storage` 与 `ctx.agent.registerTool` 组合实现。宿主只保留两类通用 UI 能力：

- `ctx.ui.setPromptAttachment(attachment | null)`：绑定下一轮的一次性插件上下文。`attachment` 包含 `id`、`label`、可选 `icon`、`instructions[]` 和 `metadata`；宿主展示胶囊、发送时合并内容并清除。
- `usePromptAttachment()`：响应式读取当前插件 prompt attachment，可用于插件卡片的选中态。
- `ctx.ui.previewImage(ref, group?)`：打开宿主全屏图片预览器。

`readBinaryFile` 用于需要原始字节的本地文件流程：宿主做路径校验、32 MiB 限额和内容签名 MIME 嗅探，不复用文本预览的编码判断。

## 设置 API

`ctx.settings` 读插件**自身**在 `plugin.json` `contributes.settings` 声明、用户在设置页填写的值（按插件 id 命名空间）。**只读**，写入只能经宿主设置 UI。**不需要权限**。

```ts
interface PluginSettingsApi {
  get<T = unknown>(key: string): T | undefined;
  getAll(): Record<string, unknown>;
  onChange(listener: (values: Record<string, unknown>) => void): Disposable;
}
```

```ts
const apiKey = ctx.settings.get<string>("apiKey");
const sub = ctx.settings.onChange((values) => { /* 配置变更，重读 */ });
```

配置项的 schema（类型、`visibleWhen`、`secret` 等）见 [manifest.md](./manifest.md#contributessettings配置项)。引导用户去填配置用 `ctx.ui.openPluginSettings()`（跳到本插件的设置区）。

## 插件 i18n

与宿主语言同步（ADR-0033）。catalog 来自包内 `locales/<lang>.json`，**不需要权限**。

```ts
interface PluginI18nApi {
  readonly locale: string;  // 宿主当前语言
  t(key: string, params?: Record<string, string | number>): string; // 裸 key，支持 {{name}} 插值
  onChange(listener: (locale: string) => void): Disposable;
}
```

```tsx
import { useTranslation } from "@vetta-org/plugin-sdk";

function Panel() {
  const { t, locale } = useTranslation(); // 切语言自动 rerender
  return <button type="button">{t("panel.refresh")}</button>;
}
```

- 宿主渲染的插件串用 **`%key%`**；组件内用 **裸 key** 调 `t()`。
- fallback：当前 locale → `defaultLocale` → 裸 key。详见 [manifest i18n](./manifest.md#i18n)。

## 工作模式（agent_mode）

工作模式（ADR-0046）是与对话场景、会话能力正交的一条轴，把 agent 分成 **Work** 与 **Coding**。它是**纯全局态**，用户在侧边栏设置里切换。

```ts
type AgentMode = "work" | "coding";
ctx.getAgentMode(): AgentMode;                                   // 同步读当前模式
ctx.onAgentModeChanged(listener: (mode: AgentMode) => void): Disposable; // 订阅变更
```

```tsx
function Panel() {
  const [mode, setMode] = useState(ctx.getAgentMode());
  useEffect(() => ctx.onAgentModeChanged(setMode).dispose, []);
  return <div>{mode === "coding" ? "编程模式" : "工作模式"}</div>;
}
```

- 开发者可据当前模式做定制内容（不同 UI、不同行为）。
- 声明式限定资源的可见模式则用 `agent_mode` 字段：
  - **插件级**（整个插件）：[manifest `agent_mode`](./manifest.md#agent_mode工作模式白名单)。
  - **单个 tool**：`registerTool({ agent_mode: [...] })`（见 [注册 Agent 工具](#注册-agent-工具)）。
  - **单个 MCP server**：`agent.mcpServers` 内联 map 的 `agent_mode`（见 [mcp.md](./mcp.md)）。
  - **单个 skill**：其 `SKILL.md` frontmatter 的 `agent_mode`。
  - 缺省/空 = 通用；插件级与子资源级取交集。
