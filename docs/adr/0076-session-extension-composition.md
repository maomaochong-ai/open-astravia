# Session Extension 统一会话级产品能力组合

## 背景

`AgentFeature` 负责把 Tool、Instruction、Observer 等内容编译进不可变的 Turn Runtime Snapshot，生命周期围绕能力 generation。Todo、Memory、知识库和 IM 等产品能力还可能拥有 Session 状态、Conversation Document 持久化、自然停止续跑、宿主命令和观察信号，不能完整表达为 `AgentFeature`。

此前 Todo 在 Session Composition Root 中分别创建 Runtime、订阅 UI 观察、注册 Tool Feature、加入 Document participant、加入 Continuation orchestrator、暴露 Host Controller，并由独立资源集合清理。增加第二个同类能力会复制同一套接线和回滚逻辑，使产品能力继续深度绑定中心组装函数。

## 决策

在 `@vetta/runtime-core/session-extensions` 定义平台与产品无关的 Session Extension 合同：

- `SessionExtensionDefinition` 声明稳定 ID、依赖、冲突和实例工厂；Composition 按依赖拓扑确定性初始化。
- `SessionExtensionInstance` 是 Session 级资源所有者，通过判别联合贡献 Agent Feature、Conversation Document participant、Continuation source、typed service 和 typed endpoint。
- typed signal 只表达已发生的观察事实；单个监听器失败不得改变扩展状态或阻断其他监听器。
- service 只允许本扩展或显式依赖方读取；service、endpoint、continuation source 和扩展 ID 冲突均 fail closed。
- 初始化失败严格逆序回滚；初始化错误与回滚错误同时保留。正常关闭全量尝试释放，成功项不再执行，失败项允许后续关闭重试。
- Composition 只提供进程内强类型合同。RPC、IPC、Plugin、磁盘和网络输入仍必须在各自首次进入领域边界时做运行时 Schema 校验。

具体产品能力仍由产品域拥有。`runtime-core` 不包含 Todo、Memory、知识库、IM 或 Coding Agent 类型，也不负责发现、下载和授权第三方 Plugin。Plugin 是分发边界，Session Extension 是产品组合的内部生命周期边界，两者不等同。

## Todo 首个迁移切片

Todo 由 `coding-agent/work-state` 提供 `coding-agent.todo` Session Extension，并统一拥有：

- Session-local Todo Runtime 与初始状态；
- Todo Tool Feature；
- Conversation Document participant；
- 锁定 Todo 的 continuation source；
- read/clear typed endpoint、runtime service 与 changed signal；
- `todo_update` 兼容观察投影；
- 初始化回滚、正常释放和 Composition 关闭兜底。

Todo Runtime 的默认 ID 生成改用平台中立的 Web Crypto，默认实现不再直接导入 `node:crypto`。Todo Tool 当前仍复用 `runtime-node` 的既有实现，这是现有 Coding Agent Node 产品组合的已知边界；本决策不在同一阶段迁移全部 Tool 实现。

Coding Agent Composition Options 通过 `createSessionExtensionDefinitions(sessionOptions)` 接受其他可信产品能力定义。该工厂在每个 Session 初始化事务内执行，返回的定义与内置 Todo 一起完成依赖排序、初始化、回滚和释放。它是程序化 Composition Root 注入点，不直接加载 Plugin 或外部配置。

现有 `RuntimeResources.todoController`、`RuntimeHost.clearTodos()` 和 `todo_update` 保留，以维持 Desktop、CLI 与 SDK 的公开行为。它们现在投影同一个 Extension-owned Runtime，不创建第二份状态或生命周期。待宿主控制面迁移到通用 Session Extension endpoint 后，应删除这些 Todo 专属 Runtime Core 合同；删除前必须同步迁移全部消费者和合同测试。

## 被拒绝方案

### 扩大 AgentFeature

给 `AgentFeature` 追加存储、宿主命令、信号和 Session 状态会混淆 Turn generation 与 Session 资源生命周期，也违反 Feature 不持有可变 Session 内部对象的约束。

### 把产品能力放进 runtime-core

这样虽然能跨 Desktop/CLI 复用，却会让通用 Kernel 认识 Todo、IM 和知识库业务语义，未来平台只能继承整套产品，而不能选择组合。

### 仅在 Composition Root 增加 Factory

Factory 能隐藏构造代码，但不能统一贡献发现、依赖校验、冲突检测、失败回滚和释放所有权；中心组装函数仍需逐项知道每个产品能力。

## 后果

- 新的 Session 级产品能力可以围绕自己的领域状态实现一个 Extension Definition，中心组装只收集定义。
- Agent Feature 继续专注 Turn Snapshot，Session Extension 专注 Session 生命周期和跨能力贡献，两层职责可分别测试。
- Todo 当前仍有宿主兼容投影，runtime-core 的产品专属合同尚未全部移除；这是后续迁移目标，不代表最终边界。
- 动态安装、热替换、权限清单和第三方 Extension ABI 尚未定义；出现真实第二实现和安全需求后再扩展合同，不在当前接口中预留万能 metadata。
