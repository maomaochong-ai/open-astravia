# @vetta/coding-agent

Vetta Coding Agent 的能力、策略与稳定 API 语义层。

本包定义 Coding Agent 的 Profile、Prompt、Mode、Todo、Memory、Knowledge、Skill、Plugin、Extension、
IM、Compaction 与工具策略。平台 Runtime 负责选择环境实现并完成最终装配。

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

迁移期间，`host`、`adapters`、SDK 兼容入口和部分资源加载仍包含 Node 接线。它们是待迁移清单，
不是新的职责边界；新增能力不得继续依赖这些隐式默认值。

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

平台能力必须通过 Runtime Port 注入。现有宿主实现迁出后，本包不得重新引入文件系统、进程、凭证、
下载器或平台生命周期实现。

工具与 MCP 的大结果投影也遵循同一边界：本包定义 Coding Agent 的截断策略，平台宿主通过
`codingToolResultPolicy` / `McpToolResultPolicy` 选择 Artifact Store。未注入时保留完整结果，不隐式写入本地文件。

Knowledge 同样按定义与实现分离：`features/knowledge` 拥有 Tool 名称、Schema、模型描述、激活元数据和结果投影；
`runtime-knowledge` 拥有知识文件、索引、查询和写入规则；最终宿主通过 `knowledgeRuntime` 注入具体实现。
未注入时该能力不可用，Composition 不读取默认目录或环境开关。

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

- `@vetta/coding-agent/composition`：Coding Agent Feature 与策略组合合同；平台实现由宿主注入
- `@vetta/coding-agent/bootstrap`：平台无关的启动编排；Settings、Auth、Model 与 Resource 实现由宿主注入
- `@vetta/coding-agent/runtime`：Runtime 产品入口
- `@vetta/coding-agent/sdk`：嵌入式会话 API
- `@vetta/coding-agent/rpc`：迁移中的 RPC 兼容入口，目标所有者为 CLI Host
- `@vetta/coding-agent/extensions`：扩展合同
- `@vetta/coding-agent/host`：迁移中的 Node Host 兼容入口，不得作为新功能依赖
- `@vetta/coding-agent/configuration`：配置合同
- `@vetta/coding-agent/resources`：Skill、提示词等资源入口
- `@vetta/coding-agent/settings`：设置入口
- `@vetta/coding-agent/historical-sessions`：历史会话读取

应用不得深度导入 `src/` 或未导出的内部文件。新增公开入口前，应先确认它是跨包稳定合同，
而不是某个组合实现的便利函数。

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
