# @vetta/coding-agent

Vetta Coding Agent 的产品组合层与会话宿主。

本包把模型、会话、工具、知识库、MCP、Skill、扩展和宿主能力组合成可执行的 Agent，
但不拥有这些通用能力的底层实现。CLI、Desktop 和 IM 通过公开入口使用同一套组合与会话语义。

## 架构定位

```text
CLI / Desktop / IM
        |
        v
@vetta/coding-agent       产品组合、会话宿主、资源与扩展编排
        |
        +--> @vetta/runtime-core       Kernel、Turn、事件与 Port
        +--> @vetta/runtime-tools      通用工具实现与动态工具目录
        +--> @vetta/runtime-storage    Conversation 持久化
        +--> @vetta/runtime-mcp        MCP Runtime 能力
        +--> @vetta/runtime-knowledge  知识库能力
        +--> @vetta/runtime-subagents  子 Agent 能力
        +--> @vetta/runtime-telemetry  观测能力
        +--> @vetta/ai                 模型与 Provider 协议
```

依赖方向是单向的：应用可以依赖 `coding-agent`，`coding-agent` 可以依赖 Runtime 包；
Runtime 包的生产代码、测试、配置和包清单均不得反向依赖 `coding-agent`。

## 本包拥有

- 产品级 Runtime Composition Root
- 会话创建、恢复、切换、提交、回滚和释放的宿主编排
- Runtime 事件到 CLI、Desktop、IM 可观察事件的产品适配
- 模型、工具、MCP、Skill、知识库、扩展和提示词的能力装配
- 产品配置、资源发现、扩展加载和宿主服务适配
- SDK、RPC、CLI 控制和历史会话等稳定产品入口

## 本包不拥有

- 模型 Provider 的协议与流式响应实现，属于 `@vetta/ai`
- Agent Kernel、Turn 和通用 Port，属于 `@vetta/runtime-core`
- `read`、`write`、`edit`、`bash` 等工具实现，属于 `@vetta/runtime-tools`
- Conversation Repository，属于 `@vetta/runtime-storage`
- MCP 协议、传输和通用生命周期，属于 `@vetta/runtime-mcp`
- Desktop UI、CLI 进程入口或 IM 传输协议，分别属于对应应用包

宿主相关代码只实现 Runtime 声明的 Port，例如文件系统、进程、凭证、交互和下载能力；
不得在本包复制 Runtime 域实现。

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

- `@vetta/coding-agent/composition`：应用 Composition Root
- `@vetta/coding-agent/runtime`：Runtime 产品入口
- `@vetta/coding-agent/sdk`：嵌入式会话 API
- `@vetta/coding-agent/rpc`：RPC 协议与宿主
- `@vetta/coding-agent/extensions`：扩展合同
- `@vetta/coding-agent/host`：Runtime Port 的产品宿主适配
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
