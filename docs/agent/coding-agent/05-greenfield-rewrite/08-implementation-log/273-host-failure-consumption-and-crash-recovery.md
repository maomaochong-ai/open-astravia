# 第 273 阶段：宿主失败消费与崩溃恢复

本阶段承接第 272 阶段的生产失败合同，不再增加迁移兼容层，而是确保 Node、Go、IM 和 Desktop 宿主真正依据机器可读合同处理失败。实施保持原有用户功能和协议，不改变 Tool、MCP、Skill、Extension、模型调用、会话内容或用户数据行为，也不恢复 Legacy 执行、运行时回退和活动 Turn 自动重放。

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

第 272 阶段已经统一失败字段，但“生产可用”还要求调用方消费这些字段。仅在 wire response 上携带 `recoverability` 不足以完成恢复：Node Client 不能把失败的无返回值命令当成成功；IM 不能继续复用要求重启的进程；Desktop 不能依赖英文错误文案识别锁冲突或会话忙碌。

本阶段因此闭合以下链路：

1. Runtime 产生稳定错误码。
2. RPC 和 Go Host Client 保留并转换失败元数据。
3. IM Router 依据 `restart_session` 淘汰失效进程，但不重放输入。
4. Desktop 仅依据结构化错误码映射产品错误。
5. 质量守卫禁止重新引入文案解析、旧执行入口和自动重放。

## 实施内容

### Node RPC 与 Go Host Client

- Node RPC Client 对所有 `success: false` 响应统一拒绝 Promise，包括没有业务返回值的 `prompt` 等命令，不再出现失败响应被当作成功完成的情况。
- Go `Session.Send` 在保留原始响应的同时返回 `TypedFailure`，完整保留 `errorCode`、`phase` 和 `recoverability`。
- Go startup handshake 对相关联的 wire failure 保留远端失败合同，不再覆盖为泛化启动错误。
- 进程退出失败根据当前状态选择 `turn` 或 `command` 阶段，不再一律误报为命令阶段。

### IM 进程失效与恢复

- `ProcessPool` 新增租约级 `Discard`，只在池中仍是同一 Session 实例时删除并关闭，避免旧租约误删后来创建的新实例。
- Event channel 在 `agent_end` 前关闭时，Bridge 返回 `process_exited/turn/restart_session`，而不是把不完整输出当成正常结束。
- deferred 模式在异常关闭且没有实际输出时不再发送空摘要；正常 `agent_end` 行为保持不变。
- Router 在 prompt、bridge 或 steer 收到 `restart_session` 后淘汰当前进程；下一条独立用户输入会创建新进程。
- 恢复过程明确不自动重放交付状态不确定的活动 Turn，避免重复调用模型、工具或外部副作用。

### Runtime 与 Desktop

- Runtime Core 新增 `SESSION_BUSY`、`SESSION_LOCKED` 稳定错误码和结构化类型守卫。
- Runtime Host 在提交新 prompt 前依据 Session 状态拒绝并发 Turn，返回 `SESSION_BUSY/turn/continue_session`。
- Coding Agent 的 Runtime Host Session backend 把存储 ownership conflict 转换为 `SESSION_LOCKED/startup/user_action`，不把存储实现类型泄漏给 Desktop。
- Desktop Conversation Service 只按稳定错误码映射已有 `SessionLockError` 和 `SessionBusyError`，删除基于 `error.name` 与错误文案的判断；用户可见行为保持一致。

### 架构守卫

- 扩展 `check-runtime-failure-contract.mjs`，要求 Node、Runtime、Desktop、Go Host Client、IM Pool 和 Router 的失败消费标记持续存在。
- 守卫禁止宿主根据 `message` 或 `error.name` 推断恢复策略，并继续禁止活动 Turn 自动重放。
- 守卫测试增加对应拒绝 fixture，确保检测规则本身可回归验证。

## 测试补充

- Node RPC：失败的 void command 必须拒绝并携带完整元数据。
- Go Host Client：失败响应转换、handshake 元数据保留和进程退出阶段判断。
- IM Pool/Router/Bridge：租约淘汰、异常 event close、deferred 空摘要抑制，以及崩溃后下一条输入创建新进程且首条输入只提交一次。
- Runtime Core：结构化错误守卫、并发 Turn 拒绝和 ownership conflict 映射。
- Desktop：即使错误文案变化，锁冲突和会话忙碌仍按稳定错误码映射。
- Marketplace 背景更新测试改为等待最终回调后再检查状态文件，消除全量并发下等待中间产物造成的测试抢跑；生产实现未修改。

## 旧实现依赖变化

- 旧 Session 生产执行边：`0`。
- Runtime 对 Coding Agent 具体实现的反向依赖：`0`。
- 旧 Runtime 选择标记和 Legacy fallback：`0`。
- 保留的旧格式边界：`14`，仍仅承担 reader、import、host history 和公开历史数据职责。
- 本阶段没有新增旧实现依赖、兼容执行分支、旧内部 API 或自动回退。

## 行为兼容性验证

- `bun run check:quick`：通过；失败合同守卫扫描 34 个边界文件，违规数为 0。
- Coding Agent 全量测试：136 个文件通过、1 个文件跳过；933 项测试通过、17 项跳过。
- Runtime Core 全量测试：29 个文件、139 项测试通过。
- Desktop 全量测试：119 个文件通过；501 项测试通过、1 项平台测试跳过。
- IM Gateway `go test ./...`：全部包通过。
- 失败合同质量守卫测试：3 项通过。
- 根 `bun run check`：Biome、root/CLI/Desktop/Admin 类型检查和全部常驻守卫通过。

## 尚未完成的替换

- 失败分类目前已经跨宿主一致，但仍缺少同一维度的生产可观测基线；下一阶段应复用现有日志与诊断边界验证，不能为此增加新的业务协议。
- 取消、关闭和进程重启后的资源释放已有局部测试，尚需对 CLI、Desktop 和 IM 做端到端生命周期审计，重点检查进程、订阅、计时器和文件句柄。
- 这些剩余项属于生产稳定性验证，不构成保留 Legacy 执行、迁移兼容分支或自动重放的理由。

## 阶段结论

失败合同已经从“协议上存在”推进为“宿主实际消费”。进程崩溃、Session 锁冲突和并发 Turn 不再依赖文案猜测；需要重启的 IM Session 会被明确淘汰，同时保留不自动重放的安全边界。新架构的生产稳定性因此不再依赖迁移期的隐式兼容行为。

下一阶段应集中验证生产可观测性与资源生命周期：为 CLI、Desktop 和 IM 建立同一失败分类的可观测基线，检查取消、关闭、重启后的进程、订阅和文件句柄释放，但不为了观测新增公共业务接口或恢复 Legacy 管理器。
