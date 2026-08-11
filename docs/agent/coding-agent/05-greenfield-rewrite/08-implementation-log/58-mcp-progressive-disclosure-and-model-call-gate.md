# 第 58 轮：MCP 会话级渐进披露与模型调用输入门禁

## 目标

本轮作为一个完整阶段，补齐第 57 轮明确留下的 MCP deferred discovery 缺口，同时不改变旧业务算法和默认生产入口：

1. 保留旧实现的 `> 15` 工具阈值、`tool_search` Schema/描述/结果和关键词排序。
2. MCP 连接与动态注册继续进程级共享，搜索激活集合改为 Session 独占。
3. 工具、提示词索引和服务变化在下一次模型调用生效，不重编译 Runtime Snapshot。
4. 建立 MCP 范围内的 `systemPrompt + messages + tools` 模型调用输入门禁。
5. 明确完整 Legacy/Greenfield 输入等价仍未完成，不能据此切换默认入口。

## 分析与架构结论

### 1. MCP 有两类生命周期，不能放进同一个对象

```text
进程级共享
  McpManager
    -> server/OAuth/reconnect
    -> McpRuntimeToolSynchronizer
    -> CodingToolRegistry

Session 级独占
  McpDeferredToolController
    -> 当前 MCP 索引视图
    -> activated tool names
    -> tool_search
    -> MCP system prompt contribution
```

连接、认证、重连和工具注册属于外部能力源，多个 Session 可以共享。某个模型通过 `tool_search` 选择了哪些工具则是会话决策；若把该集合放进共享 synchronizer，一个会话的搜索会把工具泄漏给其他会话。

因此本轮没有把 `tool_search` 注册到全局 Catalog，而是由每个 Session 的动态 Model Call Contribution 提供。搜索完成后，同一个 Agent Tool Loop 的下一次模型调用重新解析 Frame，即可看到刚激活的 MCP 工具。

### 2. 动态变化不等于重建 Runtime Snapshot

`McpRuntimeToolSynchronizer` 每次刷新仍对 Registry 做逐工具增删和 binding 替换，并额外发布只读描述符视图：

```text
McpRuntimeToolSnapshot {
  revision
  tools: [{ name, description }]
}
```

这里的 `Snapshot` 只是 MCP Catalog 的小型成员视图，不是 Kernel 的完整 Runtime Snapshot：

- 工具集合和描述未变化时，返回同一个视图对象和 revision。
- 局部变化时会重建描述符数组，但只增量修改受影响的 Registry binding。
- Feature 实例、Session、Conversation、Model Runtime 和完整 Capability Snapshot 都不重建。
- 每个 Session controller 只替换当前视图引用。

这种设计既保证一次模型调用使用一致的 MCP 索引，也不会因为一个服务增删工具而重建整个 Agent 内核。

### 3. 删除与恢复保留旧运行时语义

旧 RuntimeManager 的会话激活集合不会因工具临时删除而清空。工具从当前索引和 Registry 消失后不可调用；同名工具重新出现时，该会话恢复可见。

Greenfield controller 保留相同行为：

- 当前索引决定“工具是否存在”。
- Session 激活集合决定“存在时是否可见”。
- 删除只改变前者，不清除后者。
- Session dispose/resume 会创建新 controller，瞬时激活集合不会错误持久化。

### 4. explicit activation 必须绕过 deferred

旧逻辑在显式工具列表存在时不进入 deferred 模式。Greenfield 继续保持：

- 即使 MCP 工具总数超过 15，explicit 模式也不提供 `tool_search`。
- 系统提示词只列出显式选择的 MCP 工具。
- 模型 tools 数组只包含显式选择结果。

### 5. 兼容逻辑继续复用旧事实源

`coding-agent` 新增窄适配器，直接复用：

- `scoreDeferredTools()` 的名称三倍权重、描述单倍权重和稳定排序；
- `createToolSearchTool()` 的 TypeBox Schema、description、参数钳制、结果文本和 details；
- `renderMcpToolsSection()` 的首行截断、工具索引和 deferred/eager 指令。

Runtime MCP 不复制这些业务规则，只拥有会话状态与贡献编排。

本轮没有引入新的 Zod/TypeBox 校验层：没有新增不可信 JSON/网络输入边界，`tool_search` 输入仍由旧 TypeBox Schema 校验，MCP tool schema 仍走既有 adapter。额外验证库只会制造第二套规则。

## 已实施

### Coding Agent Adapter

- 导出既有 MCP system prompt 段落渲染函数。
- 新增 Greenfield MCP deferred adapter，转换旧搜索、提示词和 `tool_search` Runtime Tool。
- 不修改旧 RuntimeManager、McpManager 或工具实现。

### Runtime MCP

- synchronizer 新增稳定、版本化的 MCP 工具描述符视图。
- 新增 `McpDeferredToolController`，持有 Session 激活集合。
- controller 以动态 Feature 贡献 MCP 指令和 `tool_search`。
- 默认阈值保持 15，超过阈值才 deferred。

### CLI Greenfield Composition Root

- 每个 create/resume Session 创建自己的 controller。
- 每次模型调用先刷新共享 synchronizer，再更新当前 Session 的视图。
- Coding Tool filter 根据当前 Session 激活集合隐藏未激活 MCP 工具。
- Session state 同步反映 `tool_search` 和已激活工具。
- dispose 清理 controller，不持久化瞬时发现状态。

## 模型调用输入门禁

本轮测试直接从真实 Greenfield `streamFn` 边界捕获：

```text
{
  systemPrompt,
  messages,
  tools: [{ name, description, inputSchema }]
}
```

MCP 范围的断言包括：

- 16 个工具的首轮 prompt 精确等于旧 MCP deferred 段落。
- 首轮模型只看到 `tool_search`，用户消息保持不变。
- `tool_search` 执行后的下一次调用同时看到命中工具与 `tool_search`。
- 第二个 Session 不继承第一个 Session 的激活结果。
- 动态删除后 prompt 和 tools 同时移除 MCP；恢复后原 Session 恢复激活。
- resume 后只恢复 MCP 当前索引，不恢复进程内激活集合。
- explicit 模式在 16 个工具时仍为 eager，prompt 和 tools 只包含显式工具。

该门禁是 **MCP 子合同**，不是完整系统提示词等价证明。Greenfield profile 尚未组装 Legacy 的全部 core guidelines、context files、动态 Skill 列表、plugin system prompt operation 和 agent mode 文案，工具全局顺序也尚未建立完整差分。因此默认入口继续保持 Legacy。

## 验证结果

- `packages/cli-app` 完整包测试：2 个文件、17 项全部通过。
- `tool-search.test.ts`：9 项全部通过，确认复用的搜索和结果行为未变化。
- `bun run check:quick`：通过。
- 根目录 `bun run check`：Biome、monorepo tsgo、desktop tsc、admin tsc 与 guards 全部通过。
- 合并执行既有 `system-prompt.test.ts` 时有 1 项 Windows 平台基线失败：测试固定期待 `bash`，实际既有行为按平台输出 `shell`；本轮只把原渲染函数改为导出，未改变默认工具解析，也未扩大范围修改该无关测试。

## 功能等价结果

| 行为 | 结果 |
| --- | --- |
| `> 15` 阈值 | 等价 |
| 旧搜索打分与最大结果限制 | 直接复用 |
| `tool_search` Schema/description/result | 直接复用 |
| deferred/eager MCP 指令 | 直接复用 |
| Session 激活隔离 | 通过 |
| 删除/同名恢复 | 等价 |
| resume 瞬时状态 | 等价，不持久化 |
| explicit bypass | 等价 |
| MCP 动态刷新 | 下一模型调用生效 |
| 完整模型调用三元组 | 尚未完成，仅 MCP 子合同通过 |
| 默认入口 | 未切换 |

## 明确未修改

- 未重构或替换 MCP 协议、OAuth、transport、重试和 server 生命周期。
- 未改变任何 MCP 工具名称、Schema、description 或执行结果。
- 未把 MCP 类型放进 `runtime-core`。
- 未把 Session 激活集合放进共享 Registry 或持久化层。
- 未为局部 MCP 变化重建 Runtime Capability Snapshot。
- 未切换 CLI、Desktop、RPC 或 SDK 默认入口。

## 下一步

下一阶段应完成“完整模型调用输入等价门禁”，作为一个阶段处理：

1. 把 Legacy core system prompt blocks 适配为按优先级组合的 Greenfield instructions，覆盖工具说明、guidelines、context files、skills、mode、personalization 和 footer。
2. 把 plugin system prompt operations 与动态 plugin tool contribution 接到调用级贡献，验证热变更和失败隔离。
3. 建立不裁剪字段的 Legacy/Greenfield `systemPrompt + messages + tools` 差分 fixture，并单独审计工具顺序。
4. 只有完整差分通过后，才允许新增单一 CLI 场景的显式 opt-in；其他入口继续保持 Legacy。
