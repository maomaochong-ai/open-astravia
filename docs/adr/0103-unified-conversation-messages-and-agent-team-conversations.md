# ADR-0103：统一 Conversation 消息与 Agent Team 会话

## 状态

已接受

## 背景

普通对话和 Agent Team 当前分别维护 `ChatMessage` 与 `TeamFeedEvent`/`TeamTimelineItemViewModel`。其中
`user-message` 和 `member-result` 并不是新的消息语义，只是普通用户消息与带 Agent 作者身份的普通 Agent
消息。两套合同造成消息展示、附件、流式归约、复制与导航逻辑重复，也让消息列表不得不理解业务场景。

Team 的运行模型还需要同时满足以下约束：

- 用户通常只与负责人对话，负责人按需调度一个或多个持久团队成员；
- 每个成员拥有独立执行会话，只能直接读取自己的工具、thinking 与恢复历史；
- 系统自动让被调度成员获得团队中其他 Agent 已发布的公开发言，而不复制完整执行过程；
- Team 是产品编排关系，不应产生与普通 Agent 会话不同的底层目录和持久化协议；
- subagent 是某个 Agent 的临时私有子执行者，不是 Team 成员；
- Team 生命周期、路由、上下文、工作项、重试与工具执行需要提供可扩展的观测发布方式，但当前不需要具体 Observer。

ADR-0099 将 Team Session 与普通会话存储隔离，ADR-0101 要求 Chat 与 Team 保留独立领域消息合同。这些
约束与上述目标冲突，需要由本决策替代。

## 决策

1. 在 `@vetta/runtime-core/conversation` 定义并公开导出
   `ConversationUserAuthorReference`、`ConversationAgentAuthorReference`、`ConversationAuthorReference`，以及
   User/Agent 严格判别的 `ConversationMessageRecord`。Provider `Message` 不加入 Team 或 UI 字段。
2. 用户与 Agent 消息保留角色专属结构。附件只属于用户消息；Agent 消息持有 assistant 内容、usage、stop 与错误
   语义。角色特有字段不通过全量可选字段合并。
3. Agent Team 公共群聊是一个普通协调 Conversation；负责人和每个成员各自拥有一个普通执行 Conversation。
   它们全部使用现有 Conversation 创建、catalog、repository、snapshot、compaction 与恢复路径，不新增
   `agent-team` 会话目录、共享 journal 或 Team 专用消息文件格式。
4. Team 只在产品层维护 Conversation binding、路由、工作项、交付、上下文 generation/checkpoint 与恢复状态。
   公共用户/Agent 内容使用标准 message entry，Team 编排事实使用标准 custom/context entry；Runtime Core
   不解释 Team custom type。
5. 成员只能直接读取自己的执行 Conversation。系统在 Turn admission 固定一个不可变的共享 generation，将协调
   Conversation 中所有允许共享的用户消息、Agent 公开发言和必要编排状态投影给目标成员。面向本机用户的 Team
   transcript 可以保留 Agent 公开发言关联的 `toolCall` block，并由 Desktop Main 的
   `TeamSessionDisplayService` 只读投影补齐
   原始 `toolResult` 与 timing，以复用普通 Conversation 的工具卡片；Context Policy
   在模型可见投影时仍只提取公开文本与允许的产物引用，不向其他成员提供 thinking、工具输入输出、未发布草稿或
   subagent transcript。Renderer Snapshot 同样不得包含 thinking。
6. 公共历史只由 Coordinator 压缩一次并生成不可变 checkpoint；成员私有 compaction 只压缩自身执行历史并引用
   checkpoint。模型调用上下文按“公共稳定前缀、成员私有历史、当前工作”组装。同一 Team generation 的公共
   system/message prefix 必须确定性一致；成员身份、成员特有工具和当前任务位于缓存边界之后。
7. 委派使用持久 `TeamWorkItem` 和 `TeamMemberTurnAttempt`。没有末尾 Agent 消息不是失败的充分条件；系统依据
   稳定错误分类选择等待、同会话继续、退避重试、等待充值/认证等外部条件、取消或确定失败。
8. 跨多个普通 Conversation 的结果发布不声明伪原子事务。Coordinator 使用稳定 publication operation 与幂等步骤
   追加公共结果和工作项终态，崩溃恢复时补齐未收敛步骤。
9. Message Feed 只提供泛型列表、虚拟化、滚动、布局和 Primitive。Chat 与 Team 在 Connector/Recipe 层把各自数据
   投影为统一 User/Agent View Model，并通过显式 JSX 组合动作；不建立枚举所有能力的可选 action model。
   UI 直接复用已有 `Message`、`MessageLayout`、`MessageVisual` 与独立行为叶子；不引入仅转发 children 的
   `ConversationMessage.Header/Body/ActionBar`，也不将未被实际消费的消息模型放进空 Provider 来代替数据迁移。
10. Team 复用现有 Runtime Observation Hub/Publisher 和 `RuntimeExecutionObservationEvent`，增加类型化 Team
    生命周期 token、稳定 correlation 与数据分类。成员执行流同时由 `TeamSessionEventHub` 适配为
    `DesktopTeamToolExecutionEvent`，只发给当前本机 Team Conversation 的 renderer 消息投影，用于复用普通会话的
    ToolCallBlock；该事件是渲染期、非持久化数据，不进入 Observation Hub 的安全摘要，也不进入任何成员的模型上下文。
    生产范围不新增独立的 Team UI/IPC 数据源、recorder、metrics、日志或远程 Adapter；测试可使用内存 Observer
    验证观察事件完整性与失败隔离，并用消息流合同测试验证工具卡片状态归约。
11. 安全 Observation 只包含身份、状态、数量、耗时和稳定错误码。渲染期的本机工具卡片可以沿用普通会话的已授权
    工具输入输出展示合同；这些数据不写入 Team 公共消息、不进入跨成员共享上下文。隐藏推理链仍不发布。
12. subagent 永远不进入 Team roster、不能成为 Team 消息作者、不能直接拥有或完成 Team work item。默认 Team
    policy 禁用 subagent；显式允许时也只能作为成员的私有辅助，由父成员对外发布结果。

### Desktop 实现所有权

`AgentTeamSessionService` 是 Team 会话的应用层入口，只负责会话生命周期、请求准入、成员调度、恢复以及各领域服务的
装配。下列职责必须保持单一所有者，不得重新并入主服务或在 Renderer 建立平行路径：

| 所有者 | 职责 |
| --- | --- |
| `TeamSessionStateRepository` | 唯一拥有已加载 Session、协调路径、按 Session 串行事务和状态持久化 |
| `TeamSessionDisplayService` | 从协调 Conversation 生成公开 Snapshot，并从成员 Conversation 只读补齐工具展示证据 |
| `TeamSessionEventHub` | 唯一拥有 Renderer subscriber、成员 Runtime subscription 和 active turn，并关联流式工具事件 |
| `TeamRuntimeManager` | 创建、恢复和重配置协调/成员 Runtime Session，应用成员工具策略并管理资源绑定 |
| `TeamSharedContextService` | 将协调历史投影、压缩、分页、交付，并持久化 receipt 与 checkpoint |
| `TeamPublicationWorkflow` | 以同一幂等状态机处理正常结果发布和崩溃恢复 |
| `TeamTurnCoordinator` | 拥有请求准入、成员调度、取消、重试/恢复与 Attempt settlement |
| `TeamMemberAttemptRunner` | 执行单个已调度 Attempt，按固定顺序调用上下文、Runtime、publication 和 settlement |

协调 Conversation 是 Team 公开时间线中用户消息和 Agent 公开结果的唯一事实源。成员 Conversation 是私有执行历史；
它可以为已发布 Agent 结果提供工具卡片证据，但其中的用户 prompt 不得再次投影为 Team 公开用户消息。Renderer 只能消费
Main 提供的公开 Snapshot 和实时事件，不能自行把协调历史与成员历史拼接成第二套消息事实源。

## 迁移

- 旧 `TeamFeedEvent.user-message/member-result` 确定性导入协调 Conversation 的普通 User/Agent message；
  delegation 导入 Team custom entry，并保留稳定请求、来源 Turn 和作者身份。
- 旧成员 Session 注册或导入普通 Conversation catalog，私有 transcript 不合并到协调 Conversation。
- 已发布结果若来自旧版本、协调消息尚未保留 `toolCall`，Snapshot 可通过既有 publication source entry
  从成员 Conversation 只读恢复工具调用及其结果；不回写旧文件，thinking 与 tool result 仍不进入协调消息，结果仅
  通过 UI-only Snapshot 投影提供给本机消息列表。
- 临时目标 Conversations 全部通过数量、顺序、作者、关联与 fingerprint 校验后才切换 binding。旧目录在兼容窗口
  只读保留，新生产路径不再写入。
- Renderer 兼容读取旧事件只存在于迁移边界；新生产代码不得继续构造 Team 专属消息类型。

## 后果

- 普通 Chat 与 Team 可以复用相同消息合同、Recipe、工具调用卡片和 Message Feed 基础设施，同时保持各自命令与权限所有权。
- 底层 Conversation 存储不增加 Team 分支；Team 协作通过公开扩展 entry 演进。
- 多成员执行隔离、公共信息共享、压缩与缓存拥有明确且可测试的边界。
- 工作项可以准确表达等待外部资源、继续、重试和恢复，不会把所有 Provider/网络问题误判成 Agent 失败。
- Observation 为未来 UI、诊断、日志或指标提供数据源，但本决策不引入任何具体 Observer，也不把 Observation
  变成业务事实源。
- 该决策替代 ADR-0099 第 2、4、5 条中 Team 专用 Session Event/存储的部分及其“存储隔离”后果，也替代
  ADR-0101 第 7、8 条中 Chat/Team 必须保留不同消息合同的部分；其余配置、UI 分层与 Primitive 决策继续有效。

## 不在本决策范围

- 服务端计费、配额、跨账号协作和跨设备同步。
- 向其他 Team 成员公开工具过程、隐藏 thinking 或 subagent transcript。
- 实现观测 UI、recorder、metrics、日志迁移或远程 telemetry Adapter。
