# 151：Extension 历史命令差分与执行上下文恢复

## 目标

在第 150 阶段完成 RuntimeHost 历史修改差分后，本阶段只验证 Extension Command Context 已公开的两个历史能力：
`navigateTree` 与 `fork`。测试通过真实 Vetta CLI、真实 Extension 模块、真实 RPC 会话和本地 Provider 比较 Legacy 与
Greenfield，不扩大 Extension API，也不把 RuntimeHost 的删除、替换或分支切换能力暴露给 Extension。

## 架构判断

`session_before_fork.skipConversationRestore` 同时涉及两个不同事实：

- Fork 会话文件必须保持 Legacy 的持久化分支语义，只保存选中用户消息之前的历史；
- 当前进程内第一次继续执行时，可以临时继承源会话的完整模型上下文。

两者不能通过改写目标会话文件混在一起。本阶段在 Coding Agent Composition 层增加会话执行上下文覆盖：目标
Conversation Document 仍是持久化事实源；覆盖层只在目标文档仍以前置种子开头时，将该种子替换为源会话上下文，并保留
目标会话后续新增消息。树导航、会话续接、Session 释放和 Composition 释放都会清除相应覆盖；进程重启自然回到持久化
Fork 历史。

该能力没有进入 Runtime Core 公共合同。它是 Coding Agent 对 Legacy Extension 语义的产品编排，不应污染通用内核。

## 实施内容

### Extension Tree

- `session_before_tree` 的取消结果继续阻止任何历史修改；
- Extension 提供的摘要、details、标签与 `fromExtension` 继续写入既有 Conversation Document；
- 成功导航后清除当前 Session 的临时执行上下文覆盖；
- `session_tree` 仍在持久化成功后发送。

### Extension Fork

- `session_before_fork` 的 `skipConversationRestore` 从 Extension Runner 传递到 Active Session Transition Host；
- Greenfield 目标会话恢复后先把活动叶子移动到选中用户消息之前，保持 Legacy Extension Fork 的持久化语义；
- 仅当 Extension 请求时，为新会话安装源会话执行上下文覆盖；
- Fork 失败仍关闭目标 Session、删除新会话产物并保留源会话。

这与第 150 阶段的通用 RuntimeHost `forkSession` 合同不冲突：通用 Fork 仍包含选中 Turn；只有 Extension `ctx.fork`
适配层按既有产品语义切回选中消息之前。

### 持久化边界

真实 CLI 测试暴露出两处此前单元测试未覆盖的问题：

1. Runtime Storage 的 TypeBox 命令联合未声明 `branch_summary.append`，导致合法 Extension 摘要被拒绝；
2. 文件解析器接受该命令后，仍未把它生成的 Entry ID 纳入文档图，下一轮消息引用摘要父节点时被误判为损坏。

本阶段补齐既有 TypeBox Schema，并统一登记 `branch_summary.append`、`custom.append` 和 `entry.label.set` 产生的文档
Entry ID。没有引入 Zod；该边界已经使用 TypeBox，继续沿用同一校验体系更合理。

### RPC 失败观察

Greenfield RPC Adapter 原先丢弃 `TurnResult.status === "failed"`，使调用方只能看到成功确认、`agent_start` 和
`turn_start`，却收不到真实失败原因。本阶段把失败 Turn 转换为异步 RPC 错误响应，保留 prompt 的既有
fire-and-forget 确认方式，同时让真实错误可诊断。

## 真实差分场景

测试 Extension 注册 `/history-tree` 与 `/history-fork`，并通过独立 JSONL 审计文件观察命令和生命周期结果：

1. Tree 取消后会话身份和文件路径不变；
2. Tree 摘要后废弃分支不再进入 Provider，摘要、标签和 Extension 来源保持一致；
3. Tree 会话重启后继续得到相同持久化上下文；
4. Fork 取消后源会话不变；
5. `skipConversationRestore` Fork 后的第一次 Provider 调用继承源会话完整上下文；
6. Fork 重启后只恢复选中消息之前的持久历史，不保留进程内覆盖；
7. Fork 全程不修改源会话文件字节。

CLI 的 `prompt` 确认是 fire-and-forget。测试不把确认帧误当作 Extension 命令完成，而是在 Extension handler 返回后的
事件循环边界写入独立完成标记，再发起下一条命令。

## 安装产物

独立安装 CLI 产物测试不再只检查 Extension Profile。测试加载实际 Extension 文件，调用其注册命令并验证命令产生的
审计文件，从而确认 Extension loader、命令发现、运行期绑定和可执行产物打包形成闭环。

## 测试

- 真实 CLI Legacy/Greenfield Extension tree/fork 差分：2 项通过；
- Greenfield 执行上下文覆盖、活动 Session 转换与树导航：10 项通过；
- Runtime Storage 自定义 Entry、摘要及摘要后继续写入：3 项通过；
- Greenfield IM RPC Adapter：10 项通过；
- 独立安装 CLI 产物：6 项通过；
- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包括 Biome、monorepo 类型、CLI、Desktop、Admin 与质量守卫。

## 明确未修改

- 未新增或扩大 Extension、RPC、IM、Runtime Core 公共 API；
- 未改变通用 RuntimeHost Fork 行为；
- 未改变 Legacy 会话格式或 V2 会话文件格式；
- 未用持久化改写模拟 `skipConversationRestore`；
- 未重构删除、替换、switchBranch 等不属于 Extension Command Context 的能力。

## 结果

Extension 的 tree/fork 已形成“真实 CLI 命令 → Extension 生命周期 → Conversation Document → Provider 输入 →
进程重启”的 Legacy/Greenfield 差分闭环。执行上下文与持久化历史现在是两个明确边界，动态运行期覆盖不会成为会话文件的
隐式事实源。

## 下一步

下一阶段应基于本阶段新增的失败可观察性，盘点 Greenfield RPC 中仍可能返回失败 `TurnResult` 的入口及终态事件一致性，
重点验证 Provider 错误、上下文构建错误和用户中止时，Legacy/Greenfield 是否都产生可结束的 RPC 终态，而不是继续扩展
Extension 功能。
