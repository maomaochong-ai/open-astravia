# Tool requires/capabilities 激活合同

## 目标

为命令执行工具迁移补齐旧 Runtime Manager 的会话能力过滤语义，避免
`task_output/task_stop` 在后台任务能力关闭时错误暴露。

## 修改范围

- `CodingToolRegistration` 增加可选 `requires`。
- scope 激活增加 `capabilities` 集合。
- Feature 在每次 Model Call 重新读取 capabilities。
- Catalog Snapshot 冻结 requires 数组。
- 增加旧 `resolveActiveToolNames` 与新 Registration 的 `bg-tasks` 差分测试。

## 实施结果

普通 scope 激活现在要求：

```text
scopeUse 包含当前场景
  AND
requires 全部存在于 capabilities
```

`additionallyEnabledToolNames` 和 explicit activation 继续绕过 requires，保持旧系统显式
工具选择的行为。capabilities 通过同一个可变集合传入时，下一次 Model Call 会立即反映变化，
不需要重建 Runtime Snapshot。

## 明确未修改

- 没有迁移 `bash`、`shell`、`task_output` 或 `task_stop`。
- 没有引入 `BackgroundTaskManager` 到 Runtime Tools。
- 没有改变任何现有工具的 scope、Schema、描述、输出或错误。
- 没有切换生产 CLI、Desktop、RPC 或 IM 入口。

## 验证

在 `packages/runtime-tools` 运行：

```text
bunx vitest --run test/coding/coding-tools-feature.test.ts
```

结果：1 个测试文件、15 个测试全部通过。

## 下一步

以旧 `bash/shell` 测试为 Oracle，先提取前台命令执行合同，再通过 Runtime Port 接入本地
进程执行。后台任务服务、`task_output`、`task_stop` 和 Session 生命周期另行作为第二个
子阶段接入，避免把旧 `BackgroundTaskManager` 直接带入 Runtime Tools。
