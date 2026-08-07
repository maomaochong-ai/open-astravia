# 第 288 轮：RPC 与 CLI Runtime Host 生产身份收口

<!-- coding-agent-rewrite-charter:v1:start -->
## 重写目标确认（固定）

- 删除旧 `coding-agent` 内部代码、目录、内部类和仅为旧架构服务的兼容层。
- `coding-agent` 最终只承担稳定 Session 合同、产品组合根和能力编排职责。
- 新生产代码对旧 `coding-agent` 实现的依赖必须收敛到零，不能通过改名、移动目录或包装 Adapter 延续旧架构。
- Agent 内核保持最小闭环；Tool、MCP、Skill、知识库、Memory、Compaction 和 Subagent 通过独立合同围绕内核组合。

## 必须保留（固定）

- 用户可观察的 Agent 功能，以及 CLI、SDK、RPC、IM 必须继续提供的产品能力和协议。
- 会话历史、认证、模型和设置等用户数据；必要时由显式、独立的新迁移器读取旧格式。
- 模型消息、工具消息、错误、取消、事件顺序、并发约束和资源释放语义。
- 仍然有效的行为测试场景和数据 fixture；旧实现可以临时作为测试 Oracle，但不能被新生产代码调用。
- `@vetta/ai` 与经过合同验证的 `@vetta/agent-core` 等独立下层能力，除非单独审计证明其合同不满足目标。

## 明确舍弃（固定）

- 旧 `src/core` 目录结构与实现，以及旧 `AgentSession`、`SessionManager`、Manager、Registry、工具工厂和资源加载器。
- 包根聚合暴露的内部对象、深层 `core` 导入和 `compat/*` 兼容入口。
- Runtime 包对 `coding-agent` 具体实现的反向依赖，以及只为旧内部调用方式存在的 Adapter。
- 对旧内部类、目录和属性有耦合的测试；保留其行为场景，不保留其结构性假设。
- 仅展示旧 API、没有独立产品需求的示例；示例不能反向决定新架构。
- 通过修改旧功能完成“迁移”，或在架构重写阶段顺带改变用户可见功能。
<!-- coding-agent-rewrite-charter:v1:end -->

## 本阶段与最终目标的关系

第 287 轮已将产品能力 Adapter 归入正式领域，但 Coding Agent RPC 和 CLI Runtime Host 仍使用 `greenfield-*` 文件名、类型名与兼容包装。本轮将这些已经承担唯一生产职责的实现改为正式身份，并删除无行为的转发层。

本轮不修改 RPC 命令、JSONL 事件帧、Profile ID、Runtime Host 准备结果 `kind`、错误语义或用户数据格式。`"greenfield"`、`"greenfield-im"` 和 `"greenfield-print"` 作为既有协议值继续保留；被删除的是迁移期 TypeScript 身份，而不是功能合同。

## 实施内容

### Coding Agent RPC 能力拆分

- `greenfield-rpc-capabilities.ts` 政名为 `rpc-bash-capability.ts`，只保留 Bash RPC 能力；
- 会话统计、消息读取、Thinking Level 切换和 HTML 导出移入独立的 `rpc-session-operations.ts`；
- RPC Bash、Session Operations、Retry Controller 和 Profile 常量改用稳定生产名称；
- `RPC_FULL_SESSION_PROFILE` 与 `RPC_IM_SESSION_PROFILE` 的字符串 ID 保持原值。

### CLI Runtime Host 收口

- Runtime Host、合同、Session Assembly、RPC Capabilities、Session Adapter、Event Adapter、Print Adapter 和 IM Session Selection 全部改用职责名称；
- Runtime Host 内部分支由迁移期的 `greenfield` / `greenfield-im` 改为 `rpc` / `im`，对外准备结果与协议值不变；
- IM Session Adapter 改为统一 `CliRpcSessionAdapter` 的显式工厂，不再通过废弃子类表达 Profile 差异；
- 历史会话导入直接调用 `@vetta/coding-agent/historical-sessions`，删除 CLI 内纯别名迁移文件；
- CLI 包入口停止暴露废弃的 IM Event/Session Adapter 包装，只暴露正式 Runtime Host API。

### 删除迁移兼容层

删除以下没有独立产品行为的文件：

- `greenfield-rpc-events.ts`；
- `greenfield-im-rpc-session-adapter.ts`；
- `greenfield-im-legacy-session-migration.ts`。

相应测试改为直接验证正式 Event Adapter、IM Adapter Factory、Runtime Host 与历史会话迁移公共边界。

### 类型校验判断

本轮修改的是进程内 TypeScript 合同和模块身份，没有新增外部不可信结构化输入。RPC 帧、命令和 Tool 输入仍由已有 Schema 校验，因此无需新增 TypeBox 或 Zod；引入新的运行时 Schema 会重复现有验证且改变范围。

### 防回退门禁

- 迁移残留门禁扩展到 `packages/cli-app/src` 与 `packages/cli-app/test`；
- 新增 CLI `greenfield-*` 文件零基线；
- 本轮退休的 12 个 Coding Agent/CLI 源文件路径及旧符号加入禁止恢复清单；
- Runtime Host 所有权门禁改为监控正式 `runtime-host.ts` 与 `cli-session-assembly.ts`；
- Package Boundary 与 Legacy Format 门禁改为允许正式 Runtime Host 通过历史会话公共边界导入，不再依赖已删除的别名文件。

## 旧实现依赖变化

- 旧执行入口：保持 `0`；
- Runtime 对 Coding Agent 的反向依赖：保持 `0`；
- Coding Agent 源码中的 `greenfield` 文件名：`1 -> 0`；
- CLI 源码中的 `greenfield` 文件名：`11 -> 0`；
- 退役迁移文件：保持 `0/0`；
- 退役迁移符号引用：保持 `0/0`；
- Runtime Host entry ownership 与 Session Assembly protocol references：均保持 `0/0`。

迁移门禁实际输出为：

```text
retired files=0/0
retired references=0/0
Adapter greenfield files=0/0
CLI greenfield files=0/0
Composition greenfield files=0/0
Adapter->Composition edge files=0/0
Composition->public API edge files=0/0
Extension Host->Composition edge files=0/0
```

## 行为兼容性验证

- 质量门禁：9 个文件、133 项测试通过；
- Coding Agent 全量：137 个文件通过、1 个文件跳过，935 项通过、17 项跳过；
- CLI 全量：34 个文件、183 项测试通过；
- 根级 `bun run check:quick` 通过；
- 根级 `bun run check` 通过，覆盖 Root、CLI、Desktop、Admin 类型检查、Biome 和全部质量门禁；
- `bun run verify:agent-hosts` 通过：独立 `vetta.exe`、IM Gateway、Coding Agent、CLI、Desktop 全部通过；
- Desktop 功能套件：119 个文件、501 项通过，另 1 项跳过。

首次 `check:quick` 发现格式问题，以及 Legacy Format/Package Boundary 门禁仍依赖已删除的旧路径。迁移门禁路径、补充正式 Host allowlist 并格式化后通过。首次新增残留门禁测试的预期多计算了文件路径文本引用，修正为只统计源码内容中的真实引用后，全部质量测试通过。本轮没有发送外部真实模型请求。

## 尚未完成的替换

- `host/sdk-session` 内仍有大量 `GreenfieldSdk*`、`CodingAgentGreenfield*` 迁移身份和类型别名；需要逐层区分公开 SDK 合同、内部 Capability Port、Runtime Binding 与真实 Adapter；
- `public-api/bootstrap.ts` 仍暴露 `CodingAgentGreenfieldExtensionHostCapabilities` 和 `resolveCodingAgentGreenfieldExtensionCompatibility`，需与 SDK Host 一起审计，避免只做表面改名；
- 上游 `@vetta/runtime-core` 的 `GreenfieldRuntimeSession` 是跨包合同，不能在 Coding Agent 内单方面替换；应先确认其生产稳定身份和消费者范围；
- CLI 与 Coding Agent 的测试名称仍保留部分 Greenfield 字样，用于描述冻结的行为基线；后续只能在不丢失 Legacy/新实现差异证据的前提下整理。

下一阶段应集中收口 SDK Session Host 的生产身份：先建立公开 SDK 合同与内部 Port 的映射，再删除纯类型别名和迁移命名，最后用 SDK、CLI、Desktop 与 IM 宿主验收证明行为不变。不能批量字符串替换，也不能改变 `runtime-core` 的跨包合同。
