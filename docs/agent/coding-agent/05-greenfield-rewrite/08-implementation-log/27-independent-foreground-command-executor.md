# 独立 Runtime 前台命令执行器与宿主进程适配

## 目标

在不改变 bash/shell 功能的前提下，移除 CLI 过渡 Composition Root 对旧
`createBashTool/createShellTool` 前台执行路径的默认依赖。Runtime Tools 拥有前台命令行为，
coding-agent 只提供本地进程宿主能力；后台任务不与本轮混合。

## 修改范围

- Runtime Tools 新增独立 `ForegroundCommandExecutor`，实现前台结果、更新、错误和副作用合同。
- Runtime Tools 补齐尾部截断和引号路径修正行为模块。
- 新增低层 `ForegroundCommandOperations` Port，只抽象命令进程执行。
- coding-agent 新增本地进程 Adapter，负责 shell、环境、spawn、超时和进程树终止。
- CLI 过渡 Composition Root 默认组合新 Runtime Executor 与 coding-agent Adapter。
- 旧 `LegacyCommandToolExecutor` 继续保留，但不再是该 Composition Root 的默认前台路径。
- 命令差分合同改为直接比较旧工具与独立 Runtime Executor。

## 责任边界

```text
Runtime Tools
  CommandToolExecutor
    -> prefix / spawn context / path correction
    -> streaming update / decode / tail truncation
    -> temp output / exit and timeout errors
    -> protected directory change warning
    -> ForegroundCommandOperations

coding-agent Host Adapter
  shell selection / managed-bin environment / PowerShell UTF-8 prefix
  spawn / stdout+stderr / AbortSignal / timeout / process-tree kill
```

Runtime 不知道 coding-agent 的旧工具工厂、SettingsManager 或 BackgroundTaskManager。
Adapter 不格式化 Tool Result，也不拥有路径修正、截断、临时输出和用户可见错误语义。这样本地
进程实现可以替换，前台 Tool 合同不会随宿主实现漂移。

## 行为兼容证据

旧 bash/shell 和新 Runtime 执行器共同运行同一差分合同，覆盖：

- name、label、description、TypeBox Schema、scope 和 category。
- 命令前缀、spawn hook、cwd 与环境覆盖。
- 成功结果、details 和流式 update。
- 非零退出、显式超时、取消和后台不可用错误。
- CJK 文件名空格修正及修正说明。
- 2000 行尾部截断和截断 details。
- skill 目录写入检测与告警。
- 真实本地前台进程执行。

结果：命令合同 11 项通过；Runtime Tools 全包 133 项通过；CLI Composition Root 9 项通过；
根 `check:quick` 与完整 `check` 通过。

coding-agent 全量测试在当前 Windows 工作树仍存在与本轮无关的既有失败，包括路径分隔符、
SettingsManager、系统提示词和旧工具平台假设。本轮未修改这些模块，也没有为通过全量测试而
改写旧功能；命令迁移由上述定向差分、Runtime 全包回归和根类型门禁验证。

## 明确未修改

- 没有修改生产 CLI、Desktop、RPC 或 IM 入口。
- 没有删除或改写旧 bash/shell 工具及兼容 Adapter。
- 没有迁移 `run_in_background`、软等待自动转后台、任务通知、`task_output` 或 `task_stop`。
- 没有修改工具名称、描述、Schema、scope、错误文本或默认 45 秒 hard timeout。
- 没有新增 Zod；命令输入边界继续使用已经存在且与旧 Schema 一致的 TypeBox。

## 下一步

把后台任务作为独立能力迁移，而不是扩张 `ForegroundCommandOperations`：

1. 提取 `BackgroundCommandService` Port，表达 spawn、wait、subscribe、read-output 和 stop。
2. 用旧 `BackgroundTaskManager` 建立参数化 Oracle，覆盖显式后台、软等待自动提升、通知、取消
   和清理。
3. 在 Runtime Tools 分别实现后台命令协调、`task_output` 和 `task_stop` Registration，并通过
   `requires: ["bg-tasks"]` 接入动态能力激活。
4. 差分通过后再从默认组合中移除后台兼容路径；旧完整工具在此前继续保留。
