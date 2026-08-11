# 第 186 轮：迁移会话 Fork 语义校正与回归门禁

## 目标

承接第 185 轮 CLI 全量测试暴露的 `greenfield-migrated-session-fork.test.ts` 失败，确认迁移会话在 Fork 后丢失
`fork-source-turn` 是生产实现回归，还是测试混淆了不同 Fork 合同；修复最低责任边界，并恢复该纵向场景的稳定门禁。

本轮不改变 Conversation 文件格式、RPC 命令、Provider、Tool、Prompt、Skill、MCP 或 Legacy 会话内容。

## 复现事实

原测试可以稳定复现失败。Fork 创建后：

- Continuation Seed、Event Parent 和结构引用全部合法；
- Fork 文件包含所选用户轮次及其 Assistant 回复对应的四条 Turn Event；
- 子会话第一次 Provider 请求包含 Legacy Compaction Summary 与保留尾部；
- Provider 请求不包含所选的 `fork-source-turn` 和 `Source response.`。

因此 Legacy Import Seed 和 Coding Agent 消息投影没有整体失效，差异只发生在所选用户轮次所在的 V2 Event 分支。

## 根因

失败不是生产代码丢失历史，而是测试把两种不同的既有合同混为一体：

1. Runtime Storage 的通用 `forkSession` 负责导出所选用户 Turn，目标文件保留该用户消息及 Assistant/Tool 回复；
2. Coding Agent 的产品 RPC Fork 与旧 `SessionNavigator.fork()` 保持一致，返回所选用户文本供编辑，并在目标恢复后通过
   `navigateForEdit(entryId)` 把活动叶子移动到该用户消息之前；
3. `session_before_fork.skipConversationRestore` 是例外：它只在当前进程为目标安装源执行上下文覆盖，目标文件仍保持重编辑
   语义，进程重启后覆盖自然消失。

目标文件保留所选 Turn 是 Storage 的可追溯事实；随后写入的 `active_leaf.set` 才是产品当前活动分支事实。原测试只统计
Seed 和 Event，没有应用 Document Operation，因此错误地把最后一个 Event 当成有效 Active Leaf，并继续要求 Provider 看见
已经退出活动分支的消息。

## 实施

### 1. 校正真实 CLI 迁移会话 Fork 门禁

测试文件描述器现在按文件顺序处理：

- `conversation.event` 产生的 Document Entry；
- `conversation.document.operation` 中的 `active_leaf.set`；
- Event 和 Operation 的独立数量。

Fork 创建后明确验证：

- 四条源 Turn Event 仍在目标文件中；
- 一条 Active Leaf Operation 已持久化；
- 有效 Active Leaf 回到所选用户消息之前的 `legacy-tail`；
- 第一次子会话 Provider 请求不包含被编辑的源用户消息和回复；
- 子会话新增 Turn 在重启后继续存在；
- 重启后仍不会把已退出活动分支的源 Turn 投影给 Provider；
- Parent V2 文件和原始 Legacy 文件保持字节不变。

### 2. 固定 Active Session Host 的产品合同

Active Session Host 单元测试新增默认 Fork 场景，明确验证：

- 目标恢复后调用 `navigateForEdit(entryId)`；
- 默认不调用 `preserveSessionExecutionContext()`；
- 目标 Session 成为活动会话。

原有 `skipConversationRestore` 测试继续验证临时执行上下文覆盖，两个合同不再依赖同一条模糊断言。

### 3. 未修改生产代码

诊断证明现有生产编排已经符合 Legacy 产品语义。修改生产代码让 Provider 重新看到所选 Turn，会把 RPC Fork 从“重编辑”
改成“复制完整问答”，属于功能重构，因此本轮没有这样处理。

## 验证

- 真实迁移会话 Fork、子会话执行与重启：1 项通过；
- Active Session Host：16 项通过；
- Legacy/Greenfield Extension History 差分：2 项通过；
- `bun run check:quick` 通过。

CLI 全量套件中本轮 Fork 用例已经通过，但套件仍不是全绿：

- 全量并行运行结果为 198 通过、12 失败；
- Subagent Runtime 的两个失败单独复跑后 3 项全部通过；
- Runtime Selection 超时单独复跑后 10 项全部通过；
- Provider Differential 单独复跑仍有 7 项失败，其中稳定差异包括 Greenfield Host Bridge 多出
  `im_send_attachment`、两端宿主提示词规则不一致，以及一个 Attachment Round Trip 超时。

这些失败不在 Fork、Session Migration 或 Active Session Host 本轮修改路径内。本轮不通过放宽 Provider 差分断言夹带修复，
应作为下一独立阶段审计动态宿主能力与 Legacy/Greenfield Provider Surface 的事实来源。

## TypeBox / Zod 判断

本轮没有新增不可信 JSON、RPC、配置或持久化结构。测试只解释既有、已经由 Storage Codec 校验过的记录，不建立第二套
运行时协议，因此不引入 TypeBox 或 Zod。

## 结果

第 185 轮记录的迁移会话 Fork 失败已经关闭。生产实现无需回滚或修改；回归门禁现在同时表达 Storage 保留完整 Turn 与
Coding Agent 默认重编辑 Active Branch 两层语义，并继续验证源文件不可变和子会话重启连续性。

