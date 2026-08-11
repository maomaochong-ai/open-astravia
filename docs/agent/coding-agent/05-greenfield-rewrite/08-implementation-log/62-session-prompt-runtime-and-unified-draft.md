# 第 62 轮：Session Prompt Runtime 与统一 Prompt Draft

## 目标

第 61 轮已经建立 Profile 独占的 `ModelCallFrameComposer`，但生产组合仍存在三个缺口：

1. Greenfield CLI 只有调用方显式注入 Resolver 时才会使用完整 Coding Agent Prompt。
2. Composer 直接用单个字符串替换候选 Instructions，Feature 指令可能被静默丢弃。
3. MCP Prompt 同时经 Feature Instruction 和 CLI 手工状态读取进入 Composer，存在双通道。

本轮只收敛 Prompt 的 Session 所有权和调用级编译边界，不迁移动态 Plugin Provider 或
Continuation Policy。

## 实施内容

### 1. Session 级 Coding Agent Prompt Runtime

新增 `CodingAgentPromptRuntime`：

- 每个 Greenfield Session 独立持有一份 Runtime。
- 调用前读取当前 Resource、Personalization、Agent Mode 和 Memory 状态。
- 每次调用执行 Skill 文件变化检测和 Personalization 定向重载。
- 输出既有 `BuildSystemPromptOptions`，不把 ResourceLoader、Settings 或 Memory 语义下沉到
  Runtime Core。
- 提供 `createCodingAgentPromptRuntime()` 生产工厂，默认创建并初始化
  `DefaultResourceLoader` 与 `SettingsManager`。
- 默认 ResourceLoader 不加载 Extension、Prompt Template 和 Theme；这些能力没有在本阶段
  迁入 Greenfield Prompt Runtime。

CLI Greenfield 组合现在会为每个 Session 默认创建真实 Prompt Runtime。原有
`createSystemPromptOptionsResolver` 和 `resolveSystemPromptOptions` 继续作为显式覆盖入口，
旧生产 RuntimeHost 入口没有切换。

### 2. 复用旧结构化 Prompt Source

`system-prompt-builder.ts` 新增
`resolveSystemPromptOptionsFromSources()`，把 Resource、Settings、Mode、Memory 和静态 Plugin
配置解析为既有 `BuildSystemPromptOptions`。

旧 `rebuildSystemPrompt()` / `rebuildSystemPromptDraft()` 仍保留原工具注册表过滤语义，只是复用
新的纯 Source 解析函数，没有改变旧 AgentSession 的结果。

内部 Source 使用窄接口：

- Personalization 只要求 `getPersonalization()`。
- Prompt Resource 只要求 System Prompt、Append Prompt、Skill 和 AGENTS 文件读取能力。

因此 Greenfield Adapter 不依赖完整 Settings/Resource Manager 行为，生产工厂再负责连接具体实现。

### 3. 统一 Prompt Draft 编译

`CodingAgentModelCallFrameComposer` 不再直接调用 `buildSystemPrompt()` 后丢弃候选 Instructions。
当前流程变为：

```text
Session Prompt Source
  + 当前 Model Call Tools
  + Feature Instructions
  + 静态 Plugin Prompt Operations
  -> SystemPromptDraft
  -> priority + id 稳定排序
  -> 单个最终 system prompt
```

Feature Instruction 会转换为既有 Prompt Block 并进入同一次渲染。若 Instruction ID 与核心、
静态 Plugin 或另一个 Feature Block 冲突，Composer 明确失败，不再静默覆盖。

本轮没有扩展旧 `SystemPromptBlockType` 公共联合类型。最初尝试增加 `feature` 类型时，整仓类型
检查发现它会破坏 Runtime Core 与旧 Coding Agent Plugin Invocation 的结构方差，因此撤回该
扩展；Feature 来源只在 Composer 内映射为现有 Plugin Block 表达，不扩大 Kernel/Legacy 合同。

### 4. MCP 单状态源与兼容渲染

直接把 MCP Feature 的预渲染文本加入完整 Coding Agent Draft，会改变旧 Custom Prompt 分支的
Markdown 格式。为保持模型可见行为，本轮采用：

- `McpDeferredToolController` 继续作为唯一 MCP Session 状态源。
- Controller 的 Feature 默认仍贡献 MCP Instruction，保持非 Composer 调用方兼容。
- Coding Agent Composer 场景关闭 Feature 的重复 Prompt Instruction。
- Composer 通过只读 `readMcpPromptState()` 取得同一状态，并交给既有
  `buildSystemPromptDraft()` 按 Custom/Default Prompt 分支渲染。
- CLI 只负责连接状态读取函数，不再拼装 MCP 文本或解释 Prompt 格式。

因此 MCP 工具索引只进入最终 Prompt 一次，同时保留：

- Default Prompt 的普通文本 MCP 段落。
- Custom Prompt 的 Markdown 标题和粗体工具名。
- deferred/eager 两种既有使用说明。
- `tool_search` 和已激活 MCP 工具的 Session 隔离语义。

## 测试

### Coding Agent Adapter

命令：

```text
bunx vitest --run test/runtime-core/greenfield-adapters.test.ts
```

结果：`7 passed`。

覆盖：

- 旧结构化 Prompt 精确输出。
- Feature Instruction 的稳定合并顺序。
- 核心 Block ID 冲突失败。
- Resource、Personalization、Mode、Memory 在下一次模型调用刷新。
- 两个 Prompt Runtime 的状态隔离。

### CLI Greenfield Composition

命令：

```text
bunx vitest --run test/greenfield-runtime-composition.test.ts
```

结果：`11 passed`。

覆盖：

- 两个真实 Session 分别加载各自工作目录的 AGENTS 指令。
- 自定义 Resolver 仍按模型调用读取动态状态。
- MCP 添加、删除、恢复和 deferred 激活。
- Custom Prompt 中 MCP Markdown 兼容。
- MCP Prompt 只出现一次。

`runtime-mcp` 当前没有 `test` script；其新增的 Feature Prompt 开关和只读状态入口由上述 CLI
端到端测试覆盖。

### 质量门禁

```text
bun run check:quick
bun run check
```

结果：全部通过。整仓检查包含：

- Biome。
- monorepo `tsgo --noEmit`。
- desktop-app `tsc --noEmit`。
- admin `tsc -b`。
- private key、冲突标记、构建顺序和包边界 guards。

## 明确未实施

- 动态 Plugin System Prompt Provider。
- Plugin `setToolEnabled` 对完整可用工具目录的控制。
- Plugin `requestContinuation` 和 Continuation Provider。
- Todo、Plugin、Stop Hook 的 Greenfield 续跑优先级。
- Greenfield Memory 的生产状态存储；本轮只建立可读取的 Prompt Port。
- 旧生产入口到 Greenfield 的默认切换。

## 下一步

下一阶段应作为一个完整阶段实现“动态 Plugin Model Call Orchestrator + Runtime Continuation
Policy”：

1. Coding Agent Session 独占 Plugin 调用状态、超时、失败隔离和 pending effects。
2. Prompt/Tool Effect 在调用边界生效，并能访问完整可用工具目录。
3. Runtime Core 增加业务无关的 Continuation Policy 窄端口。
4. 保留 User Follow-up、Todo、Plugin 和 Stop Hook 的既有顺序、次数上限与幂等语义。

