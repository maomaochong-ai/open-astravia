# 第 129 轮：Extension Execution Host 合同与 Legacy 适配

## 目标

把旧 Extension 的命令式运行时能力从 `ExtensionRunner` 和具体 `AgentSession` 中抽成显式宿主合同，
同时保证现有 Extension 行为不变：

- 合同不暴露 `AgentSession`、`SessionManager` 或 UI；
- Loader 创建的共享 `ExtensionRuntime` 继续原位绑定；
- Legacy 实现继续提供全部命令式动作和 Context 动作；
- Greenfield 尚不能等价实现的语义继续触发 Legacy 回退。

## 实施前审计

Extension factory 可以保存传入的 `ExtensionAPI`，在加载结束后的定时器、Tool 或事件闭包中继续调用。
因此不能为新 Runtime 创建另一个 API 对象；宿主必须更新 Loader 创建的同一个共享 Runtime。

旧命令式表面包含 13 个动作：

1. `sendMessage`、`sendUserMessage`；
2. `appendEntry`、`setSessionName`、`getSessionName`、`setLabel`；
3. `getActiveTools`、`getAllTools`、`setActiveTools`、`getCommands`；
4. `setModel`、`getThinkingLevel`、`setThinkingLevel`。

事件和 Tool Context 还需要 8 个动态动作：当前模型、空闲状态、中止、待处理消息、关闭、上下文用量、
压缩和系统提示词。

审计同时确认，现有 Greenfield `appendSessionContext` 不能直接替代旧 `sendMessage`：

- `steer` 必须在当前 Tool Loop 的下一次模型调用可见；
- `followUp` 必须进入当前 Turn 结束后的队列；
- `nextTurn` 必须只在下一次用户 Turn 生效；
- 空闲且 `triggerTurn=false` 时只持久化，不启动模型；
- 空闲且 `triggerTurn=true` 时需要立即启动一次模型 Turn。

直接把这些情况统一映射成 context append 或 continuation 会改变模型可见时序，因此本轮不进行
Greenfield 切换。

## 实施

### 1. 独立 Execution Host 合同

新增 `ExtensionExecutionHost`：

```text
ExtensionExecutionHost
├─ actions: ExtensionActions
└─ contextActions: ExtensionContextActions
```

合同只描述动作，不携带具体会话对象。`bindExtensionRuntimeActions` 显式覆盖全部 13 个动作，并保留
`flagValues`、`pendingProviderRegistrations` 和共享 Runtime 对象身份。

### 2. Runner 改为消费 Host

`ExtensionRunner.bindExecutionHost()` 成为新的宿主绑定入口：

- 命令式动作交给 `bindExtensionRuntimeActions`；
- Context 动作仍以调用时读取的函数绑定；
- Provider pending 注册的既有处理顺序保持不变。

旧 `bindCore(actions, contextActions)` 保留并委托新入口，避免改变已有公共调用方式。

### 3. Legacy 等价适配

`createLegacyExtensionExecutionHost()` 集中承载旧实现：

- 自定义消息和用户消息继续调用 `AgentSession`，Promise 拒绝继续进入
  `ExtensionRunner.emitError`；
- 自定义 Entry、会话名和 Label 继续写 `SessionManager`；
- Tool、Command、模型、Thinking、Compaction 和 Context 状态继续使用原事实源；
- `bindExtensionCore()` 只负责组合并绑定，不再内联宿主合同。

### 4. 公开边界

`ExtensionExecutionHost` 与 `bindExtensionRuntimeActions` 从 Coding Agent 公开入口导出，后续
Greenfield Adapter 可以只依赖这个合同，不需要依赖 Legacy Session 类型。

### 5. Schema 选择

本轮没有引入 TypeBox 或 Zod。Execution Host 是进程内 TypeScript 函数合同，不接收外部 JSON、
配置文件或网络数据；运行时 Schema 不会增加边界安全性。

## 测试

新增 `extension-execution-host.test.ts`，覆盖：

- 13 个命令式动作全部原位绑定；
- Loader 的 Flag 与 pending Provider 状态不丢失；
- Runner 的动态 Context 动作通过 Host 生效；
- Legacy 自定义 Entry、会话名、Label 和 Tool 状态映射；
- Legacy `sendMessage` 的异步拒绝仍以 `send_message` Extension 错误上报。

针对性测试：

- `extension-execution-host.test.ts`：3 项通过；
- `extensions-runner.test.ts`：20 项通过；
- 合计：2 个文件，23 项通过。

质量门：

- 根目录 `bun run check:quick`：通过；
- 根目录 `bun run check`：Biome、根/CLI/Desktop/Admin 类型检查和质量守卫全部通过。

## 明确未修改

- 没有移除 `opaque-runtime-api`；
- 没有放行任何旧 Extension 进入 Greenfield；
- 没有改变 Tool、事件、Command、Shortcut、Renderer 或 UI 行为；
- 没有伪造 `SessionManager` 或 UI Context；
- 没有改变 Provider/Flag 的启动时序；
- 没有改变 Session 持久化格式或模型调用输入。

## 结果

Extension 的命令式能力现在有了独立宿主边界，Legacy 只是该边界的一个真实实现。
这一步消除了“Runner 自己复制 Runtime 动作、Session Binding 同时定义宿主行为”的双重职责，
但不会以不等价适配换取提前切换。

`opaque-runtime-api` 仍然是实际缺口，而不是临时特判。

## 下一步

第 130 轮应完成 Greenfield Extension Action Host 的完整纵向切片：

1. 先定义并实现自定义消息的 `steer`、`followUp`、`nextTurn`、空闲持久化和触发 Turn 合同；
2. 补齐自定义 Entry、会话名、Label 的 Runtime-owned 写端口；
3. 映射模型、Thinking、动态 Tool、Command、Context Usage、Compaction 和系统提示词；
4. 通过 Legacy/Greenfield 差分测试验证调用时序、错误和持久化结果；
5. 只有全部命令式 API 等价后，才对无 Event/Tool/Command/Shortcut/Renderer 的 Extension
   消除 `opaque-runtime-api` 缺口；其他注册能力继续按各自 capability 回退。
