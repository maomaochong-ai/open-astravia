# 第 87 轮：RuntimeHost Greenfield Backend 与 Catalog 路由

## 1. 本轮目标

第 86 轮已经让 Greenfield Session 交付完整 RuntimeHost Assembly，但 Desktop Candidate
仍绕过 RuntimeHost，直接调用 Greenfield Backend。本轮完成宿主接入前的组合边界：

1. 建立 `RuntimeHostSessionBackend` 到 Greenfield Composition 的正式适配器。
2. 按持久化格式归属路由既有会话，禁止未知格式回退到默认 Backend。
3. 补齐 RuntimeHost 创建请求与 Greenfield 会话参数的等价映射。
4. 对未接线能力和组合根配置冲突执行 fail-closed，不静默忽略参数。
5. 让 Desktop Candidate 真实经过 `RuntimeHost` 创建和恢复会话。
6. 保持 Desktop 生产 `runtime.ts` 的 Legacy 默认 Backend 不变。

## 2. 架构结论

RuntimeHost 不应识别 Legacy 或 Greenfield 会话实现，也不应根据文件后缀猜测格式。新的调用链是：

```text
Desktop Candidate
  └─ RuntimeHost
      └─ CatalogRoutedRuntimeHostSessionBackend
          ├─ new session -> explicit default backend
          └─ existing path -> first owning RuntimeSessionCatalog
              └─ GreenfieldRuntimeHostSessionBackend
                  └─ GreenfieldRuntimeComposition.backend
```

这里有两个不同职责：

- Catalog 只判断一个既有路径是否属于某种持久化格式。
- Backend 只把 RuntimeHost 请求适配为该实现的 Session，并交付完整 Assembly。

既有路径没有任何 Catalog 认领时直接失败。不能回退到默认 Backend，否则 Greenfield 可能误读
Legacy 文件，或 Legacy 误读 Greenfield 文件。

## 3. Catalog 路由 Backend

`runtime-core` 新增 `CatalogRoutedRuntimeHostSessionBackend`：

- 没有 `sessionPath` 的新会话使用显式 `defaultBackend`。
- 有 `sessionPath` 的恢复请求按 routes 顺序查询 `RuntimeSessionCatalog.ownsSession()`。
- 第一个认领路径的 Catalog 决定 Backend。
- 没有 Catalog 认领时抛错，不猜测、不降级。
- Runtime Core 只依赖已有 Catalog 和 Backend Port，不依赖文件系统或具体编码格式。

这使“新会话默认实现”和“既有会话格式归属”成为两个独立决策，后续可同时挂载 Legacy 与
Greenfield，而不把格式判断写入 RuntimeHost。

## 4. Greenfield RuntimeHost Session Backend

`cli-app` 新增 `GreenfieldRuntimeHostSessionBackend`，负责：

- 新会话生成 Greenfield Session ID。
- 恢复时从 canonical conversation path 解析 Session ID。
- 调用 Greenfield Backend 的 `create()` 或 `resume()`。
- 通过 `assessRuntimeHostSessionAssembly()` 检查完整 Port。
- Assembly 不完整时先释放 Session，再报告缺失 Port。
- RuntimeHost 释放 lifecycle 时同步清理适配器持有的 Session 与 Assessment。

适配器只保存 Candidate/诊断需要的活动 Session 引用，不复制 Session 状态，也不创建第二套生命周期。

## 5. 请求参数等价与 fail-closed

本轮补齐以下会话级参数：

- `model`
- `thinkingLevel`
- `agentMode`
- `executionMode`
- `env`
- `enableBackgroundTasks`
- `includeAgentSkills`
- sandbox 可执行路径
- `appendSystemPrompt`

其中模型和思考等级现在可按 Session 初始化，不再只能读取 Composition 的固定默认值。
`includeAgentSkills` 进入 Session-local Resource Loader；关闭后台任务时，`task_output`、
`task_stop` 和 `bg-tasks` 能力不会进入该 Session 的模型调用工具面或状态投影。

以下配置属于 Composition 固定边界，RuntimeHost 请求不一致时拒绝：

- `cwd`
- `sessionDir`
- `agentDir`
- `scenario`
- `enableSubagents`
- `serverUrl`

以下宿主能力尚未完成 Greenfield 接线，因此显式拒绝：

- Agent Plugin 配置
- Plugin Tool invoker
- Plugin Continuation invoker
- Plugin System Prompt invoker
- Ask User Question capability

这些参数不能被静默忽略。后续只有完成真实适配和差分测试后，才能从拒绝列表移除。

## 6. Desktop Candidate

Desktop Candidate 现在会：

1. 创建 Greenfield Composition。
2. 创建 Greenfield 文件 Catalog。
3. 创建 Greenfield RuntimeHost Backend。
4. 使用 Catalog 路由 Backend 组装真实 RuntimeHost。
5. 通过 `RuntimeHost.createSession()` 创建或恢复会话。
6. 通过 `RuntimeHost.disposeSession()` 和 `disposeAllSessions()` 释放会话。

Candidate 的 Subagent 设置必须符合 RuntimeHost 的场景策略：

- `conversation`、`project`、`cli` 启用。
- 其他场景关闭。
- 调用方显式传入冲突设置时直接失败。

Desktop 的生产组合根没有修改，仍使用 Legacy Backend。本轮不是默认后端切换。

## 7. 测试

本轮新增或调整测试覆盖：

1. 新会话路由到显式默认 Backend。
2. 既有会话路由到认领该格式的 Catalog/Backend。
3. 未知格式既有路径拒绝回退。
4. 真实 RuntimeHost 创建 Greenfield Session。
5. 模型、思考等级、执行模式与场景映射。
6. 关闭后台任务后工具面不再包含后台任务控制工具。
7. RuntimeHost 释放后适配器活动引用同步清理。
8. 通过 canonical Greenfield 路径恢复同一 Session。
9. cwd 冲突、Plugin 和 Ask User Question fail-closed。
10. Desktop Candidate 通过真实 RuntimeHost 创建、释放和恢复。
11. Desktop Candidate 拒绝 workspace 冲突与未知持久化格式。
12. 既有 Greenfield 动态工具、Prompt、MCP、持久化和完整 Assembly 测试继续通过。

Desktop Vitest 增加了本次真实源码组合所需的 workspace source aliases，避免测试误用旧 `dist`
导致同一 Feature 的源码/产物双实例。

## 8. 明确未修改

- 没有切换 Desktop 生产默认 Backend。
- 没有删除 Legacy Backend 或 Legacy Session 文件支持。
- 没有改变已有工具名称、描述、Schema 或执行语义。
- 没有用文件后缀代替 Catalog 格式认领。
- 没有为 Plugin 或 Ask User Question 添加 no-op。
- 没有实现根会话恢复后的 Subagent Coordinator 重建。

## 9. 下一步

下一阶段应完成“进程重启后的可恢复工作状态”，作为正式 Desktop opt-in 前的最后一类核心缺口：

1. 为父 Session 持久化可重建的 Subagent 索引，而不是扫描目录猜测 ownership。
2. 定义进程退出时 pending、queued、running 子代理恢复后的确定状态。
3. 恢复 completed、failed、interrupted 子代理的 transcript、generation 和通知消费状态。
4. 验证恢复后 `list_agents`、`wait_agent`、`followup_task`、`interrupt_agent` 的行为。
5. 对损坏、缺失或被用户删除的子会话文件执行 fail-closed 降级。

完成这一阶段后，再实现 Desktop 显式 Greenfield opt-in 与 Legacy fallback 的产品级切换门禁。
