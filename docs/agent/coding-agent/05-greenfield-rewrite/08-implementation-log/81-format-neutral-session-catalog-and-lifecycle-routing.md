# 第 81 轮：格式中立的会话目录与生命周期路由

## 1. 本轮目标

在不切换 Desktop 主对话 Runtime、不改变现有 IM 功能的前提下，让 Desktop 能同时识别 Legacy JSONL 与
Greenfield Conversation 文件，并把离线会话操作路由到正确的存储实现。

成功标准：

1. Session Catalog 不通过文件后缀猜测写操作归属，而由存储适配器显式声明。
2. Legacy 与 Greenfield 会话可以同时出现在同一 Desktop 会话列表。
3. Greenfield 会话继续使用现有 IM 只读 Viewer 打开，不被错误交给 Legacy 活动会话后端。
4. rename/delete 分别保留两种格式自己的写入、锁与附属文件语义。
5. 活动 Sidecar 持有 Greenfield ownership lease 时，Desktop 不得并发改名或删除。

## 2. 实施前审计结论

第 80 轮把 Greenfield IM Runtime 接入了 Sidecar 子进程，但 Desktop 主进程中的 `RuntimeHost` 仍固定使用
Legacy Session Backend。

现有产品链路还有两个重要事实：

- IM 会话点击后已经走 `readSessionHistoryFromFile` 驱动的只读 Viewer，不要求 Desktop 主 Runtime
  接管会话。
- 当前 Greenfield 产品组合只实现 `im-claw` RPC Profile，尚不具备 Desktop 主对话的完整交互能力。

因此，如果本轮仅让 Greenfield 文件进入列表，然后把它交给 Legacy `openSession` 或不完整的 Greenfield
Backend，会把架构重构变成功能回退。合理边界是：

```text
Desktop RuntimeHost
  ├─ 活动 Session Backend：Legacy（保持不变）
  └─ 离线 Session Services：Composite
      ├─ Legacy JSONL Catalog / History Reader
      └─ Greenfield Conversation Catalog / History Reader
```

“打开”在本轮指 IM 已有的只读 Viewer；“交互续跑”仍由 IM Sidecar 的 RPC Session 负责，不伪装成
Desktop 主进程已具备的能力。

## 3. 核心合同调整

`RuntimeSessionCatalog` 新增：

```ts
ownsSession(sessionPath: string): Promise<boolean>
```

`RuntimeSessionFileHistoryReader` 新增：

```ts
canRead(sessionPath: string): boolean
```

Runtime Core 新增两个格式中立的组合器：

- `CompositeRuntimeSessionCatalog`
- `CompositeRuntimeSessionFileHistoryReader`

组合器只负责：

- 合并 project/session 列表；
- 按绝对路径去重并按更新时间排序；
- 根据适配器声明的文件归属路由 rename/delete；
- 根据 reader 能力选择同步历史投影。

组合器不解析 Legacy 或 Greenfield 文件，也不持有具体仓储、锁或 schema。

## 4. Greenfield 存储适配器

`runtime-storage/conversation` 新增：

- `FileConversationRuntimeSessionCatalog`
- `FileConversationRuntimeSessionFileHistoryReader`

职责包括：

1. 扫描 `*.conversation.jsonl`。
2. 使用既有 TypeBox `ConversationFileHeaderSchema` 校验文件头。
3. 使用 `parseConversationFile` 和 `documentFromFile` 恢复 Conversation Document。
4. 使用 `projectConversationDocumentHistory` 生成既有 `HistoryEntry[]`。
5. 从投影生成既有 `SessionHistoryInfo`，不向 Desktop/Renderer 泄漏存储格式字段。
6. rename 复用 `FileConversationRepository.execute(session.name.set)`。
7. delete 同时清理 conversation、snapshot、单次写锁和进程级 ownership lock。

目录扫描会跳过损坏或不完整的 Greenfield 文件，避免一个坏文件阻断整个会话列表；直接读取具体坏文件仍会
返回明确错误。

### 4.1 锁语义

rename/delete 在操作前获取 `FileConversationOwnershipManager` lease：

- Sidecar 正在持有 `.owner.lock` 时，操作返回 ownership conflict。
- delete 在 lease 内继续获取单次 `.lock`，避免与 Repository 写入交错。
- 删除完成后依次释放单次写锁和 ownership lease。

这保留了第 77 轮定义的“活动 Session 只有一个进程所有者”，没有用 Desktop 的进程内 Session Handle
替代跨进程所有权。

### 4.2 cwd 兼容

当前 Greenfield `create()` 的 V2 文件头可能没有持久化 `cwd`。Catalog 优先使用 Document identity 的 cwd；
缺失时回退到宿主调用 `listSessions(cwd, sessionDir)` 时提供的 cwd。

这使现有 IM 文件可见，同时不在本轮修改 Conversation Repository 的创建合同。

## 5. Desktop 接线

Desktop `RuntimeHost` 仍以 `createLegacyRuntimeHostOptions()` 提供活动 Session Backend。

只替换两个离线服务：

```text
sessionCatalog
  = Composite(Legacy, Greenfield IM root)

sessionFileHistoryReader
  = Composite(Legacy, Greenfield)
```

Greenfield Catalog 只注册既有 `DEFAULT_IM_CONVERSATION_CWD` 和
`DEFAULT_IM_CONVERSATION_SESSION_DIR`，没有扩展到普通对话、项目、批量任务或定时任务。

## 6. TypeBox / Zod 判断

本轮存在外部持久化边界，但无需引入新校验库：

- Greenfield 文件头、事件和操作记录已经由 runtime-storage 的 TypeBox schema 校验。
- Legacy 文件归属只需要识别已有首行 `{ type: "session", cwd: string }` discriminator。
- 组合器接收的是 TypeScript 内部服务对象，不是外部 JSON 输入。

因此复用 TypeBox 是正确选择；再增加 Zod 或重复 schema 只会制造第二事实源。

## 7. 测试

新增或补充的门禁：

1. Runtime Core：
   - 合并多 Catalog 的 project/session 列表。
   - 按文件归属路由 rename/delete。
   - 按 `canRead` 路由同步历史读取。
   - Legacy 列表、历史、改名和删除行为继续通过。
2. Runtime Storage：
   - Greenfield 列表、首条消息、末条预览与历史投影。
   - 损坏的相邻 conversation 文件不阻断目录。
   - rename 持久化到 Conversation Document。
   - delete 清理 conversation、snapshot、`.lock` 与 `.owner.lock`。
   - 活动 ownership lease 阻止 rename/delete，释放后可以删除。
3. 类型与质量：
   - 根 `tsgo --noEmit`。
   - Desktop 独立 `tsc --noEmit`。
   - `check:quick` 与完整 `check`。

## 8. 明确未修改

- Desktop 活动 Session Backend 仍是 Legacy。
- 没有把 Greenfield IM 文件交给 Legacy `SessionManager.open()`。
- 没有宣称 Desktop 已支持 Greenfield 交互续跑。
- 没有改变 IM Sidecar 的 fresh/resume、Provider、Tool Loop、Prompt、Skill、MCP 或 Memory 行为。
- 没有改变 `SessionHistoryInfo`、Preload IPC 或 Renderer Store 的数据形状。
- 没有切换 `greenfield-im` 的默认值。

## 9. 下一步

下一阶段不应继续扩展文件格式适配器，而应补齐“活动会话能力声明与宿主选择”：

1. 定义宿主可观察的 Session Backend capability，区分只读查看、RPC 续跑和 Desktop 交互编辑。
2. 为 Greenfield 实现完整 Desktop Profile 前，保持 IM 列表项只读打开。
3. 完整 Profile 达到 Legacy 差分门禁后，再让 Desktop Composition Root 根据 capability 选择活动 Backend。
4. 使用真实 Sidecar crash/restart 场景验证 owner lease 回收、目录刷新、fallback 与会话继续执行。

只有这些门禁完成后，才适合讨论把 Greenfield 会话从 Viewer 提升为 Desktop 主进程可交互会话。
