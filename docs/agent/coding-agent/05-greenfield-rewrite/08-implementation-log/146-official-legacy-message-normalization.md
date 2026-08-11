# 146：官方 Legacy 消息无损规范化

## 目标

在第 145 阶段“无法证明完整就回退”的严格迁移门禁之上，补齐 Coding Agent 官方 Legacy 消息与上下文记录的
V2 表达，同时保持以下约束：

- `runtime-storage` 不依赖 Coding Agent 的具体消息类型；
- 迁移前后的 AgentMessage 身份和模型输入保持等价；
- 未知 Extension 私有消息仍然失败关闭；
- 源文件、Entry ID、Parent ID 和时间戳不被改写；
- Tool、Prompt、Skill、MCP、Provider 和 Extension 执行功能不重构。

## 兼容矩阵

| Legacy 内容 | V2 处理 | 结果 |
| --- | --- | --- |
| `user` / `assistant` / `toolResult` | 保持 `message` | 直接迁移 |
| `bashExecution` | 保留原始身份的受命名 `custom_message` | 无损规范化 |
| `custom` AgentMessage | 保留原始身份的受命名 `custom_message` | 无损规范化 |
| `branchSummary` AgentMessage | 保留原始身份及精确 user 投影 | 无损规范化 |
| `compactionSummary` AgentMessage | 保留原始身份及精确 user 投影 | 无损规范化 |
| Legacy `custom_message` Entry | 补充旧语义对应的 `modelVisible` | 无损规范化 |
| Legacy `compaction` Entry | 补充精确 `summaryMessage` | 无损规范化 |
| 未知 Entry Type | 不调用产品 Normalizer | 回退 Legacy |
| 未知 AgentMessage Role | Normalizer 原样返回，严格 Schema 拒绝 | 回退 Legacy |

## 实施内容

### 存储层 Normalizer 端口

`runtime-storage` 新增 `LegacySessionImportEntryNormalizer`。自动迁移必须显式传入产品侧 Normalizer，存储层只负责：

- 解析 JSONL；
- 调用 Normalizer；
- 验证规范化结果仍属于已知 V2 Entry；
- 禁止 Normalizer 修改 `id`、`parentId` 和 `timestamp`；
- 校验完整引用关系并原子发布目标文件。

Normalizer 抛错、产生未知 Entry 或修改树身份时统一报告 `invalid-payload`，诊断中不包含正文。

### Coding Agent 官方格式适配

Coding Agent 新增独立 Legacy Import Normalizer：

- 使用 TypeBox 验证四种官方扩展 AgentMessage；
- 将其转换为 `vetta.legacy_agent_message` 上下文记录；
- `details.agentMessage` 保存完整原始身份；
- `content` 保存 `convertToLlm()` 产生的精确模型投影；
- `modelVisible` 保留 `excludeFromContext` 和模型不可见 Prompt Marker 语义；
- 恢复到 Coding Agent 边界时校验身份与模型投影一致，再还原原始 `message` Entry。

因此 Extension `context`、只读 SessionManager 和 Compaction 输入仍能观察到原始 `bashExecution`、`custom`、
`branchSummary`、`compactionSummary`，而 Runtime Core 仍只消费标准 Message 或通用 Context。

### 旧上下文记录语义

Legacy `custom_message` 原本默认进入模型上下文，但 V2 要求显式 `modelVisible`。Normalizer 根据既有
`convertToLlm()` 规则补齐该字段；Prompt Resource Reference 和清空附件 Marker 继续保持模型不可见。

Legacy `compaction` 新增精确 `summaryMessage`，避免 Greenfield 的通用 Conversation 投影把旧压缩记录当成普通
透明 Entry。摘要文本继续复用既有前后缀，不重新定义压缩行为。

### 会话身份

迁移现在同时保留 Legacy Header 的：

- `cwd`，包括空字符串；
- `parentSession` → `parentSessionPath`；
- `parentEntryId`。

V2 Import Seed 允许 Header 携带这些已验证的来源身份；Continuation Seed 原有一致性约束没有改变。

## 测试

- `runtime-storage` 严格分析与迁移：20 项通过；
- Coding Agent AgentMessage 投影与 Normalizer：6 项通过；
- CLI Legacy 自动迁移：6 项通过；
- 独立安装可执行文件迁移与失败关闭：2 项通过；
- `bun run check:quick` 通过；
- 根目录 `bun run check` 通过，包括 Biome、monorepo 类型、CLI、Desktop、Admin 与质量守卫。

验证内容包括：

- 四种官方扩展 AgentMessage 的身份序列不变；
- Greenfield 模型消息与 Legacy `convertToLlm()` 输出完全相等；
- Bash `excludeFromContext`、Custom Marker 和 Compaction 摘要语义不变；
- Normalizer 不能改写会话树身份；
- 未知私有 Role 仍返回 `invalid-payload`；
- 独立可执行文件能够迁移 BashExecution，未知 Entry 继续回退且不泄漏正文；
- Legacy 源文件保持字节级不变。

## 结果

自动迁移不再把 Coding Agent 自己定义的扩展 AgentMessage 误判为无法表示，也不会为了提高迁移率而让
Runtime Core 或 Storage 认识产品消息。产品语义由 Coding Agent Adapter 拥有，Storage 只拥有严格、可注入、
不可修改树身份的迁移机制。

## 下一步

下一阶段应把“格式迁移成功”推进到“迁移后真实继续执行等价”：使用独立 Vetta CLI 打开包含 Bash、Custom、
Branch Summary 和 Compaction 的旧会话，继续一个真实 Provider Turn，对比 Legacy/Greenfield 的 Provider 输入、
Extension `context` 身份、分支选择和再次持久化结果。只有真实继续对话通过后，才能认为旧会话执行切换完整闭环。
