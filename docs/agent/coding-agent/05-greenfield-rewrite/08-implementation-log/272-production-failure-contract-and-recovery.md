# 第 272 阶段：生产失败合同与恢复边界

本阶段在单一生产 Runtime 已完成切换的基础上，收口 CLI、RPC、Desktop 和 IM 的失败传播与恢复语义。实施只改变架构边界和机器可读合同，不改变 Tool、MCP、Skill、Extension、会话、模型调用或用户数据行为，也不恢复 Legacy 执行和运行时回退。

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

单 Runtime 生产切换解决了“执行哪套架构”的问题，但生产稳定还要求所有宿主能依据稳定合同处理失败。若 RPC、Node Client、Go Host Client 和 Desktop 各自解析错误文案或自行猜测是否重试，迁移期的隐式分支会以另一种形式长期存在。

本阶段把边界统一为三个机器可读维度：

1. `errorCode` 表示稳定失败类别，用户可见 `error`/`message` 只负责说明。
2. `phase` 表示失败发生在 `startup`、`command`、`turn`、`transition` 或 `shutdown`。
3. `recoverability` 表示 `retry_safe`、`continue_session`、`restart_session`、`user_action` 或 `fatal`。

恢复合同明确禁止宿主在超时、进程退出或交付状态不确定时自动重放活动 Turn。宿主可以显式重启并恢复已持久化 Session，但是否再次提交输入必须由用户或上层产品流程决定。

## 实施内容

### Coding Agent RPC

- 新增独立 TypeBox 失败 schema、代码常量和运行时校验，失败响应统一携带三个合同字段。
- startup、命令分发、解析、Session 转换和 shutdown 失败均使用结构化元数据；不再把命令异常误报为无关联 parse 失败。
- Node `RpcClientError` 保留 wire metadata、command 和 cause；请求超时、事件超时、进程启动失败、进程退出和未启动调用均返回类型化失败。
- 子进程退出会立即拒绝待处理命令和事件等待，不再等待 30/60 秒计时器；同一个 Client 可显式重启，但不会重放原请求。
- RPC 文档补充失败字段、恢复值和禁止自动重放规则。

### CLI、Desktop 与 IM

- CLI 的 Session ownership、历史格式和 Extension 不兼容 startup frame 补齐相同元数据。
- Desktop Runtime 生命周期新增只读健康快照，记录最近一次启动或关闭失败；成功启动会清除旧失败。
- IM Go Host Client 新增 `TypedFailure`、`HostFailure` 和对应 code/phase/recoverability 类型，保留 RPC wire metadata，并把启动、I/O、超时、取消、进程退出和关闭失败类型化。
- Go 错误保留 `Unwrap` cause；超时与取消依据 `context` 身份判断，不解析错误字符串。

### 架构守卫

- 新增 `check-runtime-failure-contract.mjs`，扫描 26 个 Runtime/RPC/Host 生产边界文件。
- 守卫要求关键合同文件和恢复值持续存在，并禁止边界重新使用错误文案判断恢复、自动重放 Turn 或恢复 Desktop 旧 backend selector。
- 守卫自身包含接受与拒绝 fixture，并加入 `check:guards` 和 `test:quality`。

## 类型校验取舍

- RPC JSONL 是外部输入输出边界，使用 TypeBox 同时提供静态类型和运行时校验是必要的。
- Node 和 Desktop 进程内对象使用 TypeScript 显式联合类型，不重复增加 schema。
- Go Host Client 使用命名字符串类型和接口表达同一 wire 合同；未知远端 `errorCode` 仍可透传，避免宿主因新增服务端错误码失效。

## 旧实现依赖变化

- 旧 Session 生产执行边：`0`。
- Runtime 对 Coding Agent 具体实现的反向依赖：`0`。
- 旧 Runtime 选择标记和 Legacy fallback：`0`。
- 保留的旧格式边界：`14`，仍仅承担 reader、import、host history 和公开历史数据职责。
- 本阶段没有新增旧实现依赖、兼容执行分支或旧内部 API。

## 行为兼容性验证

- `bun run check:quick`：通过；新失败合同守卫扫描 26 个边界文件，违规数为 0。
- Coding Agent `bun run test`：135 个文件、930 项测试通过；1 个文件和 17 项既有测试跳过。
- CLI `bun run test`：34 个文件、183 项测试通过，覆盖真实 RPC/print/IM host、安装产物、Provider 失败恢复、会话迁移和资源释放。
- Desktop `bun run test`：119 个文件、499 项测试通过，1 项平台测试跳过。
- IM Gateway：host protocol、host client、command、router 和 `cmd/im-gateway` 测试通过。
- 质量守卫测试：8 个文件、112 项测试通过。
- Coding Agent、CLI、Desktop 定向类型检查通过；根 `bun run check` 的 lint、root/CLI/Desktop/Admin 类型检查和全部常驻守卫通过。

## 尚未完成的替换

- 生产执行和失败恢复合同已经稳定化，但 Desktop 健康快照目前停留在主进程边界；只有出现明确 UI/诊断需求时才应通过 IPC 暴露，不能为预留功能提前扩大公共接口。
- Go 与 TypeScript 跨语言合同分别定义，wire 兼容由边界测试和质量守卫约束；后续若引入协议代码生成，应先证明它能减少真实重复且不把宿主绑定到 Coding Agent 内部类型。
- 迁移期命名仍存在于部分测试名称中，它们是行为基线而非生产执行分支；不应以批量改名作为下一阶段目标。
