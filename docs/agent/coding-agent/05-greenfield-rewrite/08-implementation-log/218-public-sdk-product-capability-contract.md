# 第 218 阶段：公共 SDK 产品能力窄合同

## 阶段目标

本阶段处理第 217 阶段保留的产品能力和 Legacy 具体对象泄漏问题，但不切换包根公开
`createAgentSession`：

1. 用只读 View 和异步 Command 承接仍有公共价值的产品行为；
2. 不向 Greenfield SDK 暴露 `SessionManager`、`ResourceLoader`、`ModelRegistry`、Extension Runner 等具体对象；
3. 将只属于 Turn 或 Extension 流程的步骤明确内部化；
4. 保留模型、提示词、Skill、MCP、后台任务和 Extension 在运行时变化的语义；
5. 让兼容清单对每个未按旧形态接线的成员都有显式退出决策。

## 架构决策

### 产品能力使用窄合同

Greenfield SDK 新增以下只读 View：

- 可用模型列表、当前系统提示词和 Prompt 模板；
- 后台任务、Todo 和 Memory 配置；
- Extension 事件处理器存在性。

新增以下 Command：

- Agent Plugin 重配置；
- 后台任务终止与终态清理、Todo 清理；
- Memory flush、MCP reload、资源 reload；
- Bash 结果记录与 HTML 导出。

所有集合结果均返回脱离内部存储的数组或对象副本。调用方可以观察和触发行为，但不能获得产品管理器的所有权。

### 动态资源按调用时解析

模型、Prompt 模板、系统提示词、Extension Runner 和工具目录不进入 Session 长期快照：

- 模型每次从 `ModelRegistry` 读取；
- Prompt 模板每次从 `ResourceLoader` 读取；
- 系统提示词从当前 Extension Event Host 读取；
- Extension handler 和 HTML 自定义工具渲染使用当前 Runner；
- MCP reload 通过 Composition 中的 Session MCP Coordinator 执行。

因此，局部资源变化不要求重建整个 SDK Session，也不会把已经删除的 Skill 或已经移除的工具永久固定在旧快照中。

### reload 保持事务边界

资源 reload 继续复用 Greenfield Resource Reload Host。SDK Extension Transition Adapter 增加同 Session 的替换事务：

1. 通知旧 Runner `session_shutdown`；
2. 执行资源 reload；
3. 使用最新资源创建并初始化新 Event Host；
4. 重新发现资源并替换 Runtime binding；
5. 成功后释放旧 Host；失败时恢复旧 binding 和 `session_start`。

SDK close 的 disposer 按 Session ID 解析当前 Host，避免 reload 后仍释放旧 Host 而遗漏新 Host。

### HTML 导出不依赖 Legacy SessionManager

Greenfield 导出直接读取 `ConversationDocument`、当前系统提示词和 Runtime 工具目录，并复用现有 HTML 模板与自定义
工具渲染器。内存 Session 仍明确拒绝文件导出；文件 Session 不再为导出临时构造 Legacy `SessionManager`。

### 旧成员退出决策

兼容清单把剩余未按原形接线的成员分成两类：

- `narrow-replacement`：功能由新的 View/Command 承接，旧具体对象不再公开；
- `internalized`：`prepareSystemPromptForAgentRun`、`preCallCompaction`、`bindExtensions` 等步骤已经属于
  Turn/Extension 流水线，不允许宿主绕过编排手工调用。

类型约束要求所有 `not-wired` 成员必须出现在决策表中。后续新增旧形态缺口而未分类会直接产生类型错误或测试失败。

### TypeBox/Zod 决策

本阶段新增的是进程内 TypeScript Port、只读投影和命令调用，没有新增外部 JSON、配置文件或协议载荷，因此没有
引入 TypeBox 或 Zod。现有 SDK 自定义工具输入 Schema 仍在不可信输入边界使用 TypeBox 校验。

## 实施记录

### SDK 合同与适配器

- 扩展固定 Session 能力 Port 和 SDK 门面，加入产品能力 View/Command；
- 活动 Session 合同补齐异步 `recordBashResult`；
- 所有会改变状态的操作在已关闭 Session 上继续拒绝执行；
- 固定 Session Adapter 仍不负责身份迁移和资源生命周期。

### Composition 与产品宿主

- Session Controls 增加按 Session ID 执行的 MCP reload；
- 后台工作 Port 分离“清理后台命令”和“清理子代理”，避免窄命令误删另一类状态；
- 产品 Composition Root 注入模型、提示词、Plugin、Memory、reload、导出和 Extension 查询实现；
- Bash Adapter 通过 Runtime Context Delivery 持久化既有 BashExecution 消息格式。

### Legacy 兼容状态

下列旧成员的等价行为已经接线：

- `reconfigureAgentPlugins`、`flushMemory`、`reloadMcp`、`reload`；
- `recordBashResult`、`exportToHtml`、`hasExtensionHandlers`。

旧的管理器和可变对象属性仍不暴露；它们由窄能力替代，不会为了表面签名一致重新引入 Legacy 对象图。

## 测试与验证

新增或扩展的测试覆盖：

- 产品能力通过真实 SDK Host 工作；
- 模型、提示词、模板、后台任务、Todo 和 Memory 的读取；
- Plugin 重配置、Memory flush、MCP/资源 reload、Bash 记录和 HTML 导出；
- Greenfield SDK 上不存在 Legacy 具体对象属性；
- 所有未接线旧成员都有明确 rewrite decision；
- MCP reload 从 Session Controls 委托到 Composition；
- SDK 固定门面、活动门面和真实 Composition 集成保持兼容。

验证结果：

- 定向测试：6 个文件、41 项测试通过；
- `bun run check:quick`：通过；
- 根级 `bun run check`：通过；
- 补充执行 coding-agent 全包测试时仍出现仓库既有的 Windows 路径、Shell 引号和时序类失败；本阶段涉及的 SDK、
  Runtime Controls 与集成测试均单独通过，未将这些环境基线问题混入本阶段修改。

## 刻意保留的边界

- 包根公开 `createAgentSession` 仍返回旧 `AgentSession`；旧同步 API 与 Greenfield 异步持久化合同尚未强行混合；
- 本阶段不删除 Legacy 实现，也不改变 CLI/Desktop 的默认创建路径；
- Settings、模型注册、资源加载、MCP 和 Extension 的具体实现只存在于产品 Composition Root；
- 之前的方案文档不更新，本文件只记录本阶段实际实施过程。

## 阶段结论

Greenfield SDK 已经覆盖剩余有公共价值的产品行为，同时把 Legacy 具体对象和流程内部步骤挡在合同之外。下一阶段应
以真实消费者迁移和公共工厂切换条件为主，不再继续扩张 SDK 大对象表面。
