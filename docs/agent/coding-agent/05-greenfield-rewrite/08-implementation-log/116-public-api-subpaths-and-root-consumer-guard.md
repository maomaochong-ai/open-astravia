# 第 116 轮：公开子路径与兼容根入口治理

## 目标

落实第 115 轮提出的公开 API 消费者治理：

- 为已经存在、职责稳定的 Coding Agent 能力提供显式公开子路径。
- 迁移仓库内可安全迁移的 CLI 和 Desktop 消费者。
- 保留根入口和 Legacy 行为，不把架构整理变成功能删除。
- 用结构守卫阻止生产代码重新依赖聚合根。

## 实施假设

- `@vetta/coding-agent` 根入口是已发布兼容面，仓库内引用减少不代表可以删除。
- 中性 Bootstrap、配置、Knowledge、Profile、资源加载和 RPC 已有明确职责，可以只增加转发入口。
- Legacy selector、Desktop 旧会话服务及 Runtime 包根兼容转发仍有真实职责，本轮不能伪装成稳定新 API。
- 本轮只改变模块依赖边界，不改变运行时装配、功能或默认选择。

## 修改

### 显式公开子路径

新增以下 package exports，并同步 Root、Desktop TypeScript paths 与 CLI、Desktop Vitest alias：

```text
@vetta/coding-agent/bootstrap
@vetta/coding-agent/config
@vetta/coding-agent/knowledge
@vetta/coding-agent/profile
@vetta/coding-agent/resources
@vetta/coding-agent/rpc
```

`bootstrap`、`profile` 和 `rpc` 使用薄 public-api 转发文件；其余子路径直接指向已有所有者模块。所有导出均
复用原实现引用，没有包装、复制状态或创建新的 Registry/Manager。

### 仓库内消费者迁移

CLI 的 Greenfield IM Host、RPC Session Adapter 和 Runtime selector 中性 Bootstrap 已迁移到职责子路径。
Desktop 的配置路径、资源加载、Knowledge namespace、Persona/Profile 和会话配置类型也已迁移。

精确 `@vetta/coding-agent` 根入口的受治理生产消费者从 18 个文件降为 5 个文件：

1. CLI Runtime selector 的 Legacy 启动回退。
2. Desktop 旧 Runtime 服务。
3. Desktop Knowledge Poller 的旧 `AgentSession` 处理路径。
4. Runtime Tools 包根兼容转发。
5. Runtime Storage 包根兼容转发。

这些路径继续保留是有意的兼容决策，不代表已经迁移完成。

### 根入口结构守卫

包边界检查新增 Coding Agent 根入口规则：

- 覆盖 CLI、Desktop、Runtime Tools 和 Runtime Storage 的生产 `src`。
- 禁止新增精确 `@vetta/coding-agent` 根入口引用。
- 允许显式子路径。
- 排除测试文件，使根入口兼容合同仍可验证。
- 对剩余 5 个兼容文件使用带原因的精确路径允许清单。

质量门禁测试分别覆盖新增根引用被拒绝、显式子路径被接受和兼容文件继续被允许。

### 公开合同验证

新增子路径合同测试：

- 比较根入口和显式子路径的关键导出是否为同一引用。
- 校验 `package.json` export map 的类型和运行时产物路径。

该测试不是完整导出快照；新增无关导出不会造成脆弱失败。

## 明确未修改

- 没有删除或缩减 Coding Agent 根入口导出。
- 没有改变 Tool 名称、描述、Schema、顺序、执行结果或动态刷新语义。
- 没有改变 Prompt、Skill、MCP、Knowledge、会话事件或持久化格式。
- 没有改变 CLI、RPC、IM、Desktop 的 Runtime selector 默认值。
- 没有把 Legacy 会话消费者假装成新的稳定合同。

## TypeBox / Zod 判断

本轮新增的是编译期模块边界和进程内 TypeScript 转发，没有外部 RPC、配置或持久化反序列化输入，因此不新增
TypeBox/Zod Schema。

## 验证

- 包边界质量门禁：1 个文件、34 项测试通过。
- Coding Agent 公开子路径合同：1 个文件、2 项测试通过。
- CLI selector、Greenfield IM Host 和 RPC Adapter：3 个文件、14 项测试通过。
- CLI `tsgo --noEmit` 通过。
- Desktop 独立 `tsc --noEmit` 通过。
- `bun run check:quick` 通过。
- `bun run verify:artifact:installed`：1 个文件、3 项安装产物测试通过。
- `bun run check` 通过，覆盖 Biome、root tsgo、CLI、Desktop、Admin 和质量守卫。

## 下一步

审计剩余 5 个允许项所需的最小 Legacy 符号集合。优先为 selector、Desktop 旧会话服务和 Knowledge Poller
建立窄 Legacy 边界；Runtime Tools/Storage 包根转发继续按外部兼容 API 管理。只有仓库内生产根消费者归零并
形成外部迁移窗口后，才讨论根入口弃用和默认 selector 切换。
