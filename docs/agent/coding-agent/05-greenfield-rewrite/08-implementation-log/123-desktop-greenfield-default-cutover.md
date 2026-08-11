# 第 123 轮：Desktop Greenfield 默认切换

## 目标

在第 122 轮真实 Legacy/Greenfield 差分为零的基础上，只切换 Desktop 进程的默认 Runtime：

- 未设置或设置为空的 `VETTA_DESKTOP_AGENT_RUNTIME` 使用 Greenfield；
- 显式 `legacy` 保留完整回退；
- 显式 `greenfield` 继续可用；
- 既有 Legacy 会话仍按持久化格式路由到 Legacy，不自动迁移或改写；
- CLI、RPC、IM 的选择策略不随 Desktop 默认值一起变化。

这是一轮默认决策切换，不是功能重构，也不删除 Legacy。

## 架构结论

Desktop 已有一个进程级选择事实源，同时被交互/Scheduler/Batch 的 `RuntimeHost` 和 Knowledge Poller
消费。默认值应只在这个选择器中改变，不能在各消费者中分别写默认逻辑。

选择结果只决定新会话和无既有格式身份的工作使用哪个后端。恢复已有会话时，Catalog Router 先根据会话
文件格式选择后端：

```text
进程选择 default -> Greenfield
        |
        +-> 新会话 / Knowledge processing -> Greenfield
        |
        +-> 已有 Legacy catalog entry ------> Legacy
        |
        +-> 已有 Conversation V2 entry -----> Greenfield
```

因此“Greenfield 成为默认值”不等于“把 Legacy 会话迁移成 Greenfield”，也不改变持久化格式。

## 实施

### 1. 切换唯一默认选择器

`resolveDesktopAgentRuntimeBackend` 的合同调整为：

| 输入 | 结果 |
| --- | --- |
| `undefined`、空字符串、纯空白 | `greenfield` |
| `legacy` | `legacy` |
| `greenfield` | `greenfield` |
| 其他值 | 抛出配置错误 |

没有在 RuntimeHost、Knowledge Poller、Scheduler 或 Batch 中复制判断。它们继续消费同一个进程级选择
结果。

### 2. 分离 Canary 的选择态与有效运行态

真实 Canary 新增独立的 `RuntimeCanarySelection`：

- `default`：不向 Desktop 注入 `VETTA_DESKTOP_AGENT_RUNTIME`；
- `legacy`：显式注入 `legacy`；
- `greenfield`：显式注入 `greenfield`。

Provider fixture 的 `mode` 仍表示期望的有效实现，只允许 `legacy | greenfield`。`default` 不是第三种
Runtime，它只是“没有显式配置”的启动方式。

UI 验证环境会在 `default` 分支主动删除从父进程继承的
`VETTA_DESKTOP_AGENT_RUNTIME`。这一步防止开发机环境变量把默认路径悄悄改成显式选择。

跨进程状态和最终结果分别记录：

- `runtimeSelection`：`default | legacy | greenfield`；
- `runtimeMode`：实际运行的 `legacy | greenfield`。

二者继续使用 Zod 校验，因为它们跨越文件、进程和 CLI JSON 边界。

### 3. 将真实差分升级为三路门禁

`verify:ui:runtime-diff` 现在顺序运行三个隔离的真实 Desktop：

```text
未配置 Default ───────┐
                      ├─> Default 与显式 Greenfield 必须完全相等
显式 Greenfield ──────┘

显式 Legacy ──────────┐
                      ├─> 归一化产品合同差分
显式 Greenfield ──────┘
```

Default 与显式 Greenfield 比较以下完整结果，任何差异都阻断：

- 有效 Runtime；
- Knowledge processing record 格式；
- 成功、中止、Provider 失败三类扫描；
- wiki、manifest、tags 与失败账本；
- Monitor 与 Renderer 通知；
- Desktop 重启、锁释放、endpoint、Provider 和退出码。

Legacy/Greenfield 差分继续只允许三项选择轴或内部实现差异：

1. `runtimeSelection`；
2. `runtimeMode`；
3. `processingRecordFormat`。

产品可观察合同仍不允许差异。

## 结果

- 未配置 Desktop 真实启动的 `runtimeSelection` 为 `default`，有效 Runtime 为 Greenfield；
- Default 与显式 Greenfield 的阻断差异为 `[]`；
- Legacy 与 Greenfield 的阻断差异为 `[]`；
- 显式 Legacy 的真实会话、Knowledge、重启和清理闭环仍通过；
- Catalog、生命周期和宿主差分测试继续通过，既有 Legacy 会话路由未被默认值覆盖。

## 明确未修改

- 没有删除 Legacy Backend、Legacy Catalog 或兼容适配器；
- 没有自动迁移、重写或重命名任何会话文件；
- 没有改变 CLI、RPC、IM 的默认 Runtime；
- 没有改变 Tool、Prompt、Skill、MCP、Todo、Writer、批次或并发行为；
- 没有改变 Knowledge 成功、失败、中止、通知和 Monitor 口径；
- 没有新增运行时 fallback，也没有吞掉无效 selector 配置。

## 验证

- Selector、Canary 合同、Runner、Provider：4 个文件、18 项测试通过；
- Desktop Catalog、生命周期与 Legacy/Greenfield 宿主差分：3 个文件、8 项测试通过；
- `packages/desktop-app` 独立 `tsc --noEmit`：通过；
- 根目录 `bun run check:quick`：通过；
- 根目录 `bun run verify:ui:runtime-diff`：三路真实 Desktop Canary 通过；
- 根目录 `bun run check`：Biome、root/CLI/Desktop/Admin 类型检查和质量守卫全部通过。

## 下一步

第 124 轮不应立即删除 Legacy。应先完成默认切换后的收口：

1. 审计 Desktop 生产诊断中 requested/effective Runtime 与回退原因是否完整可观察；
2. 为显式 Legacy 回退增加独立的启动与恢复演练入口，确保回滚不依赖修改代码；
3. 盘点仍只能由 Legacy 承担的会话或宿主边界，并用可执行门禁证明清零；
4. 定义 Legacy 删除的进入条件、回滚窗口和持久化兼容期限；
5. 满足删除条件后，再把 Legacy 物理移除作为单独阶段实施。
