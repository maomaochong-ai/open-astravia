# 148：混合历史修改与 Seed-aware Fork 闭环

## 目标

在第 147 阶段已经证明迁移会话能够继续真实执行之后，本阶段验证 `Import Seed + V2 Event` 不只是可追加的线性
历史，而是能够继续承担 Conversation Document 的树修改和跨会话 Fork 语义。

本阶段保持既有功能不变：不新增 RPC 命令，不扩大 Greenfield IM Profile，不改变 Provider、Tool、Prompt、Skill、
MCP 或 Legacy 格式支持范围。

## 发现的问题

`FileConversationRepository.writeFork()` 原来只重放 `file.records` 中的 V2 Event 和 Custom Operation。迁移历史位于
`conversation.import.seed`，不属于 `file.records`。因此从迁移后新增的用户消息 Fork 时，新 Event 的 Parent 仍指向
Seed Entry，但目标文件没有 Seed，Document 重建会报错：

```text
Conversation document parent does not exist: tail-user
```

此外，Fork 只保留选中分支时，`branch_summary.fromId` 可能指向被排除的兄弟分支。仅复制 Seed Entry 虽然能修复
Parent 链，却仍可能留下二级悬空引用。

## Storage 修复

Fork 现在按持久化来源切分选中分支：

1. 从当前 Conversation Document 解析 Fork 用户轮次及其完整 Tip；
2. 找出原始 Import/Continuation Seed 所拥有、且仍位于选中分支的 Entry；
3. 将这些 Entry 写入目标 `conversation.continuation.seed`；
4. 从 Seed Document 开始，按原顺序重放属于选中 Turn 的 V2 Event 和 Custom Operation；
5. 继续使用目标会话自己的连续 Event Sequence 和 Session ID。

Seed 使用当前 Document 中的最终 Entry，而不是未经命令修改的原始 Seed，因此删除、重挂父节点和引用修复后的状态
会进入 Fork 目标。对于因分支裁剪而失效的结构引用：

- `branch_summary.fromId` 重写到最近仍保留的祖先，没有祖先时使用 `root`；
- `compaction.firstKeptEntryId` 重写到最近仍保留的祖先，没有祖先时使用 Compaction 自身；
- `label.targetId` 重写到最近仍保留的祖先，并以 Label Parent 或 Label 自身作为最终有效回退。

原生、没有 Seed 的 V2 会话继续使用原有空 Document + Event 重放路径。

## 混合历史文件测试

Runtime Storage 新增综合 fixture，包含根消息、两条用户分支、Branch Summary、Compaction、活动尾部和迁移后新增的
完整 V2 Turn。测试覆盖：

- 活动分支切换后关闭并重开；
- 删除 Seed 消息后的子节点重挂；
- `branch_summary.fromId` 与 `compaction.firstKeptEntryId` 修复；
- 替换最后一个 V2 用户轮次并从保留尾部继续追加；
- 从混合 Event 用户轮次 Fork；
- 从纯 Seed 用户轮次 Fork；
- 两个 Fork 目标独立关闭、重开和重建；
- Legacy 源文件始终保持字节级不变。

## 真实 CLI 会话门禁

新增独立 RPC 可执行测试，直接使用 Vetta CLI 会话能力完成纵向流程：

1. 打开官方 Legacy 综合 fixture，由 Greenfield 自动迁移；
2. 执行首个真实 Provider Turn；
3. 从父 V2 文件取得该用户消息的稳定 Entry ID，通过 RPC `fork` 创建子会话；
4. 验证目标 Header、Continuation Seed、Event Sequence、Parent 链及所有二级引用；
5. 在子会话继续执行真实 Provider Turn；
6. 关闭进程，使用子会话路径重启并再次执行 Provider Turn；
7. 验证 Provider 收到 Fork 前后历史，父 V2 文件和原始 Legacy 文件均未被子会话写入。

测试没有调用 Greenfield IM Profile 未开放的 `get_fork_messages`，也没有为测试扩大 RPC 功能面。

## 测试

- Runtime Storage 迁移/混合历史：9 项通过；
- CLI 迁移会话 Fork、Provider 与重启：1 项通过；
- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包括 Biome、monorepo 类型、CLI、Desktop、Admin 与质量守卫；
- `git diff --check` 通过。

## 结果

迁移会话现在完成“Import Seed → V2 Event → 树修改 → Seed-aware Fork → 子会话继续执行 → 进程重启”的闭环。
Fork 不再把 Seed 当作只读背景，也不会让被裁剪分支的结构引用泄漏到目标会话。修复位于 Storage 持久化边界，
Runtime Core、CLI 和产品 Profile 都不需要感知 Legacy 文件格式。

## 下一步

下一阶段应把 Seed 的完整引用约束下沉为统一的 Storage Codec 校验：除 Parent/Cycle 外，显式验证
`branch_summary.fromId`、`compaction.firstKeptEntryId`、`label.targetId` 和 `activeLeafId`，并补齐损坏 Import Seed、
Continuation Seed 以及写入失败原子性的测试。这样所有 Seed 生产者都由同一个严格边界保护，而不是只依赖各自构造逻辑。
