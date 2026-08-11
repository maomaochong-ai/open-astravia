# 第 126 轮：Legacy 格式兼容与执行兼容分离

## 目标

在第 125 轮建立 Legacy 职责白名单后，将仍位于同一服务模块和 Desktop 兼容对象中的两类职责拆开：

- 旧 JSONL 的识别、列举、读取、重命名和删除属于格式兼容；
- 旧 `AgentSession` 的创建和恢复属于执行兼容；
- 格式兼容不能依赖旧 Agent 执行；
- 保留现有默认值、回退原因、迁移策略和会话行为。

## 审计结论

`LegacyRuntimeSessionCatalog` 和 `LegacyRuntimeSessionFileHistoryReader` 不需要启动
`AgentSession`。它们只依赖旧 JSONL 的头部、`SessionManager` 的离线文件能力以及现有 History
投影函数。

重命名仍需要通过 `SessionManager.open` 完成，因为该路径承载了既有锁、父子关系和写入语义。这里对
`SessionManager` 的使用属于旧格式文件适配，不等于旧 Agent 执行。

旧格式解析器继续留在 `coding-agent`。`runtime-core` 只持有格式中立的 Catalog、History Reader 和
访问路由 Port，不应知道旧 JSONL 的版本、头部或容错规则。

## 实施

### 1. 建立独立 Legacy 格式兼容模块

新增 `legacy-session-format/`：

- `header-reader.ts`：同步和异步识别旧会话头部；
- `catalog.ts`：旧会话所有权、项目/会话列举、带锁重命名和删除；
- `history-reader.ts`：直接读取旧 JSONL 并投影统一 History；
- `index.ts`：格式兼容公开出口。

原 `legacy-session-services.ts` 不再承载 Catalog 和 History 实现，只保留兼容导出及已弃用的共享模型
控制器别名。现有公开类名与 `@vetta/coding-agent/runtime-host` 子路径保持不变。

### 2. 拆分 Desktop 兼容组合

原单一 Desktop Legacy 兼容模块拆为：

```text
desktop-legacy-execution-compatibility.ts
└── LegacyCodingAgentSessionBackend

desktop-legacy-session-format-compatibility.ts
├── LegacyRuntimeSessionCatalog
└── LegacyRuntimeSessionFileHistoryReader
```

Desktop Composition Root 显式组合两者：

- Router 的 Legacy 分支只消费执行 Backend；
- Composite Catalog、History Reader 和访问解析器只消费格式兼容对象；
- 格式兼容工厂不接收 `ModelRegistry`，也不创建 `AgentSession`。

### 3. 增加架构守卫

质量守卫对 `legacy-session-format/` 增加双重限制：

- 禁止导入 `agent-session`、SDK 和 Legacy Backend；
- 禁止使用 `AgentSession`、`createAgentSession`、`LegacyCodingAgentSessionBackend` 和
  `ModelRegistry` 符号。

Desktop 的生产白名单也拆为两个文件：执行文件只能持有 Backend，格式文件只能持有 Catalog 和
History Reader。测试覆盖允许项和交叉越界项。

### 4. 使用原始 JSONL 验证格式合同

Runtime 会话服务测试不再通过 `SessionManager` 生成 fixture，而是直接写入旧 v3 JSONL，其中包含：

- session header；
- user/assistant message；
- 一行历史上允许跳过的 malformed 内容。

测试随后验证列举、所有权判断、历史读取、重命名、锁释放和删除。这证明格式兼容合同无需创建
`AgentSession`，同时保留已有容错行为。

### 5. Schema 选择

本轮没有引入 TypeBox 或 Zod。旧 JSONL 是历史持久化格式，当前读取器允许跳过 malformed 行并容忍
演进中的字段；此时加入严格 schema 会把架构拆分变成功能收紧。类型边界继续由 TypeScript Port
保证，外部不可信新协议仍应在各自入口使用 TypeBox。

## 验证

针对性测试：

- 质量守卫：1 个文件，35 项测试通过；
- Runtime 会话服务：1 个文件，4 项测试通过；
- Coding Agent 公开子路径：1 个文件，2 项测试通过；
- Desktop 结构、宿主和 Model Call Frame 差分：3 个文件，18 项测试通过；
- 合计：6 个文件，59 项测试通过。

真实 `bun run verify:ui:runtime-diff`：

- Default 与显式 Greenfield：`blockingDifferences=[]`；
- 显式 Legacy 与显式 Greenfield：`blockingDifferences=[]`；
- 三路均完成 Knowledge 成功、中止和 Provider 失败场景；
- 会话锁、原始文件锁、endpoint、Provider 和 Desktop 进程均正常清理。

最终质量门：

- 根目录 `bun run check:quick`：通过；
- 根目录 `bun run check`：Biome、root/CLI/Desktop/Admin 类型检查和质量守卫全部通过。

## 明确未修改

- 没有删除或替换 Legacy Backend；
- 没有改变 Desktop、CLI、RPC、IM 的 Runtime 选择、默认值或 fallback；
- 没有改变旧会话迁移策略；
- 没有改变旧 JSONL 的识别、列举、历史投影、重命名、删除和容错行为；
- 没有改变 Tool、Prompt、Skill、MCP、Knowledge 或模型调用行为；
- 没有把旧格式知识下沉到 `runtime-core`。

## 结果

Legacy 兼容现在形成两个独立适配器边界：格式兼容可以离线工作，执行兼容才允许接触旧
`AgentSession`。Desktop Composition Root 仍同时支持旧格式和旧执行，但二者不能再通过一个对象或
文件静默耦合。

## 下一步

第 127 轮应先审计 CLI 的 `unsupported-session-selection` 回退原因，判断 `--continue` 和
`--resume` 是否已经具备通过格式中立 Catalog/访问路由选择 Greenfield 会话的全部条件。只闭合已有
能力已经覆盖的入口；`legacy-session` 的处理策略仍涉及继续旧执行、迁移或只读保留的产品选择，不应
在未确认前删除 fallback。
