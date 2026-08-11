# 145：旧会话严格无损迁移门禁

## 目标

修复自动迁移复用宽松 Legacy Reader 时可能静默丢弃记录的风险，并建立“成功即完整、否则回退”的严格门禁：

- 保留既有宽松 Reader 的兼容读取行为；
- 自动迁移逐行验证，每个非空记录必须被保留或产生明确 issue；
- v1、v2、v3 的已支持记录建立完整格式矩阵；
- 失败诊断只暴露 issue 分类和数量，不泄漏会话正文；
- 源码 CLI、standalone 安装产物和 IM Gateway 使用同一结构化结果。

## 风险分析

`parseLegacySessionDocumentSource()` 的职责是尽最大可能读取旧文件，因此会忽略损坏 JSON、非法 Envelope、
未知记录和无法解析的 payload。该策略适合历史浏览和 Legacy 恢复，却不适合作为自动迁移前置条件：被忽略的
记录不会进入最终 V2 Seed，后续 Schema 无法判断它们曾经存在。

因此本阶段没有改变 Reader，而是在迁移路径前增加独立的严格 Import Analyzer。两者的语义明确分离：

```text
Legacy Reader：宽松、尽可能恢复、允许跳过坏记录
Import Analyzer：严格、逐行分类、任何不可保留内容都失败关闭
```

## 实施内容

### 严格分析合同

`runtime-storage` 新增 `analyzeLegacySessionImport()`，返回：

- `representable`：包含已验证的 `LegacySessionDocumentSource`；
- `not-representable`：包含不带正文的 `LegacySessionImportIssue[]`。

Issue 分类包括：

- `malformed-json`；
- `invalid-header` / `invalid-envelope` / `invalid-payload`；
- `unsupported-record`；
- `duplicate-entry-id`；
- `broken-parent-reference` / `cyclic-parent-reference`；
- `invalid-entry-reference`。

每个 issue 只包含行号、分类和可选记录类型。

### TypeBox 边界

本阶段在旧 JSONL 磁盘输入边界使用 TypeBox，而不是为内部对象重复增加 Zod：

- Header 只接受 v1-v3 已知字段；
- Message 复用 V2 `ConversationMessageSchema`；
- Thinking、Model、Compaction、Branch Summary、Custom、Custom Message、Label、Session Info 和 Tool Timing
  使用记录级 Schema；
- 未知额外字段会导致 `invalid-payload`，避免转换时静默丢字段。

### 引用完整性

Schema 通过后继续校验：

- v2/v3 必须显式提供 Entry ID 和 Parent ID；
- ID 不重复；
- Parent 存在且无循环；
- Compaction、Branch Summary 和 Label 的 Entry 引用存在；
- Header 与 Entry 时间戳可解析。

### 迁移与诊断链路

`migrateLegacySessionToV2()` 只接受 `representable` 结果。失败抛出
`LegacySessionImportError`，并在创建目标目录之前终止。

CLI 将首个 `issueCode` 和 `issueCount` 投影到现有 `sessionMigration`，RPC `get_state`、stderr 和 IM Gateway
继续传递该摘要。错误对象、RPC 和日志都不包含源记录正文。

## 功能兼容性

- Legacy Reader、Legacy Runtime 和显式 Legacy 启动没有修改；
- 可完整表示的旧会话继续自动迁移；
- 锁冲突、未知记录、损坏内容和引用错误回退 Legacy；
- 源文件保持字节级不变；
- 目标的确定性 ID、幂等复用和冲突行为不变；
- Tool、Prompt、Skill、MCP、Extension 和 Provider 行为没有重构。

本阶段有意收紧的只有自动迁移判定：过去可能被宽松 Reader 忽略的记录，现在会阻止迁移。这是防止数据
丢失的正确性修复，不影响 Legacy 对同一文件的兼容读取。

## 测试

覆盖范围：

- v1（无 version）、v1、v2、v3 完整记录矩阵；
- User、Assistant Tool Call、Tool Result；
- Thinking、Model、Compaction、Branch Summary；
- Custom、Custom Message、Label、Session Info、Tool Timing；
- 损坏 JSON、未知记录、额外字段、非法消息 payload；
- 重复 ID、断裂 Parent、循环 Parent 和无效 Entry 引用；
- 迁移失败前不创建目标目录，源文件不变；
- CLI/RPC issue 摘要与 stderr；
- standalone 安装产物的成功迁移和严格 Legacy fallback；
- IM Gateway 对 issue 字段的解析和日志投影。

## 结果

自动迁移不再把“宽松读取到了部分内容”等同于“能够无损迁移”。每个旧记录都有明确去向；只要存在一条
无法证明可保留的记录，系统就保持旧文件和 Legacy 执行路径，不会发布不完整的 V2 会话。

## 下一步

下一阶段应基于 `issueCode + recordType` 建立真实旧会话兼容性清单，优先处理命中率高且能无损表达的类型。
补充转换时必须先增加旧格式 Fixture 和 V2 等价断言，再放宽对应 Schema；未知 Extension 私有记录仍应长期
回退 Legacy，不能通过忽略字段提高迁移成功率。
