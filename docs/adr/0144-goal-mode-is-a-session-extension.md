# ADR-0144：目标模式由 Session Extension 持有

## 状态

已接受

## 背景

目标模式允许用户给会话设置一个可验证的长期目标。Agent 在一次模型响应自然停止后，如果目标仍未完成，继续执行下一步，直到完成、暂停或阻塞。

它不是新的 Agent Mode：Agent Mode 是创建会话时固化的任务先验。它也不是 Permission Mode：目标模式不会改变工具权限，而是管理一个可持续执行、可恢复的会话目标。

如果只在 Desktop 输入栏增加 Prompt 开关，目标状态、停止条件和恢复行为会散落在宿主与 Renderer 中，CLI 等宿主也无法复用。若把它放进 Agent Core，则会把 Coding Agent 的产品策略下沉到通用模型循环。

## 决策

- 目标模式实现为 `@vetta/coding-agent` 的 Session Extension，由它唯一持有目标状态、Conversation Document 快照、模型工具、动态指令和 continuation source。
- `@vetta/runtime-core` 继续提供通用的 Session Extension、文档参与者和 continuation 编排，不认识目标语义。
- 目标状态包括 `active`、`paused`、`blocked`、`usage_limited` 与 `complete`，并记录已用 Token、累计执行时间和自动续跑次数；目标模式本身不设置 Token 预算。
- 模型通过 `get_goal`、`create_goal` 和 `update_goal` 访问目标。模型只能把目标更新为完成、阻塞或暂停；恢复、清除与预算选择属于用户控制面。
- Goal continuation 排在锁定 Todo 之后、Plugin 与 Stop Hook 之前。现有输入队列仍负责保证普通用户输入优先。
- 目标文本按不可信用户数据处理，不得覆盖系统、安全、权限和工具规则。
- Desktop 的 IPC 保持薄；`DesktopGoalController` 负责编排“写入状态后继续”以及“先暂停状态再中断”的竞态顺序。
- 首版只在已有持久化会话中创建目标。应用重启会恢复状态和界面，但不会自动唤醒执行；用户必须显式点击继续。实时运行期间仍会自动迭代。
- Desktop 创建目标时只要求填写目标，不要求用户估算执行所需 Token。

## 备选方案

- 把目标模式加入 Agent Mode 注册表：会把创建时固化的任务先验和会话内可变执行状态混为一谈，也无法表达暂停、恢复与完成。
- 复用 Plan Mode：Plan Mode 是只读工具闸门和用户审批流程，目标模式是自动续跑策略，两者生命周期和安全边界不同。
- Desktop 维护布尔开关并追加隐藏 Prompt：实现较小，但没有跨宿主持久化、状态机和可靠停止条件。
- 在应用重启后自动恢复执行：更接近无人值守任务，但可能在用户没有当前操作意图时调用工具和消耗额度，推迟到具备后台驻留与通知策略后再评估。

## 后果

- 目标状态随 Conversation Document 分支恢复，Desktop、CLI 和未来宿主可以共享同一产品合同。
- 目标模式不提供独立 Token 预算；用量仍受账户、Provider 与宿主已有的额度和上下文限制约束。
- 暂停操作先更新目标状态，再中断 Turn，避免中断与自然停止竞态产生额外续跑。
- 同一会话只能存在一个未完成目标；新目标必须在旧目标完成或被清除后创建。
- 当前没有跨应用重启的无人值守执行；恢复后的活跃目标需要用户再次确认继续。
