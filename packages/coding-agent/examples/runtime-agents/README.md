# Runtime Agent Capability Examples

这组示例承接 [`@vetta/runtime-core` 的基础多 Agent 示例](../../../runtime-core/examples/README.md)，展示如何在产品
组合层为不同主 Agent 接入 MCP、Skill、Tool 和 Session Extension。它们只使用公开入口，不连接真实模型或远端服务。

## 为什么放在 Coding Agent

```text
应用 / 产品组合根
├── @vetta/coding-agent/resources   Skill 发现、索引与调用语义
├── @vetta/runtime-mcp              MCP Source、同步与渐进披露
├── @vetta/runtime-node/host        文件/进程等 Node Host adapter
└── @vetta/runtime-core             Agent、Session、Extension 与 Turn Snapshot
```

`runtime-core` 不解析 `SKILL.md`，也不认识 MCP transport。把示例放在这里可以保持依赖方向正确，同时展示最终产品如何把
各层组合为一个 `RuntimeAgentDefinition`。

## 运行

从仓库根目录执行：

```bash
bun packages/coding-agent/examples/runtime-agents/run.ts
```

输出包含两条 Skill 调用诊断和最后的三个确定性 JSON 场景，不需要 API Key，也不会启动 MCP 子进程。

## 示例一：MCP Source 到 Turn Snapshot

[`01-mcp-capability.ts`](01-mcp-capability.ts) 演示完整链路：

```text
平台 MCP Source
  -> McpRuntimeToolSynchronizer
  -> Session Plan.beforeSnapshotAcquire()
  -> ModelCallContributionProvider.bindForTurn()
  -> 本 Turn 固定的 Instruction + Tool handler
```

示例先捕获 v1 Tool，再把 Source 更新为 v2 并增加另一个 Tool。旧 lease 继续执行 v1 handler；下一 Turn 才看到 v2。
生产接入时应替换 `MutableMcpToolSource`，而不是改 Agent：

- stdio/HTTP、OAuth、Client 和配置文件读取属于平台 Host；
- Source 只发布已经校验的 `McpRuntimeToolBinding`；
- fingerprint 变化表示 handler binding 变化，即使 Tool 名称和描述相同；
- 凭证、Tool 参数和结果不能进入 Definition、默认 Observation 或日志；
- Tool 很多时使用 `createMcpDeferredToolController()` 做渐进披露。

## 示例二：Skill 发现、索引和调用

[`02-skill-capability.ts`](02-skill-capability.ts) 使用真实 [`SKILL.md`](skills/researcher/evidence-review/SKILL.md)：

1. `createNodeResourceAccess()` 提供 Host 文件端口；
2. `loadSkillsFromDir()` 校验并物化完整 Skill；
3. `formatSkillsForPrompt()` 只把名称和描述放进模型索引；
4. `createInvokeSkillTool()` 在模型选择后加载正文；
5. `bindForTurn()` 确保索引和 `invoke_skill` 使用同一份内存 generation。

Researcher 与 Reviewer 使用不同目录，测试会验证双方看不到对方的 Skill。生产实现还应：

- 审查外部 Skill 内容，把它视为不可信输入；
- 记录并处理 discovery diagnostics，不要静默忽略无效 frontmatter；
- 用 `CodingAgentSkillSource.revision` 或文件指纹触发下一 Turn 刷新；
- 通过稳定 SDK 接入 Skill hook，不要在业务代码中复制 hook 解析器；
- 始终相对 `SKILL_DIR` 解析引用，同时禁止向 Skill 安装目录写入产物。

## 示例三：Session Extension 拥有产品状态

[`03-session-extension-capability.ts`](03-session-extension-capability.ts) 把 Review Notes 作为一个完整 Session 能力：

- `service`：扩展或产品装配读取同一运行时状态；
- `endpoint`：Host/UI 通过强类型 Token 读写状态；
- `signal`：Session 内失败隔离的变更通知；
- `initial-observation-source`：迟订阅者读取当前状态；
- `agent-feature`：同一状态同时贡献 Instruction 与 Tool；
- `dispose()`：Session 关闭时释放状态和订阅。

示例创建两个 Session，证明它们虽然来自同一 Agent Instance，Extension 状态仍彼此隔离。需要持久化时再贡献
`document-participant`；需要自动继续时贡献 `continuation-source`；需要文件、网络或交互能力时声明
`SessionExtensionFunctionToken`，由外围 Composition Root 注入，不能从扩展内部偷偷访问宿主全局状态。

## 开发检查清单

- Agent 外部配置进入 Definition 前是否经过 Schema 校验？
- Tool Schema、handler、Prompt 和权限策略是否由同一个 Turn generation 捕获？
- Instance 共享资源与 Session 私有状态是否分别拥有明确的 `dispose()`？
- MCP/Skill 更新是否只影响下一 Turn，已有 lease 是否仍可完成？
- Tool 是否经过显式 `toolPolicy`，而不是因为注册成功就自动授权？
- Extension 的依赖、冲突、Service、Function 和 Endpoint 是否使用类型化 Token？
- 初始化失败是否回滚已经取得的资源？Host 关闭是否能重试失败的释放？
- 测试是否覆盖隔离、更新、取消和释放，而不只验证“能创建对象”？

完整生产接线继续阅读：

- [`runtime-core` 自定义 Agent 指南](../../../runtime-core/docs/custom-agents.md)
- [Coding Agent 与多主 Agent 基座](../../docs/runtime-agent-base.md)
- [Skill 文档](../../docs/skills.md)
- [`runtime-mcp` README](../../../runtime-mcp/README.md)
