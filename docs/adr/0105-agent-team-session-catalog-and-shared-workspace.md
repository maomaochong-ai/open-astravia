# ADR-0105：Agent Team 会话目录与共享工作空间

## 状态

已接受

## 背景

ADR-0103 决定 Agent Team 的公开协调历史和成员执行历史继续使用普通 Conversation 存储。Runtime catalog
因此会枚举到这些底层 Conversation，并把它们混入普通对话列表与搜索结果。Renderer 同时只保存每个 Team
最后打开的一条引用，无法稳定打开同一 Team 下的多个会话。

ActivityPanel 还同时把 cwd 当作路径、状态身份，并由部分页签直接读取普通对话的 `activeSessionAtom`。Team
拥有多个成员 Runtime，不能选择其中任意一个冒充整个 Team 的活动会话，否则会把 Todo、Debug 或 Browser
操作路由到错误的成员。

## 决策

1. Conversation 保持唯一底层消息与会话存储格式。Desktop 在 Runtime catalog 之上维护版本化的
   `ConversationOwnershipCatalog`，以规范化 `sessionPath` 记录 Team、Team session 与 coordination/member
   角色。普通列表、Quick Panel 和搜索 Worker 在发布结果前都通过该目录排除 Team 所有的底层 Conversation。
2. Team session 创建和保存时同步登记协调及成员 Conversation。普通列表、Quick Panel 或 Team 列表首次查询前，
   主进程会一次性枚举旧 sidecar 并补登记；搜索 Worker 只读相同旧数据并在内存中叠加过滤，不参与 catalog 写入。
   尚无协调 Conversation 的更早记录先登记成员 Conversation，随后由旧书签打开时完成协调迁移。原有 JSONL、
   快照、锁和恢复格式保持不变。
3. 一个 Team 可以拥有多个 Team session。Main 通过 ownership catalog 投影可见会话摘要；Renderer 使用明确的
   session 路由、侧栏子会话和最后打开书签。草稿、附件、输入历史、公开消息和模型配置都按 Team session 隔离。
4. 每个 Team 拥有稳定工作空间目录和 `workspaceId`，该 Team 的所有新会话与所有成员 Runtime 共用这个 cwd。
   Team session 仍保存 cwd 快照，用于恢复现有 Conversation。
5. ActivityPanel 核心只接收 `{ id, cwd }` 工作空间合同，不读取对话类型或全局活动会话。普通对话、项目和 Team
   各自由 Adapter 提供工作空间。面板的页签选择、顺序、隐藏、浮动和 Browser 状态按 `workspace.id` 隔离。
6. ActivityPanel 外壳由 `Root`、`Desktop`、`Surface`、`Header`、`Body`、`ResizeHandle` 与 `Sheet` 组合式
   Primitive 构成；Root 只拥有开合与拖动行为，业务页签和数据源由宿主显式组合。
7. Team 仅启用已有明确工作空间语义的 File 与 Browser 页签。仍以单一 Runtime 为数据源的 Todo、后台任务、
   Workflow 与 Debug 不接入 Team，直到它们提供带成员身份的 Team 聚合数据源。
8. 模型与推理档位属于 Team session。选择器使用受控作用域写入 Team session；成员任务在排队时捕获有效设置，
   并在 prompt、continue、retry 或 recovery 进入 Runtime 前统一应用。普通对话的全局默认和活动会话配置不被修改。

## 后果

- 用户只在普通对话界面看到普通 Conversation；Team 的公开和成员执行文件仍可由原 Runtime 恢复。
- Team 配置、Team session 和底层 Conversation 身份分离，同一 Team 的多个会话共享文件工作空间，但拥有独立
  对话历史、草稿和模型设置。
- ActivityPanel 可以被任何提供工作空间合同的宿主复用，扩展页签无需在面板核心增加产品类型分支。
- ownership catalog 是可重建的产品索引。所有普通会话查询会在发布结果前等待旧 sidecar 回填，旧书签负责补齐
  尚无协调 Conversation 的更早记录；索引损坏会明确报错，不能把未知会话静默当作普通对话发布。

## 不在本决策范围

- 修改 Runtime Conversation 持久化协议或将 Team 私有执行内容合并到公开历史。
- 为 Team 聚合 Todo、后台任务、Workflow、Debug 或插件能力。
- 为共享目录提供文件事务或多成员写入串行化。
