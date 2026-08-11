# 后台命令 Service Port、Runtime 协调与 Task Tools

## 目标

在不改变后台命令功能的前提下，把 `run_in_background`、前台软等待自动提升、完成通知以及
`task_output/task_stop` 的 Tool 行为迁入 Runtime，同时避免 Runtime 直接依赖
`BackgroundTaskManager`。

## 修改范围

- 新增 `BackgroundCommandService` Port，覆盖 spawn、wait、事件、通知、输出、stop 和 dispose。
- 新增 Runtime `BackgroundCommandExecutor`，组合独立前台执行器与后台 Service。
- 提取命令 spawn context 和受保护目录快照为前后台共享行为模块。
- 新增 Runtime `task-output`、`task-stop` 独立工具目录和 TypeScript description。
- 两个 task 工具使用 TypeBox Schema，并以 `requires: ["bg-tasks"]` 注册。
- coding-agent Host Adapter 将 Service Port 映射到旧 `BackgroundTaskManager`。
- CLI 过渡 Composition Root 默认装配后台 Service、task 工具和 `bg-tasks` capability。
- Tool Profile 差分加入旧、新 task 工具。

## 当前责任边界

```text
Runtime Tools
  BackgroundCommandExecutor
    -> explicit background result
    -> soft wait / auto promotion
    -> update and completed-result formatting
    -> notification formatting
  task_output / task_stop
    -> TypeBox schema / result / error / registration
  BackgroundCommandService Port

coding-agent Host Adapter
  BackgroundTaskManager
    -> process spawn and tree kill
    -> task state and output log
    -> read cursor and notification timing
```

本轮迁移了协调层与 Tool 层，没有把旧 Manager 伪装成 Runtime 内核。Runtime 源码只看到
Service Port；Adapter 是当前过渡实现。后续可在不修改 Tool 定义和命令结果合同的情况下替换
底层任务引擎。

## 行为兼容证据

旧 bash/shell、task 工具与 Runtime 实现同时运行，覆盖：

- 显式 `run_in_background` 的文本、details、task ID 和输出路径。
- 短命令在软等待内完成并内联返回。
- 长命令超过软等待后自动提升及流式 update。
- 显式后台完成通知、内联完成通知抑制、提升后完成通知。
- 完成、失败、停止等通知 XML 格式。
- 后台服务内联失败的退出码文本和 2000 行尾部截断。
- `task_output` 定义、Schema、scope、requires、category、完整读取和增量游标。
- `task_stop` 对运行中、已结束和不存在任务的行为以及 `endedBy: "agent"`。
- Windows/Unix bash/shell 平台互斥与 7 个场景 Tool Profile。

验证结果：

- 后台命令差分合同 9 项通过。
- 前台命令合同 11 项继续通过。
- Runtime Tools 全包 142 项通过。
- CLI Composition Root 9 项通过。
- `check:quick`、Biome 和质量 guards 通过。

完整 `bun run check` 的类型阶段仍被当前分支既有错误阻断，错误位于
`packages/capability-runtime/test/registry.test.ts`、`packages/runtime-core/test/kernel/turn-pipeline.test.ts`
及此前已有的旧 Tool 测试类型适配位置；没有错误指向本轮新增实现。按 Surgical Changes 原则，
本轮未修改这些无关测试。

## 明确未修改

- 没有切换生产 CLI、Desktop、RPC、IM 或 AgentSession。
- 没有删除旧 bash/shell、task 工具或 `BackgroundTaskManager`。
- 没有重写底层后台进程、日志文件、节流事件和进程树终止实现。
- 没有改变 task ID、状态、停止原因、通知时机、输出游标和用户可见文本。
- 没有新增 Zod；现有 TypeBox 足以保持旧 JSON Schema。

## 下一步

在已经稳定的 Service Port 后替换底层 Manager：

1. 提取 `BackgroundProcessOperations` 和 `BackgroundOutputStore`，只承载宿主进程与日志 I/O。
2. 在 Runtime 实现任务 ID、状态机、waiter、事件节流、读取游标和通知仲裁。
3. 让 coding-agent Adapter 只实现 shell、spawn、kill tree 和本地文件存储，不再暴露旧 Manager。
4. 复用本轮差分合同验证 completed/failed/killed、user/agent/dispose、通知去重和竞态。
5. 差分全部通过后，才从过渡 Composition Root 删除 `BackgroundTaskManager` Adapter。
