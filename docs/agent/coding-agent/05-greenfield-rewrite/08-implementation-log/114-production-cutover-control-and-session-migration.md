# 第 114 轮：生产切换控制面与会话迁移边界

## 目标

在不改变默认 Runtime 和产品功能的前提下，为后续生产切换补齐两项基础能力：

- 把 Runtime 的请求值、实际生效值和回退原因变成稳定、可观察的控制面。
- 提供显式、非破坏、拒绝覆盖的 Legacy 会话到 Greenfield V2 会话迁移。

## 实施假设

- 默认 selector 继续是 Legacy，本轮不进行生产默认切换。
- 已有 Legacy 会话的自动回退行为继续保留，不在 resume 时静默迁移文件。
- 旧会话文件是迁移输入和回滚依据，迁移不得原地覆盖或修改。
- `createLegacyAgentBootstrap()` 可能存在外部消费者，先保留兼容转发，不直接删除。

## 修改

### 中性 Bootstrap 与 Runtime 决策观察

`coding-agent` 新增 `createAgentCliBootstrap()`，承接与具体 Runtime 无关的参数解析、宿主资源准备和诊断。
原有 `createLegacyAgentBootstrap()` 标记为弃用并转发到新入口，旧调用行为不变。

CLI Runtime selector 新增稳定决策合同：

```text
requestedBackend
  -> select backend
  -> effectiveBackend
  -> optional fallbackReason
```

CLI、独立 Agent RPC 和 Desktop Agent RPC 入口统一将决策写入 stderr。Legacy 默认、Greenfield 正常选择和
已有 Legacy 会话回退都可被宿主观察；stdout 仍只承载 RPC JSONL。

### 显式 Legacy→V2 会话迁移

`runtime-storage` 新增 `migrateLegacySessionToV2()`：

1. 只读解析 Legacy V1/V2/V3 JSONL，并保留原始格式版本。
2. 生成 V2 header 与 `conversation.import.seed`。
3. 使用 TypeBox 校验 seed，再通过完整 Conversation codec/document 投影复验目标内容。
4. 写入目标同目录临时文件。
5. 通过拒绝覆盖的原子发布创建目标文件，最后清理临时文件。

导入 seed 保存源路径、源 session id、源版本、entries、active leaf 和会话名。迁移后的 V2 会话能够正常读取、
恢复名称并继续追加新 Turn。目标已存在、源目标相同和不受支持的旧消息均 fail closed。

### 架构回退守卫

包边界质量守卫现在禁止以下 Greenfield 产品区域使用 Legacy 启动符号：

- `packages/cli-app/src/rpc/greenfield*`
- `packages/runtime-composition/src/*`

禁止符号为 `createLegacyAgentBootstrap` 和 `runLegacyAgentWithBootstrap`。检查使用 TypeScript AST，注释不会
误报；selector 本身继续允许持有显式兼容回退。

Legacy reader 合同原先通过 `@vetta/coding-agent/runtime-host` 包入口取得历史投影 Oracle，导致测试收集时
加载无关 MCP OAuth 组合。测试已改为直接依赖对应历史适配模块，只隔离测试依赖，不修改生产实现或预期结果。

## 明确未修改

- 没有切换任何 Runtime 默认值。
- 没有自动迁移、覆盖或删除 Legacy 会话。
- 没有改变 Tool 名称、描述、Schema、执行结果或动态能力刷新语义。
- 没有改变 RPC stdout JSONL 合同。
- 没有删除 Legacy Bootstrap、Runtime 或公开 API。
- 没有扩大 `greenfield-im` 的场景范围。

## TypeBox / Zod 判断

新增的 `conversation.import.seed` 会从持久文件反序列化，属于真实外部边界，因此使用 TypeBox 并进入统一
record codec。Runtime 决策观察和迁移调用参数是进程内已类型化对象，不需要再引入 Zod。

## 验证

- `bunx vitest --run test/agent-runtime-selection.test.ts`
  - 1 个测试文件、4 项测试通过。
- `bunx vitest --run test/conversation/legacy-session-migration.test.ts`
  - 1 个测试文件、3 项测试通过。
- `bunx vitest --run test/conversation/legacy-session-document-reader.test.ts`
  - 1 个测试文件、3 项测试通过。
- Conversation Repository、continuation、自定义记录和 context 记录定向回归
  - 4 个测试文件、22 项测试通过。
- `bunx vitest --run scripts/quality/quality-gates.test.mjs`
  - 1 个测试文件、30 项测试通过。
- `bun run verify:artifact:installed`
  - 1 个测试文件、3 项测试通过。
  - 确认新增 stderr 决策日志不影响安装产物 Provider/RPC、跨进程恢复和动态 Skill/MCP 合同。
- `bun run check:quick` 通过。
- `bun run check` 通过，覆盖 Biome、root tsgo、CLI、Desktop、Admin 和质量守卫。

## 下一步

进入“公开 API 与依赖所有权审计”：枚举 `coding-agent` 根入口、子路径导出和 Greenfield Composition 的反向
依赖，区分稳定合同、兼容转发与真正的 Legacy 实现；先为可迁移依赖建立消费者清零守卫，再讨论默认 selector
切换和旧代码删除。
