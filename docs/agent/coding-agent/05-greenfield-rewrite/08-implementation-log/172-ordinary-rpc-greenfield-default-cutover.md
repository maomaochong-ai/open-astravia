# 第 172 轮：普通 RPC Greenfield 默认切换

## 目标

第 171 轮完成真实 CLI 初始化失败门禁后，普通 RPC 入口仍存在一个架构缺口：Greenfield 完整 RPC 能力被命名和组合在 IM 专用边界中，未显式携带 Runtime 选项的普通 RPC 仍不能以中性 Greenfield Runtime 作为默认实现。

本轮目标是：

1. 将普通 RPC 默认后端切换为中性 Greenfield Runtime；只有宿主明确提供 IM bridge 时才选择 Greenfield IM 组合。
2. 保留显式 Legacy 选择，以及不兼容 Extension、旧会话等既有回退条件。
3. 通过 Greenfield/Product Port 补齐普通 RPC 原有完整能力，不借用 Legacy `AgentSession` 执行业务。
4. 保持 RPC wire、Tool、Prompt、Skill、MCP、会话数据与用户可见功能不变。
5. 用真实 Vetta RPC CLI 进程证明“未指定 Runtime”路径确实进入 Greenfield，并覆盖关键命令和持久化结果。

## 分析结论

### 1. Runtime 选择与产品宿主能力必须分开

此前的 `greenfield-im` 同时表达了两个不同事实：

- Agent 执行内核选择 Greenfield；
- 当前进程提供 IM host bridge。

这使普通 RPC 想使用 Greenfield 时必须借用 IM 命名和组合。正确边界应是：

```text
RPC + 无 host bridge  -> greenfield
RPC + 有 host bridge  -> greenfield-im
非 RPC + 未显式选择   -> legacy
```

`greenfield` 与 `greenfield-im` 共享 Runtime 能力，但后者额外组合 IM 宿主适配。选择器仍输出结构化决策和回退原因，不把回退逻辑散落到命令分发器。

### 2. RPC 能力属于外围编排，不属于 Agent 内核

模型选择、Thinking、队列模式、压缩、Memory flush、自动重试、Bash、统计、命名、导出和会话切换都不是 Turn Engine 的最小职责。它们应由 RPC capability adapter 组合现有 Session/Product Port：

- Runtime Session 负责 Turn、历史和会话状态；
- 产品能力负责压缩、Memory、Retry 与命令执行；
- RPC Adapter 只负责命令到能力的映射；
- CLI Composition Root 决定注入哪些具体实现。

因此本轮新增的是可复用的 Greenfield RPC 外围能力，而不是把 RPC 逻辑写入 Kernel 或重新实现一套业务规则。

### 3. 兼容消息必须保留精确身份

直接 Bash 的结果不能只投影为普通文本，否则恢复后会丢失 `bashExecution` 身份并改变既有 RPC 消息读取行为。本轮通过 V2 `context.recorded` 持久化 `vetta.legacy_agent_message` 信封，再由 Coding Agent 产品适配器恢复精确 `AgentMessage`。

HTML 导出同样直接消费 V2 `ConversationDocument`，不为了兼容旧导出器重新打开 Legacy `SessionManager`。格式兼容留在明确的投影和导出边界中。

### 4. 中性命名需要真实实现，而不只是重导出

新增中性的 Greenfield RPC Adapter、Runtime Host 和事件入口；原 `greenfield-im-*` 文件保留为兼容包装与别名。这样新组合不依赖 IM 命名，既有消费者也不需要同步迁移或发生导入破坏。

## 实施内容

### Runtime 选择与 CLI 组合

- `AgentRuntimeBackend` 增加 `greenfield`。
- 普通 RPC 在没有显式 Runtime 时默认选择 `greenfield`；存在 host bridge 时选择 `greenfield-im`。
- 显式 `--agent-runtime greenfield` 成为受支持路径。
- 不兼容 Extension 和 Legacy Session 的能力驱动回退继续选择 `legacy`。
- 非 Legacy RPC 的 stdout 保护覆盖中性 Greenfield 与 Greenfield IM 两种组合。

### 中性 RPC 宿主边界

- 新增 `greenfield-rpc-session-adapter.ts`，承载中性 Session/RPC 适配。
- 新增 `greenfield-rpc-runtime-host.ts`，承载普通 RPC Runtime Host 组合。
- 新增 `greenfield-rpc-events.ts`，承载 Greenfield RPC 事件适配。
- 原 Greenfield IM 文件继续提供兼容导出，不删除旧入口。

### 完整 RPC Profile 与能力

- 新增 id 为 `greenfield` 的完整 RPC Profile，命令范围为 `all`。
- Greenfield RPC 通过现有 Session/Product Port 提供：模型选择与循环、模型列表、Thinking 设置与循环、队列模式、手动/自动压缩、Memory flush、会话级自动重试、可取消 Bash、会话统计、会话命名、V2 HTML 导出、会话切换/Fork、消息读取、最后 Assistant 消息和命令发现。
- `setName` 合同允许异步实现，RPC dispatcher 会等待命名完成。
- 自动重试控制器保持会话局部状态；配额耗尽等不可重试错误不会进入重试循环。
- Bash 使用可取消执行能力，并将结果以 V2 Context Event 持久化。

### Coding Agent 可复用外围能力

- 新增 Greenfield RPC Retry、Bash、统计、AgentMessage 投影、Thinking level 解析与 V2 HTML 导出辅助能力。
- 公开 RPC 子路径和包入口导出完整 Greenfield Profile 与外围能力。
- CLI 只消费 Coding Agent 的公开边界，不跨包直接依赖其内部实现，也不把 `@vetta/agent-core` 或 `@vetta/ai` 的类型逻辑复制到宿主层。

## TypeBox / Zod 判断

本轮没有新增 RPC wire 或外部配置格式。现有 RPC 输入继续由既有 TypeBox validator 校验；新增 Profile、Controller 和投影均为进程内静态 TypeScript 合同，因此没有额外引入 TypeBox 或 Zod。

若后续新增可持久化的 RPC 配置字段或新的外部事件信封，应在对应输入边界扩展既有 TypeBox schema，而不是在 Runtime 内部重复校验。

## 兼容性判断

本轮是默认实现切换和架构解耦，不是功能重构：

- 普通 RPC 命令集合保持完整，没有因切换 Greenfield 而缩小功能面。
- RPC JSONL wire 和命令名称未改变。
- Tool、Prompt、Skill、MCP 和 Extension 的业务行为未改变。
- Legacy Session、能力不兼容 Extension 和显式 `legacy` 仍能进入旧后端。
- 原 Greenfield IM 导入路径和关闭错误文案保留。
- Bash 消息恢复后仍保持原 `bashExecution` 身份。
- V2 HTML 导出不依赖 Legacy Session 重开，因此没有重新引入旧执行所有权。

## 测试合同

- Runtime Selector：覆盖普通 RPC 默认 Greenfield、带 host bridge 默认 Greenfield IM、非 RPC 默认 Legacy，以及显式 Runtime 选择。
- 真实 RPC 进程：不传 Runtime 参数启动 Vetta CLI，验证结构化 Runtime 决策实际为 Greenfield。
- 完整能力：验证模型、Thinking、队列、Retry、压缩、命名、Bash、统计和 HTML 导出命令。
- 持久化身份：Bash 执行后从 V2 会话恢复消息，验证消息仍是精确 `bashExecution`。
- Retry：验证可重试的 503 会重试，配额耗尽错误不会重试。
- 兼容宿主：既有 Greenfield IM RPC Adapter 与 Runtime Host 测试继续通过。
- 公开 API：验证完整 Greenfield RPC Profile 可从正式子路径导入。

## 明确未修改

- 没有删除 Legacy RPC、Legacy Session 或 Greenfield IM 兼容入口。
- 没有改变普通非 RPC CLI 的默认 Runtime。
- 没有新增协议字段、会话 schema 或迁移格式。
- 没有重新实现 Tool、Prompt、Skill、MCP、Extension 或模型调用逻辑。
- 没有使用全局 Runtime 快照固定动态能力；Tool、Prompt、Skill 和 MCP 仍按既有运行时边界解析。
- 没有把 IM bridge 下沉到 Coding Agent Kernel。

## 验证结果

- Coding Agent 定向测试：3 个文件、19 项通过。
- CLI 定向测试：3 个文件、41 项通过。
- 本轮合计 60 项定向测试通过。
- `bun run check:quick` 通过，包含 package boundary 与独立 CLI build surface 检查。
- 根目录完整 `bun run check` 通过：Biome、monorepo 类型检查、Desktop 类型检查、Admin 类型检查与质量守卫均通过。
- `git diff --check` 通过。

## 下一步

下一阶段应为普通 RPC 补齐独立安装产物的默认 Greenfield 差分门禁：使用实际发布布局启动未显式指定 Runtime 的 CLI，覆盖创建、恢复、Bash/压缩/导出、动态能力刷新和关闭；同时记录所有触发 Legacy 回退的结构化原因。门禁稳定后，再依据真实回退数据评估是否能收缩 Legacy RPC Composition，不能先删除兼容实现。
