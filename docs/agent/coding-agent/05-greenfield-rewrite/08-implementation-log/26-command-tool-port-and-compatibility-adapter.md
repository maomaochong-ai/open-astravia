# Bash/Shell Port、兼容适配器与 Profile 接入

## 目标

把 bash/shell 的注册、激活和 Runtime Tool Loop 边界迁移到新架构，同时完整保留旧命令执行
行为，不在本阶段重写进程、后台任务或保护目录功能。

## 修改范围

- 新增共享 `CommandToolExecutor` Port 和 TypeBox 输入 Schema。
- bash 与 shell 分别建立独立工具目录、description.ts 和 Registration。
- 新增 coding-agent `LegacyCommandToolExecutor` 适配器。
- CLI 过渡 Composition Root 注册 bash 和 shell。
- Tool Profile 差分加入旧、新 bash/shell。
- 增加定义、执行、错误、平台 scope、Port 转发和真实本地命令测试。

## 实施结果

依赖方向为：

```text
cli-app Composition Root
  -> runtime-tools bash/shell Registration
  -> CommandToolExecutor Port
  -> coding-agent compatibility Adapter
  -> legacy command implementation
```

Runtime Tools 的 `src/coding` 没有导入 coding-agent。兼容依赖只存在于 Composition Root 和
coding-agent Adapter。bash/shell 始终同时注册，由平台 scope 保证 Windows 默认 shell、其他
平台默认 bash；显式激活仍可选择另一工具。

## 行为兼容证据

- 完整描述和 TypeBox Schema 与旧工具逐字段相等。
- name、label、category 和当前平台 scope 相等。
- 成功输出、details 和 update 相等。
- 非零退出错误和后台能力不可用错误相等。
- Windows/Unix 平台 scope 互斥。
- 真实本地前台命令通过 Runtime Port 执行成功。
- 7 个会话场景的 Composition Root Profile 差分为零。

## 明确未修改

- 没有重写或删除旧 bash/shell 执行实现。
- 没有改变命令前缀、spawn hook、超时、取消、截断、路径修正或保护目录行为。
- 没有迁移后台任务服务、`task_output` 或 `task_stop`。
- 没有切换生产 CLI、Desktop、RPC 或 IM 入口。
- 没有删除 runtime-tools 包根兼容导出。

## 验证

```text
packages/runtime-tools:
  bunx vitest --run test/coding/command/command-runtime-contract.test.ts

packages/cli-app:
  bunx vitest --run test/runtime-tools-composition.test.ts
```

结果：命令合同 7 项、Composition Root 9 项全部通过。

## 下一步

为旧 bash/shell 提取更完整的前台行为合同，覆盖显式超时、默认 hard timeout、AbortSignal、
输出尾部截断、临时文件、路径修正、spawn hook、环境覆盖和保护目录告警。合同建立后，在
runtime-tools 提供独立前台执行 Adapter 并替换 Legacy Adapter；后台任务保持为随后独立阶段。
