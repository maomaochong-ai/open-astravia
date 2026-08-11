# 150：RuntimeHost 历史修改差分门禁

## 目标

在第 149 阶段收紧 Seed 图和文件发布边界后，本阶段从真实 Desktop RuntimeHost 验证 Legacy 与 Greenfield 的历史修改
行为等价，而不是继续依赖 Legacy Mock 或单独的 Greenfield Storage 测试。

本阶段不新增历史功能，不扩展 RPC、IM 或 Extension API，也不改变会话文件格式。

## 边界修正

`ExtensionCommandContextActions` 只提供 `navigateTree` 和 `fork`，不提供 `switchBranch`、`deleteMessage` 或
`replaceLastUserMessage`。因此完整历史修改差分属于 RuntimeHost / Session History Controller 边界，不应为了测试方便
扩大 Extension 合同。

差分观察只比较宿主可见行为：消息角色、文本、结构顺序、返回结果、事件、恢复结果和 Provider 输入。Legacy 与
Greenfield 的 Entry ID、隐藏结构 Entry、Revision 和 JSONL 格式都不是功能等价条件。

## 真实差分场景

Desktop 现有 RuntimeHost 差分门禁新增一条双后端纵向场景：

1. 分别启动真实 Legacy 和 Greenfield Backend，并接入本地 OpenAI Responses 测试 Provider；
2. 完成两个真实 Turn；
3. 对第二个用户消息执行 `navigateForEdit`，再提交编辑后的新分支；
4. 使用 `switchBranch` 返回原分支；
5. 删除中间助手消息，验证后代消息仍按活动分支保留；
6. 使用 `replaceLastUserMessage` 移除最后用户轮次及其完整回复子树，再提交替代 Turn；
7. 使用 `forkSession` 导出子会话，验证父文件字节不变；
8. 重建 RuntimeHost，同时恢复父会话和 Fork 会话，并分别继续真实 Provider Turn；
9. 验证父 Provider 不再收到已删除或废弃分支，子 Provider 收到 Fork 基线和选中 Turn；
10. 保持 Provider 请求在途，验证导航、切换、删除、替换和 Fork 全部失败关闭，且不会修改当前历史。

所有直接历史修改都不制造新的执行 `SessionEvent`。测试订阅时先排除 Legacy 订阅源的同步初始状态重放，避免把订阅
初始化事件误判为历史命令事件。

## 发现与修正

### History 结构归一化

Legacy 活动分支可能在两个可见消息之间保留 Model Change、Timing 等透明结构 Entry，因此可见消息的直接 `parentId`
不一定指向另一个可见消息。差分观察按活动分支顺序折叠这些透明 Entry，比较可见结构父节点，不比较内部直接 ID。

这属于观察层归一化，不改变 Legacy 或 Greenfield 历史实现。

### Desktop Fork 合同说明

真实测试确认两个后端都保留既有 Desktop 产品语义：Fork 包含选中的用户消息及该 Turn 的完整助手/工具回复，而不是
只复制到该用户消息的父节点。Runtime Core `SessionFacade.forkSession()` 的注释仍描述旧语义，本阶段将其修正为当前
实际合同；实现没有变化。

## 测试

- Desktop RuntimeHost Legacy/Greenfield 完整差分文件：6 项通过；
- Runtime Core Seed 图合同回归：9 项通过；
- Runtime Storage 原子发布、Seed 完整性、文件仓库、续接和迁移回归：38 项通过；
- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包括 Biome、monorepo 类型、CLI、Desktop、Admin 与质量守卫；
- `git diff --check` 通过。

## 结果

Legacy 与 Greenfield 已在真实 RuntimeHost 下完成“创建分支 → 切换 → 删除 → 替换 → Fork → 父子会话重启 →
Provider 继续执行”的归一化差分闭环。活动 Turn 互斥和无副作用失败也保持一致。本阶段没有发现需要修改后端行为的
兼容问题，只修正了一处过期合同注释。

## 下一步

下一阶段应专门验证 Extension Command Context 实际暴露的两个历史能力：`navigateTree` 与 `fork`。通过真实 CLI
Extension 场景覆盖 `session_before_tree` 取消/摘要/标签、`session_tree`、`session_before_fork` 取消和 `session_fork`
事件，并比较 Legacy/Greenfield 的命令结果与重启持久化。不要把删除和替换扩展到 Extension API。
