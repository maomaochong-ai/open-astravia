# 第 51 轮：Conversation Document、V2 记录与 Greenfield History Read

## 目标

在不修改旧生产入口、旧会话写操作和 Kernel Turn 行为的前提下，建立独立于
`coding-agent` SessionManager 的历史读模型，并让 Greenfield Session 真正交付
`RuntimeSessionHistoryReader`。

本轮验收条件：

1. Runtime Core 拥有会话树文档合同和纯历史投影，不引用旧 SessionManager 类型。
2. 原生 Conversation JSONL 使用 V2 envelope 保存稳定 entry identity，同时继续读取和追加 V1 文件。
3. Legacy v1-v3 JSONL 通过独立只读 importer 转为同一文档，且不改写源文件。
4. Greenfield create/resume 的消息、历史和持久化 revision 保持同步。
5. 旧、新历史投影差异测试与完整质量门禁通过。

## 分析结论

### 1. Kernel Journal 与 Conversation Document 不是同一合同

`StoredSessionEvent` 是线性的 Turn 事实日志，负责恢复模型上下文；宿主历史还需要 entry id、parent、
分支、隐藏 marker、工具 timing 等读取语义。把这些 UI/兼容字段全部塞进 Kernel Event 会污染最小内核。

因此新增只读派生模型：

- Kernel Journal 仍是 Turn 持久化事实。
- `ConversationDocument` 是树形历史和元数据读模型。
- `HistoryEntry[]` 由文档纯投影得到，不成为第二套可写事实来源。

### 2. 原生格式严格，Legacy importer 宽容

两种格式保留各自原有错误语义：

- 原生 V1/V2：完整换行、连续 sequence、TypeBox 领域校验、V2 entry/parent 完整性均 fail closed。
- Legacy v1-v3：跳过坏 JSON，首行必须是有效 session header，v1 线性记录确定性补树形 ID。

没有把 Legacy 的宽容解析放进原生 Repository，也没有让新 Runtime Storage 生产代码导入
`@vetta/coding-agent`。

### 3. V2 是 envelope 演进，不是自动迁移

V2 event record 新增 `documentEntry`：消息事件记录稳定 `id`、`parentId`、ISO timestamp；非消息事件为
`null`。新文件写 V2，已有 V1 文件继续按 V1 追加，不会在读取或恢复时静默重写整份文件。

## 已实施

### Runtime Core

- 新增 `@vetta/runtime-core/conversation` 子入口。
- 新增 `ConversationDocument`、entry union、identity、reader port。
- 新增统一的 Kernel Event → Document 增量投影，原生 entry id 使用持久化 sequence。
- 新增 active branch 选择和 Document → `HistoryEntry[]` 纯投影。
- 保留旧 marker、assistant timing、tool timing、透明节点分支聚合语义。
- Greenfield projection 同时维护消息投影和历史文档，并在 Core Assembly 交付真实 `historyReader`。

### Runtime Storage

- Conversation JSONL 当前 schema 升为 V2，同时严格兼容读取/追加 V1。
- `FileConversationRepository` 实现 `ConversationDocumentReader`。
- V2 读取校验 message/documentEntry 对应关系、重复 entry id 和未知 parent。
- 新增不依赖旧实现的 `LegacySessionDocumentReader` 与纯文本 parser。
- TypeBox 只用于持久化边界的结构校验；领域投影继续使用 TypeScript 判别联合，未额外引入 Zod。

### 可执行能力矩阵

Greenfield 已实现能力从 3 项增加为 4 项：

- lifecycle
- historyReader
- workspaceView
- corePorts

其余 8 项仍明确为 `missing`，没有空实现。

## 兼容性验证

- Legacy v3 分支 fixture 同时经过旧 `entriesToHistory` 和新 Document projector，结果完全相同。
- Legacy v1 fixture 验证确定性线性 ID/parent 重建。
- 原生 V2 验证 header、event envelope、稳定 entry id 和 create/resume 历史恢复。
- 原生 V1 验证可读取、可继续按 V1 追加且不会自动升级文件。
- 损坏测试覆盖非法领域事件、不完整 JSON、未知 document parent。

## 明确未修改

- 默认生产 `RuntimeHost` 仍使用 Legacy Backend。
- 没有实现 Greenfield History Controller、编辑、删除、切分支或 fork 写入。
- 没有自动把 Legacy 文件转换或覆盖为 V2。
- 没有引入跨进程写锁。
- 没有改变 Tool、Prompt、Skill、模型调用或上下文压缩功能。

## 下一步

下一阶段应以一个完整阶段实现“历史写命令与持久化并发边界”：先定义 Runtime-owned
`ConversationCommand`/写入结果合同，再为原生 V2 实现带 expected revision 的分支编辑、删除、替换和 fork，
最后把 Greenfield `RuntimeSessionHistoryController` 接到这些真实命令。Legacy 文件仍只读；需要迁移时由显式
import/export 命令生成新文件，不能在 resume 中隐式升级。
