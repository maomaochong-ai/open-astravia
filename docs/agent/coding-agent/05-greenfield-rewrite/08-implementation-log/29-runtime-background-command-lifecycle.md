# Runtime 后台任务生命周期与低层宿主端口

## 目标

替换上一阶段由旧 `BackgroundTaskManager` 提供的过渡 Service 实现，让 Runtime 独立拥有后台
任务生命周期，同时保持 bash/shell、通知和 task 工具的所有可观察行为不变。

## 修改范围

- 新增 `BackgroundCommandHost`，只包含进程操作和输出存储两个低层端口。
- 新增 Runtime `createBackgroundCommandService` 生命周期实现。
- Runtime 负责任务 ID、Snapshot、输出尾部、读取游标、waiter、软等待提升、事件节流、通知
  抑制与去重、停止原因和 dispose。
- coding-agent 新宿主只负责 shell/命令前缀、spawn、输出解码清理、进程树终止和本地日志文件。
- CLI 过渡 Composition Root 改为装配 Runtime Service 与 coding-agent Host。
- 删除新 Runtime 到旧 `BackgroundTaskManager` 的过渡适配器。
- 新增纯生命周期合同，并让既有真实进程差分合同改用独立 Runtime Service。

## 当前责任边界

```text
Runtime Tools
  BackgroundCommandExecutor
    -> BackgroundCommandService
      -> task state / wait / promotion / cursor / events / notification
      -> BackgroundCommandProcessOperations
      -> BackgroundCommandOutputStore

coding-agent Host
  process operations
    -> shell / spawn / kill process tree / output decoding
  output store
    -> create / append / read / close local log
```

旧 `BackgroundTaskManager` 仍在旧 `AgentSession` 和旧工具路径中运行，也继续作为差分 Oracle；
本阶段没有在生产入口尚未切换时删除它。

## 行为兼容证据

- bash/shell 显式后台执行结果、输出路径和完成通知与旧实现相等。
- 短命令内联、长命令软等待提升、流式 update 与通知时机相等。
- 非零退出、2000 行尾部截断、完整输出读取和增量游标相等。
- `task_stop` 的 running/completed/missing 结果及 `endedBy: "agent"` 相等。
- 独立生命周期合同覆盖 completed、failed、killed、user/dispose、重复停止和通知抑制。
- CLI Composition Root 的默认工具与 7 个场景 Profile 差分保持为零。

## 明确未修改

- 没有改变工具名称、描述、Schema、scope、requires 或用户可见文本。
- 没有切换旧 AgentSession、Desktop、RPC、IM 或现有生产 CLI。
- 没有删除旧 bash/shell、task 工具或旧 `BackgroundTaskManager`。
- 没有改变 shell 选择、PowerShell UTF-8 前缀、输出清理和进程树终止实现。
- 没有引入 Zod；本阶段没有新的外部不可信结构数据边界。

## 验证结果

- Runtime 生命周期与真实后台差分定向测试 12 项通过。
- CLI Composition Root 9 项通过。
- Runtime Tools 全包 14 个测试文件、145 项测试通过。
- `check:quick`、Runtime Tools 与 coding-agent 独立包类型检查通过。
- coding-agent 全包测试仍有本轮未修改路径中的既有 Windows/环境失败；新增后台合同没有失败。
- 完整 `bun run check` 的 lint 和 guards 通过，类型阶段仍被既有
  `capability-runtime/test/registry.test.ts`、`runtime-core/test/kernel/turn-pipeline.test.ts` 和旧
  Tool 差分测试的函数参数型变错误阻断；没有错误指向本轮实现。

## 下一步

按相同迁移 Gate 处理尚未迁移的 write/edit/tree：先提取旧行为合同，再建立 Runtime Tool、
Operations 和 Host Adapter。三个工具不应一次重写；优先从副作用边界较小的 tree 开始，再迁移
write 和具有锚点/替换语义的 edit。完整 Tool Profile 差分通过后，才能着手切换旧 AgentSession
与产品入口。
