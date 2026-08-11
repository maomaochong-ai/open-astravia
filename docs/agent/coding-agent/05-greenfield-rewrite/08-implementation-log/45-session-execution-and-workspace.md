# 阶段 45：Session Execution 与 Workspace

## 目标

移除 RuntimeHost 对旧 Session 工作目录、streaming/bash 忙碌态和 `reconfigureCustomTools()` 的直接依赖，同时保持
执行模式切换、全局切换预检、prompt 前目录自愈及旧沙箱工具重建行为不变。

## 边界分析

直接把 `CreateAgentSessionOptions["customTools"]` 放进新 Port 会让核心合同继续依赖 coding-agent 的工具定义，只是移动
类型耦合。实际存在两个独立职责：

- Workspace View：只提供当前 Session 工作目录；目录创建、失败日志和 prompt 编排仍属于 RuntimeHost。
- Execution Controller：提供统一忙碌态和执行模式重配置；Legacy Adapter 才把语义模式翻译为旧 custom tools。

忙碌态放在 Execution Controller，而没有扩大基础 State Reader：它用于执行配置、插件配置和 agent mode 在 turn 边界
的互斥判断，不是对外 Session 状态投影。Workspace 也没有并入 Execution Controller，避免只读 cwd 与工具配置形成新的
巨型接口。

## 新增合同

```text
RuntimeSessionWorkspaceView
  └─ readWorkingDirectory()

RuntimeSessionExecutionController
  ├─ isBusy()
  └─ reconfigure(RuntimeExecutionModeUpdate)
```

`RuntimeExecutionModeUpdate` 只包含执行模式、sessionId 和三个宿主沙箱可执行文件路径，不包含 coding-agent
`ToolDefinition`、SessionManager 或 AgentSession。

## Legacy 适配

新增 `LegacyRuntimeSessionWorkspaceView`：

- 将工作目录读取映射到旧 `sessionManager.getCwd()`。

新增 `LegacyRuntimeSessionExecutionController`：

- `isBusy()` 保留 `isStreaming || isBashRunning` 语义；
- full-access 模式继续用 `undefined` 清除沙箱 custom tools；
- sandbox 模式继续按平台、cwd、宿主可执行文件路径和 sessionId 构造原有沙箱工具；
- 工作目录缺失时继续回退 `process.cwd()`；
- 旧 Session 不支持 `reconfigureCustomTools()` 时继续抛出相同 `INTERNAL_ERROR`。

RuntimeHost 不接触旧 custom tool 类型，Assembly 显式交付两个新 Port。

## RuntimeHost 迁移

- `setExecutionMode()` 先通过 Execution Controller 检查忙碌态，再提交语义化模式更新，成功后才更新 handle 状态。
- `setGlobalExecutionMode()` 继续先检查所有待切换 Session，确保有忙碌 Session 时不会部分切换。
- prompt 前目录自愈改为读取 Workspace View，仍使用递归 mkdir，并继续只记录错误、不阻断 prompt。
- 延迟插件重配置和 agent mode 切换改用统一 `isBusy()`，原 streaming/bash 延迟语义不变。
- RuntimeHost 已不存在对 `sessionManager.getCwd()`、`isStreaming/isBashRunning` 或
  `reconfigureCustomTools()` 的直接访问。

## 行为测试

新增 `session-execution.test.ts`，固定：

- Workspace View 到旧 SessionManager 的映射；
- 空闲、streaming、bash 三类忙碌态；
- full-access 到 `undefined` custom tools 的映射；
- sandbox 到平台沙箱工具列表的映射；
- 不支持动态工具重配置时的原错误合同。

Assembly 隔离测试进一步固定：

- prompt 从 Workspace View 读取 cwd，不回读旧 SessionManager；
- 在线执行模式切换只调用 Assembly 的 Execution Controller；
- 忙碌态阻止切换且不会提交部分重配置；
- 自定义 Assembly 不回退调用旧 `reconfigureCustomTools()`。

## TypeBox / Zod 判断

本阶段新增的是进程内组合根 Port，请求由 RuntimeHost 根据已经类型化的配置构造，不是 JSON、文件、IPC 或远端输入
边界，因此不引入 TypeBox/Zod。沙箱可执行文件路径的存在性与平台解析仍由原沙箱工具构造器负责；未来若这些配置从
外部协议直接进入，应在对应配置 Adapter 校验。

## 明确未修改

- 没有改变初次创建 Session 时 `customTools` 的组装方式；该参数仍属于当前 Legacy 创建合同。
- 没有改变沙箱工具名称、描述、schema、权限检查或执行实现。
- 没有改变 full-access/sandbox 默认值和公开 SessionFacade API。
- 没有改变忙碌态错误码、消息和 retryable 属性。
- 没有改变工作目录创建失败时继续 prompt 的行为。
- 没有迁移 todo、输入模式、插件配置、后台任务或子代理的具体操作。
- 没有修改 Greenfield Backend，也没有切换生产默认 Backend。

## 下一步分析

剩余旧 Session 直接依赖中，后台 bash 与 subagent 数量最多，而且 RuntimeHost 已把它们作为同一“后台工作”面板处理：
列举、终止和清除已结束任务都属于同一宿主能力。下一阶段建议先定义独立 `RuntimeSessionBackgroundWorkController`，使用
runtime-core 自己的 `BackgroundTaskInfo` / `SubagentInfo` 投影，并由 Legacy Adapter 转换旧 snapshot。

迁移前应固定联合清理计数、未知 session/task 的返回值、用户终止来源、列表复制和 subagent 中断语义。todo 与
steering/follow-up、plugin/agent mode 属于不同生命周期，不应顺手并入 Background Work Port。

## 验证

- Execution / Workspace 与 Assembly 定向测试：2 个文件，14/14 通过。
- Runtime Core 完整测试：16 个文件，80/80 通过。
- 根 `bun run check:quick`：通过。
- 根 `bun run check`：Lint、monorepo/desktop/admin 类型检查与全部质量守卫通过。
