# 阶段 203：Session Initialization Profile 边界

## 阶段目标

将 Session 初始化事务从完整的 `GreenfieldRuntimeCompositionOptions` 中隔离出来，使事务只依赖自身真正需要的配置，同时保持现有启动顺序、动态能力和公开 API 不变。

本阶段只重构依赖方向，不重构功能。

## 实施前问题

`greenfield-session-initialization-transaction.ts` 原先直接持有完整的 Composition Options。由此产生两个架构问题：

1. Session 初始化事务可以无约束地读取宿主组合配置，边界会随着公共 Options 增长而继续扩张。
2. Root 虽然已经拆出了 Tool Surface、MCP Coordinator、Resource Registry 等组件，但仍把原始公共配置整体传入内部事务，Composition Root 与初始化事务之间缺少显式投影层。

提示词资源与设置来源的成对校验也直接写在 Root 内，属于 Session 初始化输入约束，而不是 Root 的对象装配职责。

## 实施内容

### 1. 新增 Session Initialization Profile

新增 `greenfield-session-initialization-profile.ts`：

- 使用 `Pick<GreenfieldRuntimeCompositionOptions, ...>` 定义初始化事务所需的最小配置集合。
- 工厂显式投影 23 个 Session 初始化字段。
- 不投影 `conversationDir`、`mcpSource`、`streamFn`、Tool Surface 配置等 Root 或其他装配单元负责的字段。
- 将 `promptResourceSource` 与 `promptSettingsSource` 的成对校验迁移到 profile 工厂，并保留原错误文本。

Profile 保留 source、resolver 和 factory 的原始引用，不复制动态资源内容，也不形成新的运行时快照。因此本地 Skill、提示词设置等动态来源仍按原有实现读取和刷新。

### 2. 收紧 Session Initialization Transaction 依赖

调整 `greenfield-session-initialization-transaction.ts`：

- 删除对 `GreenfieldRuntimeCompositionOptions` 的导入和依赖。
- Transaction Options 从 `composition` 改为 `profile`。
- Plugin、Memory、Todo、Hook、Compaction、Subagent 和 Prompt 等初始化读取全部改为从窄化 profile 获取。
- 初始化顺序、资源回滚顺序以及所有 factory/resolver 调用方式保持不变。

### 3. 调整 Composition Root 接线

调整 `greenfield-runtime-composition.ts`：

- 在创建任何运行时资源前创建 Session Initialization Profile。
- Root 只向初始化事务传递 profile，不再传递完整公共 Options。
- Root 仍持有宿主级职责，包括 Tool Surface、Repository、Model Adapter、Child Composition Policy 和 Runtime Controls 的装配。

### 4. 增加架构守卫

扩展 package boundary guard，禁止：

- Composition Root 再次以 `composition` 属性向 Session 初始化事务传递原始 Options。
- Session 初始化事务重新依赖 `GreenfieldRuntimeCompositionOptions`。
- Session 初始化事务恢复 `composition` 变量或属性依赖。

守卫测试同时覆盖违规样例和合法 profile 接线样例。

## 测试补充

新增 `greenfield-session-initialization-profile.test.ts`，验证：

- Profile 只包含约定的 23 个字段。
- 动态 prompt source 和 factory 保持引用身份。
- Root 专属配置不会泄漏到 Profile。
- 两个 prompt 动态来源只提供任意一个时均保持原错误行为。

原 Session Initialization Transaction 回滚测试继续通过，证明初始化失败后的逆序回滚和同 Session 重启行为未发生变化。

## 验证结果

以下验证均通过：

```text
bunx vitest --run test/runtime-core/greenfield-session-initialization-profile.test.ts test/runtime-core/greenfield-session-initialization-transaction.test.ts
  2 files passed, 3 tests passed

bunx vitest --run test/greenfield-runtime-composition.test.ts test/greenfield-plugin-runtime.test.ts test/greenfield-plugin-mcp-session.test.ts test/greenfield-memory-runtime.test.ts test/greenfield-subagent-runtime.test.ts
  5 files passed, 25 tests passed

bunx vitest --run scripts/quality/quality-gates.test.mjs
  1 file passed, 51 tests passed

bun run check:quick
  passed

bun run check
  lint passed
  types passed（root tsgo、cli-app、desktop-app、admin）
  guards passed
```

## 类型校验决策

本阶段没有引入 TypeBox 或 Zod。Profile 的输入来自同一进程内已经类型化的 Composition Options，不是外部 JSON、配置文件或网络协议边界；需要执行期检查的只有两个可选动态来源必须成对提供，直接条件校验已经足够。引入 schema 库不会增加有效安全性，反而会形成重复类型定义。

## 阶段结论

Session 初始化事务现已形成明确的内部输入端口：

```text
Public Composition Options
          |
          v
Session Initialization Profile
          |
          v
Session Initialization Transaction
```

公共 Options 继续服务 Composition Root 和 Child Composition Policy；初始化事务只能访问显式投影后的配置。该边界降低了后续公共配置增长对 Session 初始化核心的干扰，同时没有改变任何已有功能。
