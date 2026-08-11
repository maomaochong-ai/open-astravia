# 第 184 轮：Extension 不兼容显式失败与虚假 Legacy 回退移除

## 目标

第 183 轮已经让 Greenfield Host 只返回中性的 `extension-incompatible` 事实，但 CLI Composition Root 仍把该
结果转换为 `legacy-extension` 并启动 Legacy Runtime。本轮验证该回退是否真正提供功能，并据此收紧 Runtime
选择策略。

## 审计结论

### 1. Legacy 可以登记未知事件名

Extension Loader 的运行时注册入口接受字符串事件名，因此使用 JavaScript 或绕过 TypeScript 类型检查的
Extension 可以登记 `future_event`。

### 2. Legacy 无法产生未知事件

Legacy Extension Runner 的发射入口由当前 `ExtensionEvent` 联合约束，所有生产调用点也只发射当前二进制已知
的事件。未知事件处理器虽然被加载，却没有任何事件生产者能够调用它。

因此原 `legacy-extension` 路径只能让进程成功启动，不能兑现 Extension 所声明的能力。这是虚假成功，不是功能
兼容。

## 实施内容

### 1. 定义 RPC 启动失败合同

Coding Agent RPC 边界新增 TypeBox `RpcStartupFailureSchema`，覆盖：

- 既有 Conversation ownership conflict；
- 新增 `extension_incompatible` 启动失败。

Extension 不兼容帧携带 requested backend、unsupported events 和 unmet runtime capabilities。序列化入口在输出
JSONL 前执行运行时校验，避免 Composition Root 手写未受约束的外部协议对象。

### 2. Composition Root 显式拒绝不兼容 Extension

CLI 收到 `extension-incompatible` 后不再适配为 Legacy fallback，而是生成
`ExtensionCompatibilityError`：

- RPC 输出唯一一条 `startup` 失败帧并设置退出码 `2`；
- Print 在 stderr 输出同一组结构化证据，设置退出码 `2`；
- 两种模式均不会进入 Provider 请求或 Legacy Runtime。

### 3. 自动 Legacy 回退只保留旧会话迁移缺口

`AutomaticLegacyRuntimeFallbackEvidence` 和 Legacy Runtime Gateway 已删除 Extension 分支。自动 Legacy 执行
现在只接受 `legacy-session` 且 migration status 必须为 `not-representable`。

显式 `--agent-runtime legacy` 保持不变。公开 `RpcRuntimeFallbackReason` 与旧 Greenfield fallback 兼容类型中的
`legacy-extension` 暂时保留并标记为退役兼容字面量，但生产代码不再产生它。

### 4. 增加防回归门禁

包边界质量检查禁止 CLI/Coding Agent 生产实现重新使用 `legacy-extension`。仅两个旧公开兼容类型文件允许保留
该字面量，避免本轮额外制造类型删除。

## 测试范围

- TypeBox 接受既有 ownership conflict wire，并拒绝缺字段的 Extension 不兼容帧。
- 真实 RPC 进程对未知事件只输出一条启动失败帧并以 `2` 退出。
- Print 在 Provider 请求前失败，stdout 保持为空。
- 安装后的独立可执行产物保持相同错误合同。
- 已知 Event、Tool、Command 和宿主不适用 UI 注册继续使用 Greenfield。
- `legacy-session/not-representable` 自动回退与显式 Legacy 继续可用。
- 静态门禁阻止生产策略重新引入 `legacy-extension`。

## 验证结果

- RPC startup TypeBox 合同：3 项通过。
- CLI Composition Root、Legacy fallback policy 和 Legacy Gateway：10 项通过。
- Greenfield Host 中性 Extension 不兼容事实：1 项通过。
- 质量门禁测试：36 项通过。
- 根 `tsgo --noEmit`：通过。
- `packages/cli-app` 独立 `tsgo --noEmit -p tsconfig.json`：通过。
- 全仓 Biome 与全部 guards：通过。

真实 RPC、Print 和安装产物测试已经更新为新错误合同，但当前受控 Windows 环境中的 Bun standalone 编译器
在读取若干仓库内源码时返回 `EPERM`，三个测试文件均在 `beforeAll` 编译阶段退出，测试主体没有执行。同一 Bun
进程可以直接读取这些文件，且错误不涉及本轮修改文件，因此没有通过放宽断言或修改产品代码规避该环境问题。

根 `bun run check` 的本轮相关检查全部通过，最终停在独立的 admin 依赖安装缺口：
`packages/admin/node_modules` 缺少已有 `@types/d3-*`、`@types/estree` 和 `@types/json-schema` 声明文件。本轮未修改
admin 依赖或锁文件。

## TypeBox / Zod 判断

本轮新增的是可被外部 RPC 客户端消费的 JSONL wire，运行时校验有明确价值，因此复用 Coding Agent 已有的
TypeBox，不另引 Zod。`ExtensionCompatibilityError` 和自动回退证据属于进程内判别合同，只使用 TypeScript
类型。

## 明确未修改

- 没有改变已知 Extension 能力的执行行为。
- 没有改变显式 Legacy Runtime。
- 没有改变旧会话 `not-representable` 回退。
- 没有删除公开兼容类型中的旧 fallback 字面量。
- 没有更新之前的过程文档，只新增本轮实施记录。

## 结果

未知 Extension 能力不再产生无法兑现的 Legacy 成功状态。Greenfield Host 负责报告兼容性事实，CLI
Composition Root 负责选择失败语义，Legacy Gateway 只处理仍然真实有效的旧会话兼容路径。
