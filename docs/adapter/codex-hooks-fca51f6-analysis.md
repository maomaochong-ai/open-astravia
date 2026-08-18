# Codex Hook 最新基线分析与 Vetta 实施方案

## 1. 分析范围

本文只分析 Hook 兼容，不把 Vetta 实现成 Codex，也不改变既定文件发现边界。

- 最新 Codex 源码：`C:\github\codex`
- 最新基线：`fca51f6dafb106177f23084d16f076ff2f66dd91`，2026-07-15
- Vetta 兼容包：`packages/ecosystem-adapter`
- Vetta 宿主接入：`packages/coding-agent/src/core/hooks`

本文以 `fca51f6` 为唯一兼容基线，不保留旧版 Codex Hook profile。

文件发现边界保持不变：兼容层只解析 Vetta 应用显式提供的配置文件或插件目录，不搜索 `CODEX_HOME`、用户 `.codex`、项目 `.codex`，更不能运行时读取 `C:\github\codex`。

## 2. 核心结论

当前实现的抽象方向是正确的：使用独立的 `@vetta/ecosystem-adapter`，并允许 SDK 追加 adapter，而不是在 `coding-agent` 中不断增加 `xxHook`。

最新版 Codex 相比早期实现已经发生结构性变化，不能只给原有 5 事件和 Bash-only mapper 增加几个枚举值：

1. Hook 事件从 5 个增加到 10 个。
2. Pre/PostToolUse 已进入通用 function tool 注册器，不再是 Bash-only。
3. PreToolUse 可以返回 `updatedInput`，宿主必须在执行前替换真实工具参数。
4. PostToolUse 的 block 会拒绝已经产生的工具结果，而不是只追加一段文本。
5. PermissionRequest 已成为独立审批边界。
6. PreCompact/PostCompact 和 SubagentStart/SubagentStop 已有真实触发点。
7. 插件可以声明 Hook 文件，并获得插件根目录和数据目录环境变量。
8. Hook 配置具有启用状态、内容哈希和信任状态。

兼容实现只维护版本化的 `codex-hooks/fca51f6` profile。删除旧版协议分支可以避免双份 codec、parser 和聚合语义长期漂移；未来升级 Codex 时直接审查并更新唯一 profile 及其契约夹具。

## 3. 最新 Codex 的真实能力

### 3.1 事件全集

最新版声明并执行以下 10 个事件：

| 事件 | matcher 输入 | 主要宿主边界 | 关键效果 |
| --- | --- | --- | --- |
| `SessionStart` | `startup`、`resume`、`clear`、`compact` | 根会话开始/恢复 | 停止、注入上下文 |
| `UserPromptSubmit` | 忽略 matcher | 用户输入写入会话前 | 阻止、停止、注入上下文 |
| `PreToolUse` | 工具名及 matcher aliases | 工具实际执行前 | 阻止、注入上下文、改写输入 |
| `PermissionRequest` | 工具名及 matcher aliases | 宿主准备请求权限时 | allow/deny 审批决策 |
| `PostToolUse` | 工具名及 matcher aliases | 成功工具执行后 | 拒绝结果、反馈、注入上下文 |
| `PreCompact` | `manual`、`auto` | 压缩真正开始前 | 停止压缩流程 |
| `PostCompact` | `manual`、`auto` | 压缩完成后 | 停止后续流程 |
| `SubagentStart` | agent type | thread-spawn 子代理启动 | 停止、注入上下文 |
| `SubagentStop` | agent type | thread-spawn 子代理结束 | 阻止结束并续跑、停止 |
| `Stop` | 忽略 matcher | 根 turn 准备结束 | 阻止结束并续跑、停止 |

需要注意：Codex 只对 thread-spawn 子代理发出 SubagentStart/SubagentStop。内部或合成子代理不会冒充用户可见的子代理生命周期。

### 3.2 matcher 不是普通 JavaScript 正则

最新版的 matcher 规则为：

- 未提供、空字符串或 `*`：匹配全部。
- 只包含 ASCII 字母、数字、下划线和 `|`：按精确候选匹配，`Edit|Write` 表示两个精确名称。
- 含其他正则字符：按正则匹配。
- `UserPromptSubmit` 和 `Stop` 完全忽略 matcher。

当前 Vetta 对所有非空 matcher 都使用 `new RegExp()`，并不等价。例如 `mcp__memory` 在 Codex 中是精确匹配，在 Vetta 中可能匹配更长名称。

### 3.3 工具覆盖范围

最新版并非只支持 Bash：

- 通用 function tool 默认都有 PreToolUse 和成功后的 PostToolUse。
- shell、exec、unified exec 对外统一使用 canonical name `Bash`。
- `apply_patch` 的 canonical name 是 `apply_patch`，matcher aliases 是 `Write`、`Edit`。
- `spawn_agent` 的 canonical name 是 `spawn_agent`，matcher alias 是 `Agent`。
- MCP 工具使用稳定名称，例如 `mcp__rmcp__echo`。
- 其他 function tool 使用扁平化后的真实工具名。

canonical name 会写入 stdin；aliases 只用于选择 handler，不能把 alias 写进 payload。

这意味着 Vetta 不能继续使用“只有 `toolName === "bash"` 才支持 Codex Tool Hook”的判断。也不能把所有 Vetta 工具伪装成 Bash。正确方式是为工具调用提供可扩展的 Hook contract：工具实际名称、matcher aliases、稳定输入、稳定输出以及输入改写函数分别建模。

### 3.4 handler 声明与实际执行

最新版配置层能解析：

- `command`
- `prompt`
- `agent`
- `async: true | false`

但真实执行能力仍然只有同步 command：

- async command 会被跳过并产生 warning。
- prompt handler 会被跳过并产生 warning。
- agent handler 会被跳过并产生 warning。

因此 `codex-hooks/fca51f6` 不应提前实现 Codex 自己尚未执行的三种模式。通用执行内核可以保留 executor 扩展点，但该 profile 必须与 Codex 一样明确诊断并跳过。

command handler 新增或明确支持：

- `commandWindows` / `command_windows`：Windows 优先使用该命令。
- `timeout`：默认 600 秒，最小 1 秒。
- `statusMessage`。
- 插件环境变量替换。

### 3.5 插件 Hook 来源

最新版插件 manifest 可以通过 `paths.hooks` 指向一个或多个 Hook 文件，常见位置为 `hooks/hooks.json`。执行插件 Hook 时提供：

- `PLUGIN_ROOT`
- `CLAUDE_PLUGIN_ROOT`
- `PLUGIN_DATA`
- `CLAUDE_PLUGIN_DATA`

后两个 `CLAUDE_*` 名称是为了兼容已有插件。

Vetta 应支持“由 Vetta 插件加载器显式传入的插件 Hook 来源”，但不能因此扫描外部 Codex 安装目录。插件根目录必须位于 Vetta 已安装或已启用的应用插件范围，Hook 文件也必须经过根目录边界校验。

### 3.6 信任与状态

最新版不是“发现 command 就直接执行”。每个 Hook 具有：

- 稳定 key
- enabled 状态
- normalized content hash
- trusted hash
- `Managed`、`Trusted`、`Untrusted`、`Modified` 等信任状态

未启用或不受信任的普通 Hook 不进入执行集合。当前 Vetta 缮信任状态和内容变更检测，属于安全和兼容双重缺口。

## 4. 最新 wire contract 的重要变化

所有 command 都通过 stdin 接收单个 JSON 对象。公共字段根据事件不同组合，不能由一个“把所有字段都塞进去”的通用序列化器代替。

### 4.1 新增输入字段

- `turn_id`：除根 SessionStart 外的大多数 turn 事件必需。
- `agent_id`、`agent_type`：子代理事件必需；子代理内的 prompt/tool/permission/compact 事件可选。
- `trigger`：PreCompact/PostCompact，值为 `manual | auto`。
- `agent_transcript_path`：SubagentStop 的子代理 transcript。
- `transcript_path`：SubagentStop 中指向父线程 transcript。
- `source`：SessionStart 新增 `compact`。
- `tool_input`：不再固定为 `{ command }`，而是任意 JSON 值。
- `tool_response`：由具体工具提供稳定 Hook 响应，MCP 保留结构化响应。

### 4.2 PreToolUse 输出

最新版支持：

- `permissionDecision: deny` + 非空 reason：阻止工具。
- `permissionDecision: allow` + `updatedInput`：允许并替换实际工具输入。
- `additionalContext`：作为独立 developer context 写入会话。
- 多个 handler 并发执行；如果没有任何 block，最后完成的有效 `updatedInput` 胜出。

`permissionDecision: ask` 仍被 Codex 判为 unsupported 并失败开放；`allow` 但没有 `updatedInput` 同样判为 unsupported。

### 4.3 PermissionRequest 输出

有效输出位于：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "message": "optional"
    }
  }
}
```

`behavior` 为 `allow | deny`。多个 handler 中 deny 优先于 allow；无人决策时返回无决策，继续宿主原审批流程。

`interrupt`、`updatedInput`、`updatedPermissions` 已出现在 schema 中，但当前 Codex 明确保留为未来能力，出现时失败关闭，不能擅自实现。

### 4.4 PostToolUse 输出

- `decision:block` 会拒绝模型看到原工具结果，但无法回滚已经完成的副作用。
- 非阻止 feedback 可以替换模型可见的工具输出。
- `additionalContext` 作为独立 developer context 记录。
- `updatedMCPToolOutput` 仍是 unsupported。

当前 Vetta 把 additional context 和 feedback 拼进工具结果文本，并忽略 `post.shouldBlock`，与最新版语义不一致。

### 4.5 Compact 和 Stop 输出

- PreCompact/PostCompact 的 `continue:false` 会停止对应流程。
- PreCompact 不接受旧式 `decision:block`。
- Stop/SubagentStop 的 `decision:block` + reason 表示不要结束，使用 reason 继续 agent loop。
- `stop_hook_active` 防止递归语义丢失。

## 5. 当前 Vetta 的差距

| 能力 | 当前状态 | 结论 |
| --- | --- | --- |
| 独立生态适配包 | 已有 `@vetta/ecosystem-adapter` | 保留 |
| Adapter 工厂扩展 | SDK 可追加 factory | 保留 |
| Host 与 adapter 分离 | 基本完成 | 需要进一步去 Codex 事件形状化 |
| 最新 profile | 实施前未实现 | 新增唯一的 `fca51f6` profile |
| 事件模型 | 只有 5 个 Codex 名事件 | 缺 5 个新事件，且通用层被 Codex 枚举锁定 |
| Tool Hook 覆盖 | 宿主 wrapper 包装所有工具，但 Codex adapter 只接受 bash | adapter 仍是 Bash-only |
| 工具 matcher aliases | 无 | 缺 Write/Edit、Agent 等选择语义 |
| MCP 名称 | Vetta 使用 `mcp_<server>_<tool>` | 与 Codex `mcp__<server>__<tool>` 不兼容，且仅靠字符串无法可靠拆分含下划线名称 |
| PreToolUse 输入改写 | outcome 无 updated input | 不能执行最新版 `updatedInput` |
| PreToolUse additional context | 实施前未实现 | 最新 profile 必须支持独立注入 |
| PostToolUse block | wrapper 未处理 | 不能拒绝工具结果 |
| PostToolUse context/feedback | 拼到 tool result content | 应区分 developer context、feedback 和原结果 |
| PermissionRequest | 无统一 Host Hook 边界 | 缺审批事件和 allow/deny 回接 |
| Pre/PostCompact | coding-agent 有压缩生命周期，但 Hook runtime 未接入 | 有宿主基础，缺桥接 |
| SubagentStart/Stop | coding-agent 当前无对应可见子代理生命周期 | 需要先提供宿主能力，再发 Hook |
| SessionStart `compact` | 类型不支持 | 缺 source |
| matcher 算法 | 全部按 JS 正则 | 与精确候选规则不一致 |
| `commandWindows` | 未解析 | Windows 插件兼容缺口 |
| TOML Hook | 只读 hooks.json | 最新 config 表示兼容缺口，可按应用需要决定是否开放文件入口 |
| 插件 manifest Hook | 未解析 `paths.hooks` | 无法无缝加载 Codex 插件 Hook |
| 插件环境变量 | 无 handler env | 插件脚本路径通常无法工作 |
| 信任与 hash | 无 | 发现后直接执行，缺安全状态模型 |
| Handler 完成顺序 | Promise.all 后按配置顺序聚合 | 无法实现“最后完成的 updatedInput 胜出” |
| 运行事件 | 有 observer，但信息较少 | 需要 source、handler type、execution mode、scope、trust 等元数据 |

## 6. 推荐架构

### 6.1 通用层不要使用 Codex 事件名作为领域模型

`packages/ecosystem-adapter/src/hooks/types.ts` 当前直接定义 `SessionStart | PreToolUse ...`，导致通用包实际上被 Codex wire contract 塑形。

建议把 Host 原生生命周期定义为稳定、生态无关的 hook points：

```text
session.start
input.beforeSubmit
tool.beforeExecute
permission.beforeRequest
tool.afterSuccess
context.beforeCompact
context.afterCompact
agent.start
agent.beforeStop
turn.beforeStop
```

这些名称表达 Vetta 的真实边界，不承诺任何外部 wire 字段。Codex adapter、未来 Claude adapter 或其他生态 adapter 分别把 Host event 映射为自己的事件。

### 6.2 四层职责

```text
coding-agent Host Bridge
  只在真实生命周期边界发出 Host event，并应用归一化 effect
        ↓
ecosystem-adapter Hook Orchestrator
  adapter 选择、并发、effect 合并、观察事件
        ↓
Ecosystem Profile
  配置解析、matcher、wire codec、输出语义、工具命名
        ↓
Handler Executor
  command 进程、stdin/stdout、超时、取消、输出限制
```

约束：

- `coding-agent` 不出现 `CodexHook`、`ClaudeHook` 等实现类。
- `coding-agent` 不解析外部配置文件。
- profile 不直接操作 AgentSession、压缩器或工具实例。
- executor 不理解事件、matcher 或 JSON 语义。
- 文件发现由 Vetta 应用 source provider 负责，adapter 只接收显式 source。

### 6.3 归一化 effect

通用 outcome 至少需要表达：

```ts
interface HostHookEffect {
  stop?: { reason?: string };
  block?: { reason: string };
  additionalContexts: readonly string[];
  feedbackMessages: readonly string[];
  updatedToolInput?: unknown;
  permissionDecision?: "allow" | "deny";
  continuationPrompts: readonly string[];
}
```

字段是宿主能执行的动作，不是 Codex JSON 字段。Codex profile 负责把 `permissionDecision`、`decision:block`、`continue:false` 等 wire 语义转换成这些动作。

### 6.4 工具 Hook contract 注册表

不能只把 `tool.name` 和 params 传给 adapter。宿主应提供工具元数据：

```ts
interface HostToolHookDescriptor {
  readonly hostName: string;
  readonly kind: "function" | "shell" | "mcp" | "file-edit" | "agent" | "custom";
  readonly source?: { ecosystem?: string; serverName?: string; originalName?: string };
}
```

Codex profile 内部再解析为：

```ts
interface CodexToolHookContract {
  readonly canonicalName: string;
  readonly matcherAliases: readonly string[];
  encodeInput(input: unknown): unknown;
  applyUpdatedInput(input: unknown, updated: unknown): unknown;
  encodeResponse(result: unknown): unknown;
}
```

建议的首批规则：

- Vetta `bash`、`shell` -> Codex `Bash`。
- MCP adapter 在创建工具时保留 server/tool 原始元数据，再编码为 `mcp__server__tool`；不要从 `mcp_server_tool` 猜边界。
- 普通 function tool 默认使用真实名称和原 JSON 输入。
- Vetta `edit`、`write` 先提供 matcher aliases `Edit`、`Write`。只有能生成等价 `apply_patch` 输入时，才能宣称 canonical `apply_patch` 精确兼容。
- 未来子代理工具通过元数据映射 `spawn_agent` + `Agent`，不要写死在 wrapper。

### 6.5 配置来源模型

建议把“在哪里找文件”和“如何解析 Codex 文件”分开：

```text
VettaHookSourceProvider
  - agentDir/hooks.json
  - <cwd>/.vetta/hooks.json
  - Vetta 已安装插件 manifest 显式声明的 hooks paths

CodexHookConfigDecoder
  - hooks.json
  - 可选：应用配置目录内 config.toml 的 [hooks]
  - commandWindows、timeout、statusMessage
  - plugin env 和 source metadata
```

SourceProvider 必须返回规范化绝对路径，并验证插件 Hook 路径位于插件根目录。Codex decoder 不允许自行向上搜索或读取 Codex 默认目录。

### 6.6 推荐目录

```text
packages/ecosystem-adapter/src/
  hooks/
    domain/
      events.ts
      effects.ts
      runs.ts
      sources.ts
      tools.ts
    engine/
      orchestrator.ts
      matcher.ts
      command-executor.ts
      outcome-aggregation.ts
    runtime.ts
  codex/
    hooks/
      latest/
        profile.ts
        input-codec.ts
        output-parser.ts
        event-semantics.ts
        matcher.ts
        tool-mapper.ts
      config/
        json-decoder.ts
        toml-decoder.ts
        discovery.ts
        trust.ts
      tools/
        mapper.ts
        bash.ts
        mcp.ts
        function.ts
      plugins/
        hook-sources.ts
        environment.ts
```

文件可以按实际代码量合并，但边界不能反向：Codex profile 不能污染通用层，Codex mapper 不能放入 coding-agent。

## 7. 实施顺序

### 阶段 1：修正通用内核

1. 把通用事件改为 Host hook points，不保留旧版 Codex profile 分支。
2. 扩展 normalized effect，加入 `updatedToolInput` 和 `permissionDecision`。
3. 把 matcher 策略从 dispatcher 移到 profile；不同生态可以使用不同规则。
4. 让 executor request 支持显式 env。
5. 记录真实 handler 完成顺序。

验证：`coding-agent` 不新增任何生态专用类；通用 dispatcher 不依赖 Codex wire 字段。

### 阶段 2：新增 `codex-hooks/fca51f6` 配置和 wire profile

1. 增加 10 个事件的配置解码。
2. 支持 `commandWindows`。
3. 精确实现 matcher 规则。
4. 为 10 个事件建立独立 input codec 和 output semantics。
5. prompt、agent、async 与 Codex 一样诊断并跳过。

验证：直接使用 `C:\github\codex\codex-rs\hooks\schema\generated` 中的 fixture 形状建立本地测试副本；运行时测试不依赖外部源码目录。

### 阶段 3：完整 Tool Hook

1. 将 wrapper 改成“执行前应用可能被改写的参数”。
2. 普通 function tool 默认进入 Pre/Post。
3. 增加 Bash、MCP 和 matcher alias mapper。
4. Post block 拒绝结果；feedback 与 additional context 分流。
5. additional context 作为独立 developer/custom context 写入，不拼入 tool result。

验证：普通工具、Bash、MCP 都能按 canonical name 和 alias 匹配；updatedInput 只执行一次改写后的工具；Post block 不回滚副作用但拒绝原结果。

### 阶段 4：PermissionRequest 和 Compact

1. 在统一审批入口发出 `permission.beforeRequest`。
2. deny 优先，allow 可短路原审批，无决策继续原流程。
3. 在手动和自动压缩的真实边界接入 before/after compact。
4. 支持 `manual | auto` trigger 和 SessionStart `compact`。

验证：Hook 不会绕过 Vetta 未授权的宿主能力；PreCompact 停止时压缩没有开始；PostCompact 发生在新摘要和 transcript 已稳定之后。

### 阶段 5：Subagent 生命周期

1. 先建立 Vetta 可见子代理的真实生命周期和父子 transcript 关系。
2. 只对用户可见、thread-spawn 等价子代理发事件。
3. SubagentStart 使用 agent type matcher。
4. SubagentStop block 进入受限续跑，复用 Stop 的递归保护。

验证：内部任务不误发子代理 Hook；父子 transcript 字段方向与 Codex 一致。

### 阶段 6：插件来源和信任

1. 解析 Vetta 已安装插件 manifest 中显式声明的 Codex Hook 路径。
2. 提供四个插件环境变量。
3. 建立 normalized hash、enabled、trusted/modified 状态。
4. 未受信任或内容已变化的 Hook 不执行，只产生可观察诊断。

验证：插件路径越界被拒绝；修改脚本或 command 后信任失效；从不扫描 `.codex`。

## 8. 完成标准

只有同时满足以下条件，才能称为最新版 Codex Hook 兼容：

1. 只维护明确版本化的 `fca51f6` profile，不保留旧版兼容分支。
2. 10 个事件均有真实宿主边界或明确报告“宿主能力尚未提供”，不能静默伪造。
3. Pre/PostToolUse 覆盖普通 function tool、Bash 和 MCP，不再 Bash-only。
4. canonical name、matcher aliases、tool input、tool response 分离。
5. PreToolUse `updatedInput` 能改写实际执行参数。
6. PostToolUse block、feedback、additional context 语义正确分流。
7. PermissionRequest 接入统一审批边界。
8. commandWindows、插件 env、信任状态可用。
9. prompt、agent、async 的行为与该 Codex 基线一致：诊断并跳过。
10. 所有配置只从 Vetta 应用显式提供的目录或已安装插件根目录生效。
11. `coding-agent` 只依赖通用 Host Hook 接口，不包含生态专用 Hook 实现。

## 9. 当前建议

下一步不应继续在现有 Bash adapter 上补事件。应先完成阶段 1 的通用内核调整，再新增 `fca51f6` profile；否则 Tool updatedInput、PermissionRequest、Compact 和未来其他生态都会再次迫使 `coding-agent` 改动。

真正需要替换的是“通用层等于 Codex 事件”以及“Codex adapter 等于 Bash mapper”这两个假设；旧版 profile、codec、parser 和聚合实现不再保留。

## 10. 本轮实施结果（2026-07-15）

本轮已建立唯一的版本化 `fca51f6` profile，并删除旧版 profile 及选择分支。实现不是 Codex 专用宿主层：`coding-agent` 只持有 `EcosystemHookRuntime`、宿主事件和归一化 effect；Codex matcher、wire JSON、工具命名、配置语义全部位于 `packages/ecosystem-adapter/src/codex/hooks`。

### 10.1 已落地的结构

```text
coding-agent lifecycle / tool wrapper
  -> EcosystemHookRuntime（生态无关事件与 effect）
    -> EcosystemHookAdapter（可追加其他生态 factory）
      -> codex-hooks/fca51f6 profile
        -> matcher / input codec / output semantics / tool mapper
          -> Node command executor
```

文件发现仍由应用决定。默认仅传入 `agentDir/hooks.json` 和 `<cwd>/.vetta/hooks.json`；兼容包不会访问 `C:\github\codex`、`CODEX_HOME`、`~/.codex` 或项目 `.codex`。`HookConfigLayer.sources` 可承接未来由 Vetta 插件加载器显式提供的文件与环境变量。

### 10.2 事件功能对照

| Codex 事件 | 协议/profile | Coding Agent 真实触发 | 当前结论 |
| --- | --- | --- | --- |
| `SessionStart` | 完整；支持 `startup/resume/clear/compact` | 已接入新建、恢复、清理、压缩后的下一轮 | 可用 |
| `UserPromptSubmit` | 完整；支持阻止、停止、上下文 | 已接入真实 prompt 提交前 | 可用 |
| `PreToolUse` | 完整；通用工具、阻止、上下文、`updatedInput` | 已包裹实际激活工具，改写后的参数只执行一次 | 可用 |
| `PermissionRequest` | wire、matcher、deny 优先聚合及运行时 API 已完成 | Coding Agent 尚无统一工具审批入口 | 协议可用，宿主未触发 |
| `PostToolUse` | 完整；block、feedback、context 分流 | 已接在成功工具执行后；block 不回滚副作用，但不暴露原结果 | 可用 |
| `PreCompact` | 完整；`manual/auto` | 已接在手动/自动压缩实际开始前 | 可用 |
| `PostCompact` | 完整；`manual/auto` | 已接在摘要、session 与 agent messages 稳定后 | 可用 |
| `SubagentStart` | wire、matcher、运行时 API 已完成 | Coding Agent 当前没有 Codex thread-spawn 等价生命周期 | 协议可用，宿主未触发 |
| `SubagentStop` | wire、matcher、续跑语义及运行时 API 已完成 | 同上 | 协议可用，宿主未触发 |
| `Stop` | 完整；block 续跑、递归状态、安全上限 | 已接在 continuation provider 的自然结束点 | 可用 |

“协议可用，宿主未触发”是刻意的能力声明，不是伪造事件。未来宿主增加统一审批或可见子代理后，只需调用通用 runtime API，不需要在 `coding-agent` 增加 `CodexHook` 类。

### 10.3 工具功能对照

| 工具类别 | 最新 Codex | 当前实现 | 结论 |
| --- | --- | --- | --- |
| Bash/shell | canonical `Bash` | shell descriptor 映射为 `Bash` | 兼容 |
| 普通 function tool | 真实扁平工具名 | 默认使用 Vetta 工具真实名称和原始 JSON 参数 | 兼容 |
| MCP | `mcp__server__tool` | MCP 创建时保留 server/tool 元数据，再稳定编码；不依赖下划线拆分 | 兼容 |
| `spawn_agent` | canonical `spawn_agent`，alias `Agent` | mapper 已支持结构化 agent descriptor | mapper 可用，宿主暂无该工具生命周期 |
| `apply_patch` | canonical `apply_patch`，aliases `Write/Edit` | 真正名为 `apply_patch` 的工具可按真实名匹配；Vetta `edit/write` 保留自身 canonical 并提供对应 alias | 部分兼容，不伪造不等价输入 |
| 其他自定义工具 | canonical 为真实名称 | 自动进入 Pre/Post，无需逐工具实现 `xxHook` | 兼容 |

MCP 元数据保存在工具对象的 `ecosystemHook` descriptor 中。这样未来其他生态可以复用同一宿主元数据，再由各自 mapper 生成不同 canonical name。

### 10.4 输出与执行语义对照

| 能力 | 当前结果 |
| --- | --- |
| 事件级 stdin JSON | 10 个事件分别编码，不发送无关字段 |
| 严格 stdout JSON | 按最新版 schema 拒绝未知字段、错误类型和错误事件形状 |
| matcher | 精确候选与正则分流；`UserPromptSubmit/Stop` 忽略 matcher |
| 并发 handler | 并发执行并记录真实完成顺序；最后完成的有效 `updatedInput` 胜出 |
| `commandWindows` | Windows 选择覆盖命令 |
| timeout | 默认 600 秒，最小 1 秒 |
| handler 类型 | 与当前 Codex 一致：同步 command 执行；prompt、agent、async 诊断并跳过 |
| handler env | 每个显式 source 可提供独立环境变量，执行时与进程环境合并 |
| additional context | 独立写入隐藏 custom context，不拼接进工具结果 |
| Post feedback | 只替换模型可见 content，不伪装成 additional context |
| Post block | 工具副作用已发生，原结果被拒绝并转为工具错误 |
| Stop 续跑 | 有 `stop_hook_active` 与最多 8 次续跑安全阀 |

### 10.5 仍未完成的兼容面

以下项目没有在本轮伪装成“已支持”：

1. PermissionRequest 的 Coding Agent 统一审批入口。
2. thread-spawn 等价的可见子代理生命周期与父子 transcript。
3. Vetta 插件 manifest 到 `HookConfigLayer.sources` 的自动桥接、插件路径越界检查。
4. Codex 的 enabled/trusted/modified hash 状态与用户信任 UI。
5. TOML `[hooks]` 配置入口；当前只解析显式 `hooks.json`。
6. Codex 大输出 spill-to-file 行为；当前命令执行器有 4 MiB 输出上限。
7. Vetta `edit/write` 与 Codex `apply_patch` 的输入格式转换；在存在可证明的等价转换前不宣称 canonical 完全兼容。
8. 成功 Hook 的 `statusMessage/systemMessage` 尚未桥接到 Coding Agent UI；失败运行会记录日志，行为 effect 正常生效。

这些缺口均位于明确的单一职责边界：审批属于 Host Bridge，子代理属于 Agent Host，插件发现与信任属于应用插件加载器，TOML 属于 config decoder，工具输入转换属于 Codex tool contract。后续实现不需要修改通用 dispatcher 或为每个 Hook 新增宿主实现类。

### 10.6 验证

- 已运行根目录 `bun run check`。
- Biome、monorepo `tsgo --noEmit`、desktop `tsc --noEmit` 均通过。
- 按仓库规则未运行测试；本轮未执行 `bun test`。

### 10.7 oh-story 样本复核

已使用本地 `C:\github\oh-story-claudecode` 提交 `12a9655a21abacfbd1c01eb41b98f2af007ab5be` 复核其 Codex Hook，而不是反向按该样本写死实现。

| oh-story 能力 | 当前结果 |
| --- | --- |
| `SessionStart` 四种 source | matcher 与 wire 均兼容 |
| `PreToolUse` 的 `Bash\|apply_patch\|Edit\|Write` | Bash canonical 匹配；Vetta edit/write 通过 aliases 匹配 |
| 正文写前 deny | `permissionDecision:deny` 会在工具真正执行前阻止 |
| commit advisory 的 additionalContext | 作为隐藏上下文写入模型会话 |
| `PreCompact/PostCompact` | 手动和自动压缩都会触发；`systemMessage` 保持 Codex 的运行提示语义，不冒充模型上下文 |
| `Stop` 扫描 | 会在根 turn 自然结束点执行 |
| `commandWindows` | Windows 下使用样本提供的覆盖命令 |

需要由集成方处理文件部署：Vetta 不会扫描样本生成的 `.codex/hooks.json`。必须把 Hook 配置作为 Vetta 应用显式 source 提供；配置中引用的 Python 脚本也必须位于该应用/插件已安装范围内，并让命令路径与实际部署位置一致。兼容层不会自动改写脚本路径或去外部 Codex 目录寻找文件。
