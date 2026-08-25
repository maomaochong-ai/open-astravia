# @vetta/coding-agent

Vetta Coding Agent 的能力、策略与稳定 API 语义层。

本包定义 Coding Agent 的 Profile、Prompt、Mode、Todo、Memory、Knowledge、Skill、Plugin、Extension、
IM、Compaction 与工具策略。平台 Runtime 负责选择环境实现并完成最终装配。

包内的 `execution/` 按 Turn、Session、后台工作与 Sandbox 组织产品执行策略，`rpc/` 独立拥有平台无关的
协议和客户端，`theme/` 独立拥有 Theme 合同、解析和投影。`host/` 只保留迁移中的宿主接线，不再作为产品
执行逻辑的默认归档位置。

## 架构定位

```text
CLI / Desktop / IM
        |
        v
@vetta/coding-agent       Coding Agent Feature、策略与 API 语义
        |
        +--> @vetta/runtime-core       Kernel、Turn、事件与 Port
        +--> @vetta/runtime-tools      工具协议与动态工具目录
        +--> @vetta/runtime-storage    Conversation 持久化协议
        +--> @vetta/runtime-mcp        MCP 协议、Port 与状态协调
        +--> @vetta/runtime-knowledge  知识库能力
        +--> @vetta/runtime-subagents  子 Agent 能力
        +--> @vetta/runtime-telemetry  观测能力
        +--> @vetta/ai                 模型与 Provider 协议
```

依赖方向按职责分层：应用和平台 Runtime 组合 `coding-agent` 与具体环境实现。`coding-agent` 依赖
Runtime Kernel 和协议，不应选择 `runtime-node` 默认实现；`runtime-core`、协议包和 `runtime-node`
不得反向依赖 `coding-agent`。

`adapters/` 只保留合同防腐映射，产品域通过窄 Port 使用环境能力。`host/` 中的 Node 实现仅保留两类明确边界：
公开 SDK 的零配置兼容根，以及供应用复用的 Host 适配器；它们不属于产品策略，也不能被新的产品能力依赖。
CLI、Desktop 和 Runtime Node 的最终组合根负责选择 MCP Supervisor、文件、进程、资源和配置实现。

## 本包拥有

- 默认 Profile、Prompt、Mode 与 Feature 集合
- Todo、Memory、Knowledge、Skill、Plugin、Extension、IM 和 Compaction 规则
- 工具激活、模型可见顺序、副作用、结果投影和上下文策略
- Runtime 事件到 Coding Agent API 的语义映射
- Coding Agent 历史格式的显式读取和迁移边界
- 不绑定平台实现的稳定 API 合同

## 本包不拥有

- 模型 Provider 的协议与流式响应实现，属于 `@vetta/ai`
- Agent Kernel、Turn 和通用 Port，属于 `@vetta/runtime-core`
- 工具注册、Catalog、激活与绑定协议属于 `@vetta/runtime-tools`
- `read`、`write`、`edit`、`bash` 等 Node 工具实现属于 `@vetta/runtime-node`
- Conversation Repository 协议属于 `@vetta/runtime-storage`，Node 文件/内存实现属于 `@vetta/runtime-node`
- MCP 协议、Port 和通用生命周期状态机属于 `@vetta/runtime-mcp`；Node transport、文件与 OAuth 实现属于 `@vetta/runtime-node`
- Desktop UI、CLI 进程入口或 IM 传输协议，分别属于对应应用包
- 最终平台 Composition Root 与 Node 文件、进程、网络、锁和动态模块加载实现

平台能力必须通过 Runtime Port 注入。可移植产品域不得重新引入文件系统、进程、凭证、下载器或平台生命周期实现；
兼容 Host 的 Node 默认值只允许位于显式命名的 Host 文件，并由架构守卫保护。

工具与 MCP 的大结果投影也遵循同一边界：本包定义 Coding Agent 的截断策略，平台宿主通过
`codingToolResultPolicy` / `McpToolResultPolicy` 选择 Artifact Store。未注入时保留完整结果，不隐式写入本地文件。

Knowledge 同样按定义与实现分离：`features/knowledge` 拥有 Tool 名称、Schema、模型描述、激活元数据和结果投影；
`runtime-knowledge` 拥有知识文件、索引、查询和写入规则；最终宿主通过 `knowledgeRuntime` 注入具体实现。
未注入时该能力不可用，Composition 不读取默认目录或环境开关。

Memory 的文档规则、Tool、Prompt 快照、Journal 格式与 Rollover 策略由本包拥有，持久化只依赖
`MemoryTextStorage`。Node 宿主使用 `NodeTextFileStorage` 选择 `MEMORY.md` 与 `JOURNAL.md`；启用
Memory 但未提供 `createMemoryRolloverRuntime` 时，Session 初始化会明确失败，不存在隐式文件回退。

## 观测边界

每个 `createCodingAgentRuntimeComposition()` 都创建并拥有一个 `RuntimeObservationHub`。没有上层时它可以只接本地
Adapter 独立观测；Desktop、CLI 或 SDK 可通过 `observationHub.parent` 注入应用级 Hub，让 Tool、MCP、Session 初始化与
安全 Session 摘要原样向上汇聚。兼容的 `observationPublisher` 会通过无损 Publisher-to-Port Adapter 成为上游，不能与
`observationHub.parent` 同时提供。

创建时可用 `observationHub.routes` 注册必须捕获初始化阶段事件的本地 Adapter；创建完成后通过返回对象的
`composition.observations.attach()` 动态注册或撤销 Adapter，并用 `snapshot()` 读取局部交付健康度。该控制面不暴露
`close()`：Hub 由 Composition 在其它产品资源之后关闭，父级 Port 和 Adapter 外部资源仍由各自创建者释放。子代理
Composition 的 Hub 以当前 Coding Agent Hub 为父级，本地路由不会重复注册到每个子代理。

Observation 只承载领域所有者定义的安全事件。普通工程日志继续使用 Logger，安全审计使用独立 Audit Sink，原生 Trace
Span 继续由 Tracer 管理；宿主可以选择把安全 Observation 通过 Adapter 投影成结构化日志，但不要对同一领域事实再手工
记录第二条日志。

## 执行模型

一次模型 Turn 的稳定主干是：

```text
Host request
  -> session host
  -> runtime composition
  -> Turn preparation
  -> model call contribution resolution
  -> model stream / tool loop
  -> event projection
  -> conversation commit
```

执行主干是分阶段组合的 Pipeline，但每个阶段通过显式合同和 Port 协作，不依赖可变的全局中间状态。
工具、提示词、Skill、Plugin、MCP 与模型策略等动态能力在 Turn admission 绑定同一个不可变 generation；
同一 Turn 的后续模型调用只观察该 Turn 自己产生的消息、工具结果与局部激活状态，不重新读取外部最新目录。
运行时注册或移除能力不会要求重建整个 Session，也不会改变已经开始的 Turn；新状态从下一 Turn 生效。

## 公开入口

包根仅保留稳定 Extension API。其他能力使用显式子路径：

- `@vetta/coding-agent/composition`：Coding Agent Feature、策略组合与
  `createCodingAgentRuntimeDefinition()`；平台实现由宿主注入。Definition Adapter 在产品层把 Prompt Profile
  消解为普通 Instruction，Tool、MCP、模型和 Session Extension 由完整 Session assembler 提供，Runtime
  Registry 不接收 Profile 字段
- `@vetta/coding-agent/model-context`：工作区事实等产品上下文规则；文件访问由宿主注入
- `@vetta/coding-agent/bootstrap`：平台无关的启动编排；Settings、Auth、Model 与 Resource 实现由宿主注入
- `@vetta/coding-agent/runtime`：Runtime 产品入口
- `@vetta/coding-agent/sdk`：嵌入式会话 API
- `@vetta/coding-agent/rpc`：平台无关的 RPC Frame、命令分发、桥接和会话能力合同；传输、进程退出与请求 ID
  由宿主注入。CLI 的 Node JSONL 适配位于 `@vetta/cli-host`，不属于协议核心
- `@vetta/coding-agent/extensions`：扩展合同
- `@vetta/coding-agent/host`：Node Tool Host 兼容入口，不得作为新产品能力依赖
- `@vetta/coding-agent/resources`：Skill、提示词等资源入口
- `@vetta/coding-agent/settings`：设置入口
- `@vetta/coding-agent/historical-sessions`：历史会话读取

应用不得深度导入 `src/` 或未导出的内部文件。新增公开入口前，应先确认它是跨包稳定合同，
而不是某个组合实现的便利函数。

`@vetta/coding-agent/config` 保留为历史 Node 配置门面。产品常量位于无副作用的内部 `identity.ts`，
Node 包目录探测、环境目录解析和 manifest 读取位于 `host/node-config.ts`；产品域不得直接导入配置门面。

## 功能兼容原则

本次重写是架构重写，不是功能重写：

- 旧架构的行为通过新 Kernel、Runtime 域实现和产品适配保留
- 旧实现只可作为迁移期行为基线，不得重新进入生产执行路径
- 不以兼容转发器、双执行路径或回退到旧会话对象掩盖缺失实现
- 工具 Schema、描述、输出、错误、副作用和路径语义必须由合同测试保护
- CLI、Desktop 和 IM 必须通过同一新架构完成真实会话流程

重写目标与不可变约束见
[docs/agent/coding-agent/05-greenfield-rewrite/08-implementation-log/REWRITE-CHARTER.md](../../docs/agent/coding-agent/05-greenfield-rewrite/08-implementation-log/REWRITE-CHARTER.md)。

## 开发验证

从仓库根目录运行：

```bash
bun run check:quick
bun run test:pkg coding-agent
bun run check
```

跨宿主会话验证使用仓库提供的 Agent Host 验证脚本。不要通过新增旧执行入口来修复宿主差异。

## License

MIT
