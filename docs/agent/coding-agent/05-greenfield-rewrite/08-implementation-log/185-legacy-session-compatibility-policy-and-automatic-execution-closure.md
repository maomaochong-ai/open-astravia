# 第 185 轮：Legacy Session 兼容策略统一与自动执行收口

## 目标

第 184 轮移除了无法兑现能力的 Extension 自动 Legacy 回退。本轮继续审计剩余的旧会话自动执行路径，统一 CLI
与 Desktop 的旧会话处理策略，并确保旧格式兼容不再等价于自动进入 Legacy Runtime。

成功条件：

- 官方 Coding Agent JSONL v1-v3 会话无损迁移到 Conversation V2；
- 损坏、无法表示和未来版本会话明确失败；
- CLI 与 Desktop 默认路径都不再自动启动 Legacy Runtime；
- 显式 Legacy 选择和旧格式只读能力继续保留。

## 审计结论

### 1. 两个宿主此前使用不同策略

- CLI 对旧会话执行严格预检，`not-representable` 时自动回退 Legacy；
- Desktop 由 Legacy Catalog 认领旧路径后直接交给 `LegacyCodingAgentSessionBackend`。

这使同一份会话在不同宿主中具有不同的恢复语义。

### 2. Legacy 回退不等于安全兼容

旧 SessionManager 的解析策略会跳过 malformed JSON，未知记录也可能进入索引但不进入 LLM Context。因此 Legacy
进程能够启动，并不能证明旧内容被完整、正确地恢复。对于损坏或未来协议数据，自动回退会把兼容性失败伪装成成功。

### 3. 格式兼容和执行兼容必须分开

旧会话仍需要被发现、展示历史、重命名、导出和删除；这些属于格式兼容。是否允许 Agent 继续执行是独立策略。本轮
只收口自动执行，没有删除旧格式读写边界。

## 实施内容

### 1. 提升共享的 Coding Agent 旧会话迁移边界

新增 `migrateCodingAgentLegacySession()`，由 Coding Agent 产品层统一组合：

- runtime-storage 的严格 JSONL v1-v3 分析与 V2 原子发布；
- Coding Agent 官方旧消息归一化；
- Legacy 源文件 lease；
- 基于规范路径和内容摘要的确定性目标 ID；
- 主目标冲突后的稳定 recovery 目标；
- 源文件只读、相同目标复用。

CLI 原迁移模块缩减为兼容转发，不再独占产品迁移规则；Desktop 直接消费同一公开宿主能力。

### 2. 定义三类中性不兼容结果

共享迁移边界不再返回 `legacy-fallback`，而是返回 `session-incompatible`：

| errorCode | 含义 |
| --- | --- |
| `session_corrupt` | JSON、Header、Envelope、树引用等结构损坏 |
| `session_incompatible` | 已知记录无法无损转换为当前 Conversation V2 |
| `session_version_unsupported` | Header 版本超前或出现当前二进制未知的记录类型 |

结果只携带规范源路径、source version、首个 issue code 和 issue count，不携带会话正文。严格分析器现在会在未来
Header 被拒绝时保留其整数版本，宿主可以区分损坏 Header 与协议版本超前。

### 3. CLI 自动 Legacy Session 回退归零

Greenfield Host 把迁移失败作为中性 `session-incompatible` preparation 返回。CLI Composition Root 将其转换为
`SessionCompatibilityError`：

- RPC 输出唯一一条 `startup` 失败帧，退出码为 `2`；
- Print 在 stderr 输出无正文诊断，退出码为 `2`；
- 两种模式都不调用 Provider，也不启动 Legacy Runtime。

Legacy Runtime Gateway 删除 `session-migration-gap` 分支，现在只接受显式 `--agent-runtime legacy`。原自动回退
策略模块及其测试删除。旧 fallback 类型字面量暂时保留在兼容类型文件中，但生产代码不再产生它们。

### 4. Desktop 默认恢复先迁移再执行 Greenfield

新增 `DesktopLegacySessionMigrationBackend`。默认 Greenfield 模式下，Legacy Catalog 仍负责认领旧格式路径，但
执行步骤改为：

```text
Legacy Catalog -> shared migration -> Greenfield backend
```

不兼容结果抛出带结构化详情的 `DesktopLegacySessionCompatibilityError`，不会调用 Greenfield Backend，也不会创建
V2 目标。仅在进程通过 `VETTA_DESKTOP_AGENT_RUNTIME=legacy` 显式选择 Legacy 时，旧会话才交给
`LegacyCodingAgentSessionBackend`。

Desktop 的 Legacy Catalog、History Reader 以及 read/rename/delete 权限保持不变。

### 5. 扩展 TypeBox RPC 启动失败合同

`RpcStartupFailureSchema` 新增 Session 不兼容分支，包含：

- 三种稳定的 session error code；
- requested backend；
- 规范 session path；
- 可选 source version、issue code 和 issue count。

序列化前继续执行 TypeBox 运行时校验。进程内迁移判别使用 TypeScript 判别联合，没有引入第二套 Zod 合同。

### 6. 增加防回归门禁

包边界守卫现在同时禁止生产代码重新引入：

- `legacy-extension`；
- `legacy-session`；
- `session-migration-gap`。

仅旧公开兼容类型文件允许保留退役字面量。Desktop 组合边界测试同时保证迁移后端不依赖
`LegacyCodingAgentSessionBackend`。

## 测试范围与结果

- runtime-storage 严格分析器：16 项通过，覆盖全部 9 类 issue code、官方 v1-v3 矩阵和未来 Header 版本。
- Coding Agent RPC TypeBox 启动失败合同：4 项通过。
- 共享旧会话迁移：8 项通过。
- CLI Session 不兼容策略：2 项通过。
- Desktop 迁移后端与组合边界：6 项通过。
- 真实 RPC Runtime Selector：10 项通过。
- 真实 Print 独立可执行产物：18 项通过。
- 安装目录外的 standalone CLI 产物：13 项通过。
- 质量门禁测试：37 项通过。
- 根 `bun run check`：Lint、Monorepo/CLI/Desktop/Admin 类型检查和全部 guards 通过。

CLI 全量测试还暴露一项与本轮策略无关、单独复跑仍可复现的既有失败：
`greenfield-migrated-session-fork.test.ts` 的 fork 子会话 Provider Context 缺少 `fork-source-turn`。本轮没有修改
fork、Import Seed 分支投影或 active leaf 选择，遵循外科式修改原则未夹带修复；该问题应作为独立阶段诊断。
全量并行运行时出现过一次子代理恢复断言失败，单独复跑该文件后 3 项全部通过。

## 明确保留

- 显式 CLI `--agent-runtime legacy`；
- 显式 Desktop `VETTA_DESKTOP_AGENT_RUNTIME=legacy`；
- Legacy 会话发现、历史读取、导出、重命名和删除；
- 公开 RPC 兼容类型中的旧 fallback 字面量，供旧客户端过渡。

## 结果

CLI 和 Desktop 默认执行路径中的自动 Legacy Session 启动已经归零。旧会话兼容现在具有统一语义：支持的数据
迁移到 Greenfield，无法安全表示的数据明确失败，Legacy Runtime 只作为用户显式选择的兼容执行实现存在。
