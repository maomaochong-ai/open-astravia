# 第 67 轮：Session-local Todo Runtime 纵向切片

## 目标

第 66 轮只把外部 Todo 状态接入 Continuation Policy，明确留下了一个架构风险：

```text
Todo Tool
Todo Continuation
Scene Prompt
Session Todo Controller
Todo persistence / resume
```

如果这些入口分别创建或维护状态，就会出现同一 Session 内的两份 TodoStore。本轮完成一条完整纵向
切片，使上述入口共享同一个 Session-local `CodingAgentTodoRuntime`，同时保持旧 Todo 功能和文案。

## 既有行为基线

本轮保留以下旧行为：

- 工具名、label、description、TypeBox 参数 Schema、scope 和 `agent-control` category 不变。
- `create` 仍拒绝空 items、锁定列表和已有计划上的追加。
- 锁定 Scene 列表仍强制按 ID 顺序更新，普通列表仍允许自由调整顺序。
- `list` 的图标、编号、进度统计和全部用户可见文本不变。
- 锁定列表不能 `clear`；空列表和成功清空的返回值不变。
- `todo_snapshot` 同时兼容旧 `TodoItem[]` 和带 `lockedBy` 的 envelope。
- RuntimeHost 的 Todo Controller 仍返回副本，锁定或空列表时 `clear()` 返回 `false`。
- 显式 Tool 激活只在包含 `todo` 时暴露；普通 `cli` scope 默认包含 Todo。

## 架构

### 1. 每个 Session 只有一个 Todo Runtime

CLI Composition Root 在 `createResources()` 内创建：

```text
CodingAgentTodoRuntime
  ├─ TodoStore
  ├─ Runtime Tool registration
  ├─ Todo Continuation state
  ├─ Prompt Scene TodoStore
  ├─ RuntimeSessionTodoController
  └─ Conversation Document participant
```

`createTodoContinuationState` 被收敛为 `createTodoRuntime`。调用方若需要注入测试或宿主实现，必须交付
完整的 Session-local Runtime，不能再只替换 Continuation 的局部状态。

`createPromptResourceResolver(sessionOptions, todoRuntime)` 同时取得该 Runtime；Scene resolver 可明确使用
`todoRuntime.getTodoStore()`，不会再自行创建另一份 Store。

### 2. Runtime Core 只提供通用文档参与者

Runtime Core 新增：

```text
GreenfieldRuntimeDocumentParticipant
  initialize(document, context)
  onDocumentChanged(document)
  onSessionEvent?(event)
  dispose?()
```

Participant 只能通过 `appendCustomEntry()` 写入通用 custom entry。Runtime Core 不导入
`TodoStore`、`TodoSnapshot` 或 `todo_snapshot`，也不解析产品状态。

会话在以下位置同步 participant：

- create/resume 完成后的初始 Conversation Document；
- branch select、delete、replace、rename 和 custom append 后的新文档；
- 已持久化 Session Event 的安全观察点；
- Session dispose。

Greenfield Core Assembly 交付同一个 Todo Runtime 的 `RuntimeSessionTodoController`；没有产品实现的通用
Greenfield Factory 不交付该可选 Port，不用空实现伪造 Todo 能力。

### 3. 通用 `custom.append` 文档命令

Conversation Document 增加业务无关的：

```text
custom.append {
  entryId
  customType
  data?
  timestamp
}
```

命令把 custom entry 接到当前活动 leaf，并推进 document revision。Runtime Storage 的 TypeBox record
Schema、读取完整性校验和 JSONL replay 同时支持该命令。

Todo 快照因此继续属于活动分支，而不是写入第二个 sidecar 文件。分支切换后，Todo Runtime 从所选
branch 的最后一个有效 `todo_snapshot` 恢复状态；没有快照的分支恢复为空列表。

### 4. Tool 执行与持久化时序

最初实现让 Tool 在 `TodoStore` mutation 后立即写 Conversation Document。真实 Tool Loop 测试证明，
Agent Core 可能已经把 Assistant/Tool Result 事件交给 Repository、但 Session projection 尚在事件
回调链中；此时并行 document command 会与消息 revision 冲突。

最终实现不放宽 optimistic revision，也不吞掉冲突，而是在已持久化事件的安全点串行写快照：

```text
Todo mutation during active Turn
  -> capture immutable snapshot
  -> toolResult message persisted and projected
  -> participant onSessionEvent(toolResult)
  -> append todo_snapshot
```

非 Tool mutation（例如 Continuation 期间的宿主状态变化）最迟在
`turn.completed / turn.cancelled / turn.failed` 后持久化。Turn 外的 Scene/Controller mutation 仍立即
排队，Prompt Adapter 在启动 Turn 前 `flush()`，Session dispose 也会等待最后一次写入。

该设计既避免 Revision 竞争，也不会把 Todo 写入移到独立存储。

### 5. TypeBox 存储边界

Todo Runtime 使用 TypeBox 校验从 `ConversationDocumentCustomEntry.data` 读取的快照：

- plain `TodoItem[]`；
- `{ items, lockedBy: "scene" | null }`。

损坏的最新快照会以明确的 entry ID 失败，不会通过类型断言把任意 JSON 注入 TodoStore。类型校验只放
在不可信持久化数据进入产品状态的边界，没有给内部已类型化调用重复增加校验。

### 6. Fork 保留 custom branch

原 Greenfield fork 只复制 Kernel Event。若事件 parent 指向 custom entry，目标文件会出现悬空 parent。

Runtime Storage 现在按原文件顺序复制所选 branch 上的 `custom.append` operation，重新计算目标
document revision，并在需要时先选择正确 parent。Todo 快照和其他通用 custom 状态因此能随 fork
重放，未把 fork 逻辑绑定到 Todo 类型。

## 实施内容

### Runtime Core

- Conversation Document 新增 `custom.append`。
- Greenfield Assembly/Resources 支持 Document Participants 和 Todo Controller。
- Session Backend 初始化、通知和释放 participants。
- Event Sink 在已持久化 Session Event 后通知 participant。
- Document projection 可用事实来源的较新 journal 自愈，但拒绝倒退文档。

### Runtime Storage

- TypeBox Schema 接受 `custom.append` operation。
- 文件解析器把 custom entry ID 纳入 parent/duplicate 完整性检查。
- fork 复制并重放活动分支上的 custom operations。

### Coding Agent

- 新增 `CodingAgentTodoRuntime`。
- Runtime Tool 继续复用旧 `createTodoTool()` 的完整业务实现，仅增加安全 flush。
- Todo snapshot 使用 TypeBox 校验。
- Runtime 同时实现 Continuation 最小状态和 Session Todo Controller。
- Greenfield 公共入口导出 Todo Runtime、Tool Registration 和 Feature。

### CLI Composition Root

- 每个 Session 创建或注入一个 Todo Runtime。
- Todo Tool 作为 Session Feature 按既有 activation 规则加入 Profile。
- Model Call Composer 的 available tools 和 Session active tool names 包含同一 Todo Tool。
- Prompt resolver、Continuation、Document Participant、Controller 和 dispose 共享同一实例。

## 测试

### Runtime Core

```text
bunx vitest --run \
  test/conversation/commands.test.ts \
  test/conversation/custom-entry-command.test.ts \
  test/runtime-host/greenfield-session-backend.test.ts \
  test/runtime-host/greenfield-session-capabilities.test.ts
```

结果：`4 files / 18 tests passed`。

### Runtime Storage

```text
bunx vitest --run \
  test/conversation/file-conversation-repository.test.ts \
  test/conversation/custom-entry-persistence.test.ts \
  test/conversation/greenfield-session-projection.test.ts \
  test/conversation/context-records.test.ts \
  test/conversation/turn-recovery.test.ts
```

结果：`5 files / 24 tests passed`。

覆盖 custom command 重放、parent 校验、关闭后重新打开、fork 保留 Todo custom entry，以及既有
Conversation V2 行为。

### Coding Agent

```text
bunx vitest --run \
  test/runtime-core/greenfield-todo-runtime.test.ts \
  test/runtime-core/greenfield-continuation-orchestrator.test.ts \
  test/runtime-core/greenfield-prompt-resource-resolver.test.ts \
  test/runtime-core/greenfield-tool-adapter.test.ts
```

结果：`4 files / 12 tests passed`。

覆盖同一 Store 的 Tool/Persistence/Controller、分支恢复、非法快照拒绝、Continuation 优先级和
Scene resolver 继续使用 Session TodoStore。

额外运行旧 `test/tools.test.ts` 时，52 项中 46 项通过，6 项为本轮未触碰的 Windows/现有基线问题：
Photon 测试图解码、DOCX 旧文案断言、POSIX `export`、CRLF、shell discovery guard 和 Windows 路径分隔
符。本轮没有为通过无关测试而修改旧工具功能。

### CLI Greenfield 集成

```text
bunx vitest --run \
  test/greenfield-runtime-composition.test.ts \
  test/greenfield-plugin-runtime.test.ts \
  test/greenfield-plugin-tool-runtime.test.ts \
  test/greenfield-continuation-orchestrator.test.ts \
  test/greenfield-todo-runtime.test.ts
```

结果：`5 files / 15 tests passed`。

真实 Tool Loop 验证：

```text
todo(create)
  -> toolResult
  -> todo(update done)
  -> toolResult
  -> normal stop
  -> dispose
  -> resume
  -> Controller 读取 done
  -> clear
  -> dispose
  -> resume
  -> 空列表
```

同时验证显式 activation 的模型工具列表始终只有 `todo`，Plugin、MCP、动态 Registry 和既有
Continuation 集成没有回归。

### 类型与质量门禁

实施中持续通过：

```text
bun run check:quick
bunx tsgo --noEmit
bunx tsc --noEmit -p packages/cli-app/tsconfig.json
```

最终完整 `bun run check` 通过：Biome、根 monorepo `tsgo`、CLI 独立类型检查、Desktop `tsc`、
Admin `tsc -b` 和质量 guards 均为 `exit 0`。

## 明确未实施

- 未修改旧 `AgentSession` / `SessionManager` 的默认生产路径。
- 未重写 Todo 的业务规则、工具文案或 description.txt 来源。
- 未把 Todo 类型加入 Runtime Core 或 Runtime Storage。
- 未把 TodoStore 放入进程级共享 Tool Registry。
- 未切换 Desktop/RuntimeHost 默认后端。
- 未在本轮接入真实 Ecosystem Hook Runtime。

## 下一步

下一阶段应完成真实 Ecosystem Hook Runtime 的 Session-local 组合：

```text
Hook discovery/config
  -> Session Hook Runtime
  -> Stop Hook continuation source
  -> Tool lifecycle hooks
  -> SessionEnd / dispose
```

重点仍是使用一个 Session-local Hook Runtime 同时服务 Prompt、Tool、Continuation 和生命周期，不再
增加仅为某个调用点存在的局部 bridge。完成后再评估 Greenfield Backend 到 RuntimeHost 默认生产入口
还缺失的外围 Port。
