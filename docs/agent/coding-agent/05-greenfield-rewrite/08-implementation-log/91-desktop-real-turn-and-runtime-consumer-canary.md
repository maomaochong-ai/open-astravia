# 第 91 轮：Desktop 真实回合与 Runtime 消费者 Canary

## 1. 目标

第 90 轮证明 Desktop 可以在保持默认 Legacy 的前提下显式选择 Greenfield，并完成
Session 创建、恢复和销毁。但此前的 Desktop 差分测试没有调用真实 `prompt()`，也没有
验证 Plugin、用户提问、Scheduler 和 Batch 对共享 `RuntimeHost` 的消费合同。

本轮作为一个阶段完成：

1. 复用既有本地 Provider Fixture，执行 Legacy/Greenfield 真实 Tool Loop 差分。
2. 验证 Tool 结果进入第二次模型调用，并在会话恢复后保留等价消息。
3. 验证 Desktop Backend Pool 透传 Plugin 与用户提问动态能力。
4. 验证 Interactive、Automation、Batch 在一个 RuntimeHost 中隔离所有权。
5. 为 Scheduler 和 Batch 增加 RuntimeHost 消费合同测试。
6. 在生产组合根记录选中的 Backend，不记录用户内容或凭据。

## 2. 关键判断

### 2.1 不新增测试专用 RuntimeHost 合同

真实回合需要确定性模型响应，但没有把 `streamFn` 或其他测试字段加入
`RuntimeSessionCreateRequest`。

Desktop 测试直接复用第 79 轮已经建立的本地 OpenAI Responses Fixture。Legacy 和
Greenfield 使用同一个 Provider 协议输入，避免测试绕过真正的模型调用和 Tool Loop。

### 2.2 差分比较语义，不比较内部文件

两个实现允许使用不同的：

- Session ID、Event ID 和时间戳；
- 流式 Delta 分块；
- 文件格式和锁文件名称；
- 内部 Entry 标识。

本轮比较：

- 生命周期里程碑顺序；
- Tool 名称与成功状态；
- 最终 Assistant 文本；
- 消息角色序列；
- Tool 结果是否进入第二次 Provider 请求；
- 销毁并恢复后的消息投影。

### 2.3 Scheduler 和 Batch 只消费 RuntimeHost

执行器测试在它们已有的 `RuntimeHost` 参数边界注入受控 Host，没有把 Scheduler、Batch
存储、IPC 或通知逻辑下沉进 Runtime Core。

测试明确验证执行器不会销毁共享 Session。交互会话、自动化和批处理的所有权仍由唯一的
进程级 RuntimeHost 管理。

## 3. 真实 Provider Tool Loop 差分

扩展：

- `desktop-runtime-host-differential.test.ts`

真实场景：

```text
user prompt
  -> Provider 请求 read 工具
  -> Runtime 执行 read
  -> Tool Result 进入第二次 Provider 请求
  -> Provider 返回最终文本
  -> Session 持久化
  -> dispose + resume
```

Legacy 和 Greenfield 得到相同语义观察结果：

```text
created
agent_start
turn_start
turn_end
turn_start
turn_end
agent_end
```

最终消息角色均为：

```text
user -> assistant(tool call) -> toolResult -> assistant
```

同一测试还分别在 Legacy 和 Greenfield 的单个 RuntimeHost 中同时创建：

- `conversation`；
- `automation`；
- `batch`。

三类 Session ID 与持久化路径互不重复；销毁 Automation Session 不影响另外两个 Session。

## 4. Desktop 动态能力门禁

新增：

- `desktop-runtime-host-capabilities.test.ts`

覆盖：

1. Plugin System Prompt 进入模型调用。
2. Plugin Tool 进入工具面并通过 Desktop Host Invoker 执行。
3. Plugin Continuation 触发后续模型调用。
4. `reconfigureAgentPlugins(undefined)` 后，同一 Session 的后续调用移除 Plugin Prompt 和 Tool。
5. `ask_user_question` 通过 Desktop Host Handler 执行。
6. `setUserQuestionHandler(undefined)` 后，同一 Session 的后续调用移除提问工具。

这些测试验证 Desktop Backend Pool 的请求透传，不重复实现 Plugin 或用户提问业务。
Todo、后台命令和 Subagent 的内部执行、终止与恢复继续由既有 Greenfield Composition
定向测试负责；Desktop 在本轮通过三类 Scenario 共存和执行器参数门禁验证宿主策略。

## 5. Scheduler 消费合同

新增：

- `scheduler/task-executor.test.ts`

验证：

- 创建 `automation` Scenario；
- 使用默认对话 Session Directory；
- 透传 Execution Mode、Model Key 和 Skill Ref；
- 映射 Message、Tool 和 Lifecycle 事件；
- 只写一次终态 Metadata 和 Last Run 状态；
- Agent End 后解除订阅；
- 不销毁共享 RuntimeHost Session。

## 6. Batch 消费合同

新增：

- `batch-tasks/batch-task-executor.test.ts`

验证：

- 创建 `batch` Scenario；
- 保留任务 System Prompt、私有临时目录环境变量和 `enableBackgroundTasks: false`；
- 透传 Model Key 和 Scene Ref；
- 只保存 `running -> completed` 两个状态；
- 完成后释放执行器自己的运行记录，但不销毁共享 Session；
- 保持既有进程内 Paused Session Resume 行为，不重新创建 Session。

没有改变应用重启后将 stale running task 标记为 failed 的旧行为。

## 7. 生产诊断

`runtime.ts` 在组合根完成 selector 解析后记录：

```text
agent backend selected: legacy
agent backend selected: greenfield
```

日志只包含实现选择，不包含：

- Prompt、模型回复或 Tool 参数；
- API Key、Token 或 Cookie；
- CWD、Session Path 或用户文件内容。

没有把 Electron Logger 引入 Backend Pool。Backend Pool 继续保持可在纯 Node 测试中使用
的组合模块，避免为了诊断重新绑定宿主环境。

## 8. 类型与测试门禁

新增 Scheduler/Batch Mock 后，Vitest 运行可以通过，但 Desktop 独立 `tsc` 发现：

- Mock 函数没有声明参数，导致调用记录被推导为零长度 Tuple；
- 测试事件使用了非法的 `source: "runtime"`。

已分别改为带真实参数类型的 Mock，并使用合同允许的 `source: "runtime-core"`。

定向执行：

```text
cd packages/desktop-app
bunx vitest --run \
  src/main/greenfield-runtime/desktop-runtime-host-differential.test.ts \
  src/main/greenfield-runtime/desktop-runtime-host-capabilities.test.ts \
  src/main/greenfield-runtime/desktop-greenfield-runtime-backend-pool.test.ts \
  src/main/scheduler/task-executor.test.ts \
  src/main/batch-tasks/batch-task-executor.test.ts
```

结果：

- 5 个测试文件通过；
- 14 个测试通过；
- 真实 Legacy/Greenfield Provider Tool Loop 完成两次 Provider 请求；
- Desktop 独立 `tsc --noEmit` 通过；
- `bun run check:quick` 通过；
- 根目录完整 `bun run check` 通过，包含 Biome、monorepo `tsgo`、CLI 类型检查、
  Desktop 独立 `tsc`、Admin project build 和全部 quality guards。

## 9. 明确未修改

- 默认 Backend 仍是 Legacy。
- 没有增加 UI 设置入口。
- 没有增加自动 fallback。
- 没有改变 Tool、Plugin、用户提问、Scheduler 或 Batch 功能语义。
- 没有修改 RuntimeHost 公共合同。
- 没有迁移或改写 Legacy/Greenfield 会话文件。
- 没有改变 Batch 跨进程恢复策略。

## 10. 下一步

下一阶段应进入“独立可执行产物与 Desktop 进程 Canary”：

1. 在开发隔离入口中分别以 Legacy/Greenfield 启动 Desktop。
2. 执行真实交互消息、停止、恢复和应用退出。
3. 验证 Scheduler/Batch 与交互 Session 在实际主进程中的共存。
4. 验证打包产物包含 Greenfield 所需模块和资源。
5. 收集不含敏感信息的启动后端、失败阶段和资源释放诊断。
6. 完成可执行产物门禁后，再决定是否暴露用户可见的 Greenfield opt-in。
