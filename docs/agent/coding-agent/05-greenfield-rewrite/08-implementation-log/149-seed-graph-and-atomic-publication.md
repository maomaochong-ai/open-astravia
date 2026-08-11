# 149：Seed 图契约与文件原子发布

## 目标

承接第 148 阶段的混合历史与 Seed-aware Fork，本阶段把 Seed 的完整图约束收敛到统一合同，并让新会话、续接、
Fork 和 Legacy 迁移共享同一套排他、完整文件发布机制。

本阶段不改变会话功能、文件格式、Provider、Tool、Prompt、Skill、MCP 或宿主 Profile，只加强既有持久化边界。

## 边界分析

Seed 的 Parent、Cycle、结构引用和 Active Leaf 都属于 Conversation Document 的产品图语义，不属于 JSONL Codec 或
TypeBox 的结构校验职责。因此统一校验函数位于 Runtime Core；Storage Codec 只负责在读取持久化文件时调用该合同，
并把合同异常映射为稳定的 `CORRUPT` 存储错误。

文件原子发布属于 Storage 内部实现细节。它不进入 Runtime Core，也不暴露为公开可配置能力。

## Runtime Core 图合同

新增独立的 `assertConversationDocumentGraph()`，`createSeededConversationDocument()` 复用该合同。校验覆盖：

- Entry ID 唯一；
- Parent 必须存在且 Parent 链无环；
- `branch_summary.fromId` 必须指向已有 Entry，或使用既有 `root` 哨兵；
- `label.targetId` 必须指向已有 Entry；
- `compaction.firstKeptEntryId` 必须存在，并与 Compaction 位于同一条可比较的祖先链；
- `activeLeafId` 非空时必须存在。

Compaction 同时接受两种已有产品语义：旧导入历史中 `firstKeptEntryId` 可以是 Compaction 的祖先，续接 Seed 中也可以
是其后代；兄弟分支引用仍会被拒绝。Branch Summary 和 Label 允许合法地引用兄弟分支，因为它们不是 Parent 链。

## Storage Codec 失败关闭

`parseConversationFile()` 在完成 Seed 结构解析后调用统一图合同，Import Seed 与 Continuation Seed 使用相同规则。
任何图损坏都转换为 `ConversationStorageError(CORRUPT)`。

`documentFromFile()` 的 Seed Document 创建也被纳入原有错误映射边界，避免调用方因入口不同而收到裸 `Error`。
TypeBox 继续只负责文件记录的结构与字段类型，不复制产品图语义。

## 文件原子发布

Runtime Storage 新增内部 `publishConversationFileExclusive()`：

1. 在目标目录写入同卷临时文件，并使用 `wx` 防止临时名覆盖；
2. 内容完整写入后，通过排他硬链接发布到目标路径；
3. 无论成功、目标冲突或发布失败，都清理临时文件；
4. 已存在目标始终保持原内容，不会被覆盖。

文件仓库的会话创建、跨会话续接、Fork，以及 Legacy 会话迁移均复用该实现。续接仍保留原有双文件事务语义：只有
目标发布成功后才向源会话追加转移记录；若源追加失败，只回滚本次已经发布的目标，不删除竞争者预先存在的文件。

## 测试

- Runtime Core 图合同：9 项通过；
- Runtime Storage 原子发布、Seed 完整性、文件仓库、续接和迁移：38 项通过；
- CLI 迁移会话 Fork、真实 Provider 与进程重启：1 项通过；
- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包括 Biome、monorepo 类型、CLI、Desktop、Admin 与质量守卫；
- `git diff --check` 通过。

## 结果

Seed 不再依赖各生产者自行保证图正确。Runtime Core 成为唯一产品图语义来源，Storage Codec 提供统一失败关闭和稳定
错误合同；所有新文件生产路径也不再向读取者暴露只写入 Header 或部分 Seed/Event 的中间状态。

## 下一步

下一阶段应转向真实宿主历史修改的差分门禁：通过现有 Session History Controller 和 Extension Command Context，验证
导航、删除、替换与 Fork 在 Legacy/Greenfield 路由下的可观察行为、事件顺序和重启结果。重点是验证既有功能，不新增
宿主命令，也不把文件格式或图修复逻辑上移到产品入口。
