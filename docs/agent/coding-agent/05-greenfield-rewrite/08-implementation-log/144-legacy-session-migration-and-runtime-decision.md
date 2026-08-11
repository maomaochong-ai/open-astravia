# 144：旧会话迁移与 Runtime 决策闭环

## 目标

收敛第 143 阶段剩余的两类生产回退责任，但不删除 Legacy Runtime：

- 可无损表示的旧 `.jsonl` 会话在 Greenfield 启动边界自动迁移；
- 源会话始终只读，迁移结果可重复、可复用，并尊重旧会话所有权锁；
- 无法表示、被占用或迁移失败时继续回退 Legacy；
- RPC `get_state` 输出结构化 Runtime 决策，IM Gateway 能观察迁移并持久化实际会话路径；
- 移除没有稳定 RPC 语义的交互式 `--resume`，统一使用 `--continue` 或 `--session`。

## 分析结论

### 1. 迁移属于 Composition Root，不属于 Agent 内核

旧格式解析和 V2 文档转换由 `runtime-storage` 提供，旧格式锁适配器位于 coding-agent 的
`legacy-session-format` 边界；是否迁移、迁移后选择哪个 Runtime，则由 CLI 的 Greenfield IM
Composition Root 决定。Agent Core、Turn Pipeline 和工具系统都不感知旧文件路径或迁移策略。

### 2. 自动迁移必须是只读、确定且幂等的

迁移前先获取旧会话格式锁，再读取源文件。目标会话 ID 由“规范化源路径 + 源内容”的 SHA-256 生成：

- 同一路径、同一内容得到同一目标；
- 已存在且内容完全一致的目标直接复用；
- 源内容改变后生成新目标，不覆盖旧迁移结果；
- 目标已存在但内容不同仍报冲突，不做静默覆盖；
- 无论成功、复用还是失败，都不修改或删除源文件。

这不是运行时快照。迁移只发生在会话打开边界，运行中的 Tool、Prompt、Skill 和 MCP 动态变化仍由各自的
运行时能力源处理。

### 3. Legacy fallback 只承载真实兼容缺口

可表示旧会话不再因为扩展名是 `.jsonl` 就直接进入 Legacy。以下情况仍保留回退：

- 源会话正被 Legacy 所有者持锁；
- 旧事件或命令无法无损投影到 V2；
- 解析、读取或迁移提交失败；
- Extension Profile 仍包含 Greenfield 未支持的能力。

交互式 `--resume` 依赖终端选择 UI，RPC/IM 宿主没有稳定的交互协议，因此不再伪装成 Runtime fallback，
而是在公共选择边界明确拒绝，并提示改用确定性的 `--continue` 或 `--session`。

### 4. 实际 Runtime 与路径必须是协议事实

`RpcSessionState` 新增 `runtimeDecision`，统一包含请求后端、实际后端、fallback 原因、会话迁移状态和
Extension fallback 诊断。Legacy 与 Greenfield Adapter 都输出同一合同。

IM Gateway 握手优先读取该结构化对象，同时保留旧 `runtimeBackend` 和旧回调兼容。若 Agent 返回的
`sessionFile` 与 Router 已保存的旧路径不同，Router 会把 `(user, chat)` 映射更新为迁移后的实际路径，
下一次消息直接恢复 Greenfield 会话。

## 实施内容

### runtime-storage

- 迁移结果增加 `created`，区分新建和复用；
- 增加“仅复用内容完全一致目标”的幂等选项；
- 目标冲突仍保持原错误语义，不覆盖已有文件。

### coding-agent

- 新增旧会话格式 Lease Adapter，隔离具体 `SessionLock` 实现；
- RPC 状态合同新增结构化 `RpcRuntimeDecision`；
- Legacy RPC Adapter 接受宿主传入的决策，不自行推断迁移原因；
- CLI 帮助移除 `--resume` 的旧说明，明确确定性替代参数。

### cli-app

- 新增 Greenfield IM 旧会话迁移适配器；
- Runtime Host 在会话选择后执行加锁、迁移或 Legacy fallback；
- Selector 将同一决策传给 Legacy/Greenfield RPC Adapter，并输出迁移诊断到 stderr；
- 标准安装产物验证真实旧会话迁移，而不只验证源码组合。

### im-gateway

- 本地 Host Client 解析结构化 Runtime 决策，并兼容旧 `runtimeBackend`；
- Host 日志暴露 fallback 与迁移状态；
- Router 在实际路径变化时更新会话映射，覆盖旧路径迁移场景。

## 功能兼容性

本轮只改变旧会话进入新架构的路由方式：

- 原会话内容、Provider 调用、Tool、Skill、MCP、Extension 和消息协议未重构；
- 旧文件仍可由 Legacy 打开，迁移不会改写旧文件；
- 不可表示与锁冲突仍走 Legacy，避免为了切换 Runtime 丢失功能；
- 显式 `--agent-runtime legacy` 保持原行为；
- Greenfield 原生 `.conversation.jsonl` 的创建、继续和所有权语义不变。

唯一有意收敛的旧行为是 `--resume`：它不再进入交互式 Legacy 选择器，调用方必须提供可确定解析的
`--continue` 或 `--session`。

## Schema 决策

没有新增 Zod 或 TypeBox。旧会话输入已经在既有 Legacy Reader 和迁移转换边界完成运行时校验；
`runtimeDecision` 是 RPC 输出而不是新的 TypeScript 外部输入。IM Gateway 作为 Go 协议消费者对动态 JSON
字段做防御性解析，并在结构化字段缺失时回退读取旧 `runtimeBackend`。重复引入一套 Schema 不会增加边界
安全性，反而会形成第二份协议事实源。

## 测试

本阶段覆盖：

- 相同源重复迁移复用目标，源内容变化生成新目标；
- 旧会话锁冲突和不可表示事件回退 Legacy；
- Runtime Host、真实 CLI 子进程和 standalone 安装产物迁移；
- RPC `get_state` 的 Greenfield、Legacy 和结构化 fallback 决策；
- IM Gateway 结构化决策解析及迁移后路径回写；
- coding-agent、cli-app、runtime-storage 定向测试和仓库质量门禁。

## 结果

`legacy-session` 不再是按扩展名触发的永久回退。可无损迁移的旧会话会进入 Greenfield，失败路径仍由
Legacy 承载；迁移结果从 CLI Composition Root 一直传到 RPC 与 IM Gateway，宿主保存的是 Agent 实际打开
的会话路径，而不是启动前的猜测。

## 下一步

下一阶段应统计并分类仍命中的 `not-representable` 旧事件类型，逐类判断是补充无损转换、长期保留 Legacy
读取，还是需要用户显式选择。只有在真实旧会话样本和安装产物门禁都覆盖后，才能继续缩小
`legacy-session` fallback；不要直接放宽转换器而丢弃无法表达的字段。
