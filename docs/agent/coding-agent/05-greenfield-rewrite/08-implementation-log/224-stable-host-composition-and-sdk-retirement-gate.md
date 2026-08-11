# 第 224 阶段：稳定 Host Composition 与旧 SDK 退役门禁

## 阶段目标

生产执行已经统一为 Greenfield，但认证、模型注册和持久化设置的 SDK 消费者仍需通过包根 `createAgentSession()` 注入具体 Manager。本阶段在不删除旧兼容 API、不改变 Agent 功能的前提下，建立独立于 Session 的稳定 Host Composition：

- Host 拥有其创建的多个 Session；
- 具体宿主服务通过 `/host-services` 适配，不进入稳定 Session 合同；
- 官方示例除完整 Composition replacement 外不再消费包根聚合 SDK；
- 关闭、并发创建和失败重试具备明确合同。

## 实施前分析

现有 `createGreenfieldAgentSessionInternal()` 已经能等价接入 `AuthStorage`、`ModelRegistry` 和 `SettingsManager`，不需要重新定义或复制这些产品实现。真正缺失的是一个长期持有共享宿主资源、创建多个稳定 Session 并统一关闭它们的所有权边界。

动态 Skill/Extension Source 不能放入 Host 默认值：Source 的订阅和 `dispose()` 当前由单个 Session 持有，多个 Session 复用同一 Source 会产生重复释放。Storage 同样是每个 Session 的身份意图。因此 Host 默认值显式排除 `storage`、`skillSources` 和 `extensionSources`。

本阶段没有为 Host 参数增加 TypeBox/Zod。它们仍是同进程 TypeScript 值与具体服务实例，不是 JSON、RPC 或不可信配置输入；外部输入继续在原 Parser、RPC 和 Tool Schema 边界校验。

## 架构决策

### 稳定 Host 与具体服务适配分离

`@vetta/coding-agent/sdk` 新增：

- `CodingAgentHost`；
- `CreateCodingAgentHostOptions`；
- `CodingAgentHostSessionDefaults`；
- `createCodingAgentHost()`。

该入口只包含稳定 Session 值合同。`@vetta/coding-agent/host-services` 新增 `createCodingAgentHostWithServices()`，负责把现有具体 Auth、Model 和 Settings 服务注入产品 Host Adapter。具体服务由调用方持有，Host 关闭不会伪造其不存在的释放语义。

### Host 生命周期线性化

Host 在 `close()` 开始后停止接纳新 Session；已经准入但尚未完成的创建会先被等待。随后 Host 并行关闭所有仍登记的 Session：

- 成功关闭的 Session 从所有权集合移除；
- 失败全部聚合，不阻止其他 Session 清理；
- 再次 `close()` 只重试失败 Session；
- Session 被调用方单独关闭时，仅在底层完整清理成功后通知 Host 释放所有权；
- 首次清理失败不会误报 Session 已从 Host 释放。

### 兼容入口按能力而不是文件名退役

02、09、10 示例改用 Host Service Adapter；06 的 Extension 作者类型改从 `/extensions` 子路径导入。新增退役门禁，官方示例中只有 `12-full-control.ts` 可以继续导入包根聚合入口，因为它仍演示完整 ResourceLoader 与 Composition replacement。

## 实施内容

- 新增稳定 Host 公共合同和默认工厂；
- 新增内部 Host Session factory，处理准入、待完成创建、所有权和可重试关闭；
- Session Adapter 在 Runtime 完整释放后发送一次关闭通知；
- Greenfield SDK Factory 将该通知接入活动 Session；
- Public Host Adapter 支持借用现有 Auth/Model/Settings 服务；
- `/host-services` 提供共享服务 Host 工厂；
- 迁移自定义模型、API Key/OAuth 和 Settings 示例；
- 更新稳定 SDK 文档、示例分类和 CHANGELOG；
- 增加 Host 生命周期、真实服务注入、公开导出和示例退役门禁测试。

## 功能保持

本阶段没有修改：

- 模型选择、凭据解析、远程模型加载和设置优先级；
- Tool、Prompt、Skill、Extension、MCP、Memory、Subagent 或压缩行为；
- 包根 `createAgentSession()` 与 `AgentSession`；
- 完整 `ResourceLoader`/Composition replacement；
- 旧会话格式读取和迁移边界。

## 验证记录

- SDK/Host 定向回归：6 个测试文件、21 项测试通过；
- 覆盖创建与关闭并发、关闭失败重试、成功项不重复关闭、共享 Settings 生效、具体 Manager 不泄漏、稳定运行时导出和示例退役门禁；
- `bun run check:quick`：通过；
- 架构守卫：0 条旧执行边、8 条保留格式边界、94 条已分类产品 Core 边，SDK 反向依赖为 0；
- `bun run check`：通过；覆盖 Biome、根 monorepo、CLI、desktop、admin 类型检查和全部质量守卫。

## 阶段结论与后续入口

普通嵌入式 SDK 和具体 Auth/Model/Settings 注入均已脱离包根旧工厂。剩余官方兼容消费者只有完整 Composition replacement 示例。下一阶段应为该高级用例建立明确的 Composition API 迁移合同，并审计 `compat-runtime-tools`、`compat-runtime-storage`、旧 RPC Session Adapter 与包根导出；在发布级迁移和安装产物回归完成前，不直接删除旧 `AgentSession`。
